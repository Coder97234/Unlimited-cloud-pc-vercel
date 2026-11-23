import { randomUUID } from 'node:crypto';
import { boundedProjectText, isProjectId, MAX_PROJECT_FILES, MAX_PROJECT_FILE_TEXT, MAX_PROJECTS, parseProjectDraft } from '../shared/projects.ts';
import type { Project, ProjectContext, ProjectFile } from '../shared/projects.ts';
import type { PlatformDb, PlatformQuery } from './database.ts';
import { ToolError } from './workspace-http.ts';

const projectFields = 'id, name, description, instructions, color, icon, updated_ms::float8 as "updatedAt"';
const fileFields = 'id, name, char_length(body) as characters, truncated, updated_ms::float8 as "updatedAt"';

// The owner comes only from the verified session. SET LOCAL isolates requests
// even when a Supabase transaction pooler reuses the database connection.
export async function withAccountScope<T>(db: PlatformDb, owner: string, work: (tx: PlatformQuery) => Promise<T>) {
  if (!db.transaction || !isProjectId(owner)) throw new ToolError('Project storage is unavailable.', 503);
  return db.transaction(async (tx) => {
    await tx.query("select set_config('xyvora.account_id',$1,true)", [owner]);
    return work(tx);
  });
}

async function projectById(tx: PlatformQuery, owner: string, id: string, lock = false) {
  const [project] = await tx.query<Project>(`select ${projectFields}, 0 as "fileCount" from xyvora_projects where account_id=$1 and id=$2${lock ? ' for update' : ''}`, [owner, id]);
  if (!project) throw new ToolError('Project not found.', 404);
  return project;
}
function projectId(value: unknown) {
  if (!isProjectId(value)) throw new ToolError('Choose a valid project or file.');
  return value;
}

export async function readProjects(db: PlatformDb, owner: string, url: URL) {
  const selection = url.searchParams.get('project'), file = url.searchParams.get('file');
  return withAccountScope(db, owner, async (tx) => {
    if (selection === null && url.searchParams.has('q')) {
      const query = boundedProjectText(url.searchParams.get('q'), 100, true);
      if (!query || file !== null) throw new ToolError('Enter a file search query.');
      const files = await tx.query<{ projectId: string; id: string; name: string }>(`select project_id as "projectId", id, name from xyvora_project_files
        where account_id=$1 and (strpos(lower(name), lower($2)) > 0 or keywords @@ plainto_tsquery('simple',$2))
        order by updated_ms desc, id limit 18`, [owner, query]);
      return { files };
    }
    if (selection === null) {
      if (file !== null) throw new ToolError('Choose a project for this file.');
      const projects = await tx.query<Project>(`select ${projectFields}, (select count(*)::int from xyvora_project_files f
        where f.account_id=p.account_id and f.project_id=p.id) as "fileCount" from xyvora_projects p
        where p.account_id=$1 order by updated_ms desc, id limit $2`, [owner, MAX_PROJECTS]);
      return { projects };
    }
    const id = projectId(selection);
    if (file !== null) {
      const [entry] = await tx.query<ProjectFile & { text: string }>(`select ${fileFields}, body as text from xyvora_project_files
        where account_id=$1 and project_id=$2 and id=$3`, [owner, id, projectId(file)]);
      if (!entry) throw new ToolError('Project file not found.', 404);
      return { file: entry };
    }
    const project = await projectById(tx, owner, id);
    const files = await tx.query<ProjectFile>(`select ${fileFields} from xyvora_project_files where account_id=$1 and project_id=$2 order by updated_ms desc, id limit $3`, [owner, id, MAX_PROJECT_FILES]);
    return { project: { ...project, fileCount: files.length }, files };
  });
}

export async function changeProjects(db: PlatformDb, owner: string, input: Record<string, unknown>) {
  return withAccountScope(db, owner, async (tx) => {
    const now = Date.now();
    if (input.action === 'create' || input.action === 'update') {
      const draft = parseProjectDraft(input.project);
      if (!draft) throw new ToolError('Choose a project name, description, instructions, color and icon within the shown limits.');
      const values = [draft.name, draft.description, draft.instructions, draft.color, draft.icon];
      if (input.action === 'create') {
        await tx.query('select id from xyvora_accounts where id=$1 for update', [owner]);
        const [{ count }] = await tx.query<{ count: number }>('select count(*)::int as count from xyvora_projects where account_id=$1', [owner]);
        if (count >= MAX_PROJECTS) throw new ToolError(`Save up to ${MAX_PROJECTS} projects. Delete an unused project first.`, 409);
        const [project] = await tx.query<Project>(`insert into xyvora_projects (account_id,id,name,description,instructions,color,icon,updated_ms)
          values ($1,$2,$3,$4,$5,$6,$7,$8) returning ${projectFields}, 0 as "fileCount"`, [owner, randomUUID(), ...values, now]);
        return { project };
      }
      const id = projectId(input.id);
      const existing = await projectById(tx, owner, id, true);
      if (input.updatedAt !== existing.updatedAt) throw new ToolError('This project changed on another device. Reload before saving.', 409);
      const [{ count }] = await tx.query<{ count: number }>('select count(*)::int as count from xyvora_project_files where account_id=$1 and project_id=$2', [owner, id]);
      const [project] = await tx.query<Project>(`update xyvora_projects set name=$3, description=$4, instructions=$5, color=$6, icon=$7, updated_ms=$8
        where account_id=$1 and id=$2 returning ${projectFields}, $9::int as "fileCount"`, [owner, id, ...values, Math.max(now, existing.updatedAt + 1), count]);
      return { project };
    }
    const id = projectId(input.id);
    if (input.action === 'delete') {
      const existing = await projectById(tx, owner, id, true);
      if (input.confirm !== 'DELETE' || input.updatedAt !== existing.updatedAt) throw new ToolError('Reload this project and confirm deletion.', 409);
      await tx.query('delete from xyvora_projects where account_id=$1 and id=$2', [owner, id]);
      return { removed: id };
    }
    if (input.action === 'upload-text') {
      const name = boundedProjectText(input.name, 120, true), text = boundedProjectText(input.text, MAX_PROJECT_FILE_TEXT);
      if (!name || !text || typeof input.truncated !== 'boolean') throw new ToolError('Choose a readable text extract within the file limits.');
      const existing = await projectById(tx, owner, id, true);
      const [{ count }] = await tx.query<{ count: number }>('select count(*)::int as count from xyvora_project_files where account_id=$1 and project_id=$2', [owner, id]);
      if (count >= MAX_PROJECT_FILES) throw new ToolError(`A project can hold up to ${MAX_PROJECT_FILES} file extracts.`, 409);
      const [file] = await tx.query<ProjectFile>(`insert into xyvora_project_files (account_id,project_id,id,name,body,truncated,updated_ms)
        values ($1,$2,$3,$4,$5,$6,$7) returning ${fileFields}`, [owner, id, randomUUID(), name, text, input.truncated, now]);
      await tx.query('update xyvora_projects set updated_ms=$3 where account_id=$1 and id=$2', [owner, id, Math.max(now, existing.updatedAt + 1)]);
      return { file };
    }
    if (input.action === 'remove-file') {
      const existing = await projectById(tx, owner, id, true);
      const [removed] = await tx.query<{ id: string }>('delete from xyvora_project_files where account_id=$1 and project_id=$2 and id=$3 returning id', [owner, id, projectId(input.file)]);
      if (!removed) throw new ToolError('Project file not found.', 404);
      await tx.query('update xyvora_projects set updated_ms=$3 where account_id=$1 and id=$2', [owner, id, Math.max(now, existing.updatedAt + 1)]);
      return { removed: removed.id };
    }
    throw new ToolError('Unknown project action.');
  });
}

const noise = new Set('about and are can find for from give have how into please show tell that the these this use what when where which who why will with would you your'.split(' '));
export async function loadProjectContext(db: PlatformDb, owner: string, id: string, prompt: string, includeFiles: boolean): Promise<ProjectContext> {
  return withAccountScope(db, owner, async (tx) => {
    const { instructions } = await projectById(tx, owner, id);
    if (!includeFiles) return { instructions, excerpts: [] };
    const terms = [...new Set(prompt.toLowerCase().match(/[\p{L}\p{N}]{2,25}/gu) ?? [])].filter((word) => !noise.has(word)).slice(0, 12);
    if (!terms.length) return { instructions, excerpts: [] };
    const rows = await tx.query<{ name: string; text: string }>(`select name,
      left(ts_headline('simple',body,q,'StartSel=[, StopSel=], MaxWords=34, MinWords=10, MaxFragments=1'), 650) as text
      from xyvora_project_files, websearch_to_tsquery('simple', $3) q
      where account_id=$1 and project_id=$2 and keywords @@ q order by ts_rank_cd(keywords,q) desc, id limit 3`, [owner, id, terms.map((term) => `"${term}"`).join(' OR ')]);
    return { instructions, excerpts: rows };
  });
}
