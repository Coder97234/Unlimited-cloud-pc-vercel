import { randomUUID } from 'node:crypto';
import { isAccountId } from '../shared/account.ts';
import { isThreadId, parseCloudThreads } from '../shared/history.ts';
import type { Thread } from '../shared/history.ts';
import { LIBRARY_MAX_BYTES, LIBRARY_MAX_CHAT_BYTES, LIBRARY_MAX_CHATS, LIBRARY_PAGE, olderCursor, parseLibraryChat } from '../shared/library.ts';
import type { LibraryEntry } from '../shared/library.ts';
import { boundedProjectText, isProjectId } from '../shared/projects.ts';
import type { PlatformDb, PlatformQuery, SqlValues } from './database.ts';
import { withAccountScope } from './projects.ts';
import { ToolError } from './workspace-http.ts';

const fields = `id,title,revision,mode,project_id as "projectId",updated_ms::float8 as "updatedAt",pinned,favorite,archived`;
type ChatRow = Omit<Thread, 'pinned' | 'favorite' | 'archived' | 'projectId' | 'turns'> & { projectId: string | null; pinned: boolean; favorite: boolean; archived: boolean; revision: string; turns?: unknown; match?: LibraryEntry['match'] };
function entry(row: ChatRow): LibraryEntry {
  const { revision, match, ...raw } = row;
  const chat = raw.turns === undefined ? {
    id: raw.id, title: raw.title, mode: raw.mode, updatedAt: raw.updatedAt, turns: [],
    ...(raw.projectId && { projectId: raw.projectId }), ...(raw.pinned && { pinned: true as const }),
    ...(raw.favorite && { favorite: true as const }), ...(raw.archived && { archived: true as const }),
  } : parseLibraryChat(raw);
  if (!chat) throw new Error('Invalid saved conversation');
  return { revision, chat, ...(match && { match }) };
}
const timed = (time: number) => Math.max(0, Math.min(Date.now(), Math.floor(time)));

async function writeRow(tx: PlatformQuery, owner: string, chat: Thread, revision: string, time: number) {
  const [row] = await tx.query<ChatRow>(`insert into xyvora_chats(account_id,id,revision,title,mode,updated_ms,project_id,pinned,favorite,archived,turns)
    values ($1,$2,$3,$4,$5,$6,(select id from xyvora_projects where account_id=$1 and id=$7),$8,$9,$10,$11::jsonb)
    on conflict (account_id,id) do update set revision=excluded.revision,title=excluded.title,mode=excluded.mode,updated_ms=excluded.updated_ms,
    project_id=excluded.project_id,pinned=excluded.pinned,favorite=excluded.favorite,archived=excluded.archived,turns=excluded.turns returning ${fields},turns`,
  [owner, chat.id, revision, chat.title, chat.mode, time, chat.projectId ?? null, !!chat.pinned, !!chat.favorite, !!chat.archived, JSON.stringify(chat.turns)]);
  return entry(row);
}
async function seed(tx: PlatformQuery, owner: string) {
  const [library] = await tx.query<{ revision: string }>('select revision from xyvora_library where account_id=$1', [owner]);
  if (library) return library.revision;
  const revision = randomUUID();
  // Competes with even OLD deployed code's INSERT or UPDATE on this row.
  // The row lock prevents an unobserved write between reading and freezing it.
  await tx.query(`insert into xyvora_cloud_history(account_id,revision,chats) values ($1,$2,'[]') on conflict do nothing`, [owner, revision]);
  const [snapshot] = await tx.query<{ chats: unknown; migrated: boolean }>('select chats,migrated from xyvora_cloud_history where account_id=$1 for update', [owner]);
  if (snapshot?.migrated) {
    const [ready] = await tx.query<{ revision: string }>('select revision from xyvora_library where account_id=$1', [owner]);
    if (!ready) throw new Error('Incomplete history migration');
    return ready.revision;
  }
  const chats = parseCloudThreads(snapshot?.chats);
  if (!chats) throw new ToolError('Your older chats could not be migrated. No data was changed.', 409);
  await tx.query('insert into xyvora_library(account_id,revision) values ($1,$2)', [owner, revision]);
  for (const chat of chats) await writeRow(tx, owner, chat, randomUUID(), timed(chat.updatedAt));
  await tx.query(`update xyvora_cloud_history set chats='[]',revision=$2,migrated=true where account_id=$1`, [owner, revision]);
  return revision;
}

function cursor(value: string | null) {
  if (value === null) return;
  if (/^[A-Za-z0-9_-]{1,350}$/.test(value)) try {
    const parsed = olderCursor(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (parsed) return parsed;
  } catch { /* Invalid cursor. */ }
  throw new ToolError('Reload this page of conversations.');
}
export async function readLibrary(db: PlatformDb, owner: string, url: URL) {
  return withAccountScope(db, owner, async (tx) => {
    const revision = await seed(tx, owner);
    const id = url.searchParams.get('id');
    if (id !== null) {
      if (!isThreadId(id)) throw new ToolError('Choose a valid conversation.');
      const [row] = await tx.query<ChatRow>(`select ${fields},turns from xyvora_chats where account_id=$1 and id=$2`, [owner, id]);
      if (!row) throw new ToolError('Conversation not found.', 404);
      return { entry: entry(row) };
    }
    const project = url.searchParams.get('project'), query = url.searchParams.get('q'), filter = url.searchParams.get('filter') ?? 'recent';
    const old = cursor(url.searchParams.get('older'));
    const params: SqlValues = [owner];
    const condition = ['account_id=$1'];
    if (project !== null) {
      if (!isProjectId(project)) throw new ToolError('Choose a valid project.');
      condition.push(`project_id=$${params.push(project)}`);
    }
    if (filter === 'archive') condition.push("(archived or mode='compare')");
    else if (filter === 'favorite') condition.push('favorite');
    else if (filter === 'recent') condition.push('not archived');
    else if (filter !== 'all') throw new ToolError('Choose a valid history filter.');
    let searchIndex = 0;
    if (query !== null) {
      const q = boundedProjectText(query, 100, true);
      if (!q) throw new ToolError('Enter a conversation search query.');
      const idx = searchIndex = params.push(q);
      condition.push(`(strpos(lower(title),lower($${idx})) > 0 or keywords @@ websearch_to_tsquery('simple',$${idx}))`);
    }
    if (old) {
      const i = params.length + 1;
      params.push(...old);
      condition.push(`(pinned,updated_ms,id) < ($${i},$${i+1},$${i+2})`);
    }
    const sql = `select ${fields}${searchIndex ? ', turns, updated_ms' : ''} from xyvora_chats
      where ${condition.join(' and ')} order by pinned desc,updated_ms desc,id desc limit ${LIBRARY_PAGE+1}`;
    const rows = await tx.query<ChatRow>(searchIndex ? `with page as (${sql}) select id,title,revision,mode,"projectId","updatedAt",pinned,favorite,archived,
      (select jsonb_build_object('turnId',turn->>'id','text',left(ts_headline('simple', content, q,
        'StartSel=[, StopSel=], MaxWords=22, MinWords=8, MaxFragments=1'),260))
        from jsonb_array_elements(page.turns) as turn
        cross join lateral (select concat_ws(' ',turn->>'prompt', (select string_agg(answer->>'content',' ')
          from jsonb_array_elements(turn->'answers') as answer)) as content) t
        cross join websearch_to_tsquery('simple',$${searchIndex}) q
        where to_tsvector('simple',content) @@ q limit 1) as match
      from page order by pinned desc,updated_ms desc,id desc` : sql, params);
    const last = rows.length > LIBRARY_PAGE ? rows[LIBRARY_PAGE-1] : undefined;
    const next = last ? Buffer.from(JSON.stringify([last.pinned, last.updatedAt, last.id])).toString('base64url') : null;
    const [{ total }] = await tx.query<{ total: number }>('select count(*)::int as total from xyvora_chats where account_id=$1', [owner]);
    return { revision, entries: rows.slice(0, LIBRARY_PAGE).map(entry), next, total };
  });
}

export async function changeLibrary(db: PlatformDb, owner: string, input: Record<string, unknown>) {
  return withAccountScope(db, owner, async (tx) => {
    await seed(tx, owner);
    const [{ revision }] = await tx.query<{ revision: string }>('select revision from xyvora_library where account_id=$1 for update', [owner]);
    const fresh = randomUUID();
    if (input.action === 'clear') {
      if (input.confirm !== 'DELETE' || input.revision !== revision) throw new ToolError('Your history changed. Reload it before clearing all conversations.', 409);
      await tx.query('delete from xyvora_chats where account_id=$1', [owner]);
      await tx.query('update xyvora_library set revision=$2 where account_id=$1', [owner, fresh]);
      return { cleared: true, revision: fresh, total: 0 };
    }
    if (!isThreadId(input.id) || (input.expected !== null && !isAccountId(input.expected))) throw new ToolError('Choose a valid conversation and version.');
    const id = input.id;
    const [current] = await tx.query<ChatRow & { bytes: number }>(`select ${fields},bytes,turns from xyvora_chats where account_id=$1 and id=$2 for update`, [owner, id]);
    const [{ total, size }] = await tx.query<{ total: number; size: number }>('select count(*)::int as total,coalesce(sum(bytes),0)::float8 as size from xyvora_chats where account_id=$1', [owner]);
    if (input.action === 'remove' && !current) return { entry: null, revision, total };
    if (input.action !== 'remove' && input.action !== 'save') throw new ToolError('Unknown conversation action.');
    let chat: Thread | undefined;
    if (input.action === 'save') {
      chat = parseLibraryChat(input.chat);
      if (!chat || chat.id !== id) throw new ToolError('The conversation is invalid.');
      if (Buffer.byteLength(JSON.stringify(chat.turns)) > LIBRARY_MAX_CHAT_BYTES) throw new ToolError('This chat is too large to sync. Export it and start a new conversation.', 413);
    }
    if ((current?.revision ?? null) !== input.expected) {
      const actual = current ? entry(current) : null;
      // A connection can disappear after commit. An identical replay is safe,
      // but never resurrect a conversation deleted on another device.
      if (chat && actual && JSON.stringify({ ...chat, updatedAt: 0 }) === JSON.stringify({ ...actual.chat, updatedAt: 0 })) return { entry: actual, revision, total };
      return { conflict: true, entry: actual, revision, total };
    }
    let saved: LibraryEntry | null = null;
    if (chat) {
      // Account and row caps cover both ordinary edits and abusive large files.
      const [{ bytes }] = await tx.query<{ bytes: number }>('select octet_length($1::jsonb::text) as bytes', [JSON.stringify(chat.turns)]);
      if (bytes > 2_000_000 || size - (current?.bytes ?? 0) + bytes > LIBRARY_MAX_BYTES || (!current && total >= LIBRARY_MAX_CHATS)) {
        throw new ToolError('The conversation library is full. Export and remove some conversations before saving.', 413);
      }
      saved = await writeRow(tx, owner, chat, fresh, Math.max(Date.now(), (current?.updatedAt ?? 0) + 1));
    } else await tx.query('delete from xyvora_chats where account_id=$1 and id=$2', [owner, id]);
    await tx.query('update xyvora_library set revision=$2 where account_id=$1', [owner, fresh]);
    return { entry: saved, revision: fresh, total: total + (chat ? current ? 0 : 1 : -1) };
  });
}
