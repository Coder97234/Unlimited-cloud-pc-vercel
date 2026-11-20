export type RepoInfo = { name: string; description: string; branch: string; stars: number; language: string; openIssues: number };
export type RepoEntry = { name: string; path: string; type: 'dir' | 'file'; size: number };
export type RepoIssue = { number: number; title: string; author: string; url: string };
export type RepoFile = { path: string; text: string; sha: string; ref: string };
// A working copy stays in React state. It is not persisted or sent on close.
export type RepoWorkbenchDraft = { repo: RepoInfo; ref: string; path: string; entries?: RepoEntry[]; more: boolean; file: RepoFile; edit: string };
export const EXAMPLE_REPO = 'octocat/Hello-World';

export function repositoryName(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 250) return;
  const match = /^(?:https:\/\/github\.com\/)?([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d_.-]{1,100})\/?$/i.exec(raw.trim());
  if (!match || match[2] === '.' || match[2] === '..') return;
  return `${match[1]}/${match[2]}`;
}
export function repositoryPath(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 360 || raw.split('/').length > 16) return;
  if (!raw) return '';
  return raw.split('/').every((part) => /^[a-z\d._@ +()\[\]-]{1,100}$/i.test(part) && !['.', '..', '.git'].includes(part.toLowerCase()) && !/^\.env(?:\.|$)|^id_(?:rsa|ed25519)$|\.(?:pem|key|p12)$/i.test(part)) ? raw : undefined;
}
