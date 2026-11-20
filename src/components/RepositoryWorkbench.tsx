import { ArrowDownToLine, ArrowLeft, ArrowUpRight, FileText, Folder, GitBranch, ListChecks, Paperclip, Search } from 'lucide-react';
import { createTwoFilesPatch } from 'diff';
import { useEffect, useRef, useState } from 'react';
import { EXAMPLE_REPO, repositoryName } from '../../shared/repositories.ts';
import type { RepoEntry, RepoFile, RepoInfo, RepoIssue, RepoWorkbenchDraft } from '../../shared/repositories.ts';
import type { TextAttachment } from '../../shared/models.ts';
import { approveTool } from '../lib/workspace-api.ts';

export function RepositoryWorkbench({ initial, workingCopy, onAttach }: { initial?: string; workingCopy?: RepoWorkbenchDraft; onAttach: (attachment: TextAttachment, draft: RepoWorkbenchDraft) => void }) {
  const restore = (!initial || repositoryName(initial)?.toLowerCase() === workingCopy?.repo.name.toLowerCase()) ? workingCopy : undefined;
  const [name, setName] = useState(restore?.repo.name ?? initial ?? EXAMPLE_REPO);
  const [repo, setRepo] = useState(restore?.repo);
  const [ref, setRef] = useState(restore?.ref ?? '');
  const [path, setPath] = useState(restore?.path ?? '');
  const [entries, setEntries] = useState(restore?.entries);
  const [more, setMore] = useState(restore?.more ?? false);
  const [issues, setIssues] = useState<RepoIssue[]>();
  const [file, setFile] = useState(restore?.file);
  const [edit, setEdit] = useState(restore?.edit ?? '');
  const [patch, setPatch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const job = useRef<AbortController | null>(null);
  const dirty = !!file && edit !== file.text;
  useEffect(() => () => job.current?.abort(), []);
  function call<T>(operation: string, data: object, done: (result: T) => void) {
    if (job.current) return;
    const controller = new AbortController(); job.current = controller;
    setBusy(true); setError('');
    void approveTool<T>({ action: 'repository', operation, repo: repo?.name ?? repositoryName(name), ...data }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) done(result); })
      .catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (job.current === controller) { job.current = null; setBusy(false); } });
  }
  function showDirectory(path: string) {
    if (dirty && !confirm('Discard the unsaved file edits?')) return;
    call<{ entries: RepoEntry[]; more: boolean }>('files', { path, ref }, (data) => { setPath(path); setEntries(data.entries); setMore(data.more); setIssues(undefined); setFile(undefined); setPatch(''); });
  }
  function openFile(entry: RepoEntry) {
    if (dirty && !confirm('Discard the unsaved file edits?')) return;
    call<{ file: RepoFile }>('file', { path: entry.path, ref }, ({ file }) => { setFile(file); setEdit(file.text); setPatch(''); });
  }
  function download() {
    const url = URL.createObjectURL(new Blob([patch], { type: 'text/x-diff;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'xyvora-repository.patch'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 750);
  }
  return <div className="plugin-fields">
    <p className="plugin-notice"><GitBranch size={17} /> Browse public GitHub repos with approved reads. Nothing is written to GitHub. Edit a local copy, review a diff, and download it for your own branch.</p>
    <form className="plugin-fields" onSubmit={(event) => {
      event.preventDefault();
      if (!repositoryName(name) || (dirty && !confirm('Discard the unsaved file edits?'))) return;
      call<{ repo: RepoInfo }>('overview', { repo: repositoryName(name) }, ({ repo }) => { setRepo(repo); setName(repo.name); setRef(repo.branch); setPath(''); setEntries(undefined); setIssues(undefined); setFile(undefined); setPatch(''); });
    }}>
      <label className="field-label">Repository<input data-dialog-focus className="plugin-input" value={name} maxLength={250} spellCheck={false} disabled={busy} onChange={({ target }) => setName(target.value)} placeholder={EXAMPLE_REPO} /></label>
      <div className="plugin-run-row"><button type="submit" className="plugin-primary" disabled={busy || !repositoryName(name)}><Search size={15} /> {busy ? 'Reading…' : 'Approve & open repo'}</button>{busy && <button type="button" className="secondary-button" onClick={() => job.current?.abort()}>Stop</button>}</div>
    </form>
    {error && <p className="plugin-error" role="alert">{error}</p>}
    {repo && <>
      <div className="repo-heading"><a href={`https://github.com/${repo.name}`} target="_blank" rel="noopener noreferrer">{repo.name} <ArrowUpRight size={14} /></a><p>{repo.description || 'Public GitHub repository'}</p><small>{repo.language || 'Code'} · {repo.stars.toLocaleString()} stars · {repo.openIssues.toLocaleString()} open issues / PRs</small></div>
      <label className="field-label">Branch<input className="plugin-input" value={ref} maxLength={100} disabled={busy || !!file} onChange={({ target }) => { setRef(target.value); setEntries(undefined); }} /></label>
      <div className="plugin-run-row">
        <button className="secondary-button" type="button" onClick={() => showDirectory('')} disabled={busy || !ref}><Folder size={15} /> Read files</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => {
          if (dirty && !confirm('Discard the unsaved file edits?')) return;
          call<{ issues: RepoIssue[] }>('issues', {}, ({ issues }) => { setIssues(issues); setFile(undefined); setPatch(''); setEntries(undefined); });
        }}><ListChecks size={15} /> Read recent issues</button>
      </div>
      {issues && <ul className="repo-list">{issues.length ? issues.map((issue) => <li key={issue.number}><a href={issue.url} target="_blank" rel="noopener noreferrer">#{issue.number} {issue.title}</a></li>) : <li>No open issues in this sample.</li>}</ul>}
      {entries && !file && <div className="plugin-output">
        <div className="repo-path"><strong>{path || '/'}</strong>{path && <button type="button" className="text-button" disabled={busy} onClick={() => showDirectory(path.split('/').slice(0, -1).join('/'))}><ArrowLeft size={14} /> Up</button>}</div>
        <ul className="repo-list">{entries.map((entry) => <li key={entry.path}><button type="button" className="repo-entry" disabled={busy || (entry.type === 'file' && entry.size > 24_000)} onClick={() => entry.type === 'dir' ? showDirectory(entry.path) : openFile(entry)}>
          {entry.type === 'dir' ? <Folder size={15} /> : <FileText size={15} />}<span>{entry.name}</span>{entry.type === 'file' && <small>{(entry.size / 1_000).toFixed(1)} KB</small>}</button></li>)}</ul>
        {more && <p className="form-hint">Showing the first 45 supported entries.</p>}
      </div>}
      {file && <>
        <div className="repo-path"><strong>{file.path}</strong><button type="button" className="text-button" onClick={() => { if (!dirty || confirm('Discard the unsaved file edits?')) { setFile(undefined); setPatch(''); } }}>Back to files</button></div>
        <label className="field-label">Local file draft<textarea className="plugin-input plugin-code" rows={10} spellCheck={false} maxLength={26_000} value={edit} onChange={({ target }) => { setEdit(target.value); setPatch(''); }} /></label>
        <div className="plugin-run-row">
          <button className="secondary-button" type="button" disabled={!edit.trim()} onClick={() => onAttach({ name: file.path.split('/').at(-1)!.slice(0, 100), text: edit }, { repo, ref, path, entries, more, file, edit })}><Paperclip size={15} /> Attach to chat</button>
          <button className="secondary-button" type="button" disabled={!dirty} onClick={() => {
            const diff = createTwoFilesPatch(`a/${file.path}`, `b/${file.path}`, file.text, edit, '', '', { context: 3, timeout: 250 });
            if (diff) { setPatch(diff); setError(''); } else setError('This change is too large to preview. Try a smaller edit.');
          }}>Review patch</button>
        </div>
        <p className="form-hint">Attaching only prepares a draft. Nothing is sent to AI until you send a message. Large files become excerpts. Reopen GitHub projects to return to the attached working copy.</p>
        {patch && <div className="plugin-output"><pre tabIndex={0}>{patch}</pre><div className="plugin-run-row"><button className="plugin-primary" type="button" onClick={download}><ArrowDownToLine size={15} /> Download patch</button></div></div>}
      </>}
    </>}
  </div>;
}
