import { isProjectId, parseProjectDraft } from '../../shared/projects.ts';
import type { Project, ProjectFile } from '../../shared/projects.ts';
import { accountJson, notifyAccountChange } from './account.ts';

export const projectChangeKey = (id: string) => `xyvora.projects.changed.${id}`;
const endpoint = '?section=projects';
function projectFrom(raw: Project): Project {
  const draft = parseProjectDraft(raw);
  if (!draft || !isProjectId(raw.id) || !Number.isFinite(raw.updatedAt) || !Number.isInteger(raw.fileCount)) throw new Error('Could not read your project.');
  return { ...draft, id: raw.id, updatedAt: raw.updatedAt, fileCount: raw.fileCount };
}
function fileFrom(raw: ProjectFile): ProjectFile {
  if (!isProjectId(raw?.id) || typeof raw.name !== 'string' || typeof raw.truncated !== 'boolean' || !Number.isFinite(raw.updatedAt) || !Number.isInteger(raw.characters)) throw new Error('Could not read the project file.');
  return raw;
}
export async function listProjects(account: string, signal: AbortSignal): Promise<Project[]> {
  const { projects } = await accountJson(endpoint, signal, undefined, account);
  return projects.map(projectFrom);
}
export async function readProject(account: string, id: string, signal: AbortSignal): Promise<{ project: Project; files: ProjectFile[] }> {
  const { project, files } = await accountJson(`${endpoint}&project=${encodeURIComponent(id)}`, signal, undefined, account);
  return { project: projectFrom(project), files: files.map(fileFrom) };
}
export async function readProjectFile(account: string, id: string, fileId: string, signal: AbortSignal): Promise<ProjectFile & { text: string }> {
  const { file } = await accountJson(`${endpoint}&project=${encodeURIComponent(id)}&file=${encodeURIComponent(fileId)}`, signal, undefined, account);
  if (typeof file?.text !== 'string') throw new Error('Could not open the project file.');
  return { ...fileFrom(file), text: file.text };
}
export async function searchProjectFiles(account: string, query: string, signal: AbortSignal): Promise<{ projectId: string; id: string; name: string }[]> {
  const { files } = await accountJson(`${endpoint}&q=${encodeURIComponent(query)}`, signal, undefined, account);
  return files;
}
export async function updateProject(account: string, data: Record<string, unknown>, signal: AbortSignal) {
  const result = await accountJson(endpoint, signal, data, account);
  notifyAccountChange(projectChangeKey(account));
  return result;
}
