import { repositoryName, repositoryPath } from '../shared/repositories.ts';
import type { RepoEntry, RepoFile, RepoInfo, RepoIssue } from '../shared/repositories.ts';
import { asObject, providerData, shortText, ToolError } from './workspace-http.ts';

const api = 'https://api.github.com/repos/';
const maxFile = 24_000;
const size = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
export async function readRepository(input: Record<string, unknown>, signal: AbortSignal) {
  const repo = repositoryName(input.repo);
  if (!repo) throw new ToolError('Enter a public GitHub repository such as octocat/Hello-World.');
  const action = input.operation;
  const read = (tail: string, limit?: number) => providerData(api + repo + tail, signal, { headers: { 'User-Agent': 'Xyvora-Repository-Workbench', Accept: 'application/vnd.github+json' } }, { limit, timeout: 8_000 });
  if (action === 'overview') {
    const row = asObject(await read(''));
    const name = repositoryName(row.full_name);
    if (!name || row.private !== false) throw new ToolError('Only public GitHub repositories are supported.', 404);
    return { repo: { name, description: shortText(row.description, 700), branch: shortText(row.default_branch, 100), stars: size(row.stargazers_count), language: shortText(row.language, 50), openIssues: size(row.open_issues_count) } satisfies RepoInfo };
  }
  if (action === 'issues') {
    const rows = await read('/issues?state=open&sort=updated&per_page=8', 200_000);
    if (!Array.isArray(rows)) throw new ToolError('GitHub did not return an issue list.', 502);
    const issues: RepoIssue[] = rows.slice(0, 8).flatMap((item) => {
      const row = asObject(item), number = size(row.number);
      if (!number || row.pull_request) return [];
      return [{ number, title: shortText(row.title, 240), author: shortText(asObject(row.user).login, 45), url: `https://github.com/${repo}/issues/${number}` }];
    });
    return { issues };
  }
  const path = repositoryPath(input.path ?? '');
  const ref = typeof input.ref === 'string' && /^[a-z\d][a-z\d/_\-.]{0,99}$/i.test(input.ref) && !input.ref.includes('..') ? input.ref : '';
  if ((action !== 'files' && action !== 'file') || path === undefined || !ref || (action === 'file' && !path)) throw new ToolError('Choose a supported source path and branch.');
  const data = await read(`/contents${path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''}?ref=${encodeURIComponent(ref)}`, 550_000);
  if (action === 'files') {
    if (!Array.isArray(data)) throw new ToolError('Choose a directory to browse.');
    const entries: RepoEntry[] = data.flatMap((item) => {
      const row = asObject(item), file = repositoryPath(row.path);
      return file && (row.type === 'dir' || (row.type === 'file' && !row.submodule_git_url)) ? [{ name: shortText(row.name, 100), path: file, type: row.type, size: size(row.size) } as RepoEntry] : [];
    }).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    return { entries: entries.slice(0, 45), more: entries.length > 45 };
  }
  const file = asObject(data);
  if (file.type !== 'file' || file.submodule_git_url || file.path !== path || file.encoding !== 'base64' || size(file.size) > maxFile || typeof file.content !== 'string' || file.content.length > 34_000 || typeof file.sha !== 'string' || !/^[\da-f]{40}$/i.test(file.sha)) throw new ToolError('Choose a UTF-8 source file under 24 KB. Binaries are not supported.');
  let text: string;
  try {
    const bytes = Buffer.from(file.content, 'base64');
    if (bytes.length > maxFile) throw new Error('too large');
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('binary');
  } catch { throw new ToolError('That file is not readable UTF-8 text.'); }
  return { file: { path, text, sha: file.sha, ref } satisfies RepoFile };
}
