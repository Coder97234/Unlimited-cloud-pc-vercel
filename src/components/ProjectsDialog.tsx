import { ArrowLeft, BookOpen, Code2, FileText, Folder, Paperclip, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { emptyProject, MAX_PROJECT_FILES, MAX_PROJECT_INSTRUCTIONS, MAX_PROJECTS, PROJECT_COLORS, PROJECT_ICONS } from '../../shared/projects.ts';
import type { Project, ProjectDraft, ProjectFile } from '../../shared/projects.ts';
import type { Thread } from '../lib/history.ts';
import { listLibrary } from '../lib/library.ts';
import { ACCEPTED_FILES, readLocalFile } from '../lib/files.ts';
import { readProject, readProjectFile, updateProject } from '../lib/projects.ts';
import { Dialog } from './Dialog.tsx';

const icons = { folder: Folder, book: BookOpen, code: Code2, spark: Sparkles };
export function ProjectIcon({ project }: { project: Pick<Project, 'icon' | 'color'> }) {
  const Icon = icons[project.icon];
  return <span className={`project-icon project-${project.color}`}><Icon size={17} aria-hidden="true" /></span>;
}

type Screen = { kind: 'index' | 'create' } | { kind: 'detail'; id: string; file?: string };
type Detail = { project: Project; files: ProjectFile[] };
export function ProjectsDialog({ account, projects, initialId, initialFile, error: listError, threads, library, onBackToList, onChanged, onRemove, onStart, onChat, onClose }: {
  account: string; projects?: Project[]; initialId?: string; initialFile?: string; error: string; threads: Thread[]; library: boolean;
  onBackToList: () => void; onChanged: (project?: Project) => void; onRemove: (id: string) => void; onStart: (project: Project) => void;
  onChat: (chat: Thread) => void; onClose: () => void;
}) {
  const [screen, setScreen] = useState<Screen>(initialId ? { kind: 'detail', id: initialId, file: initialFile } : { kind: 'index' });
  const [details, setDetails] = useState<Detail>();
  const [draft, setDraft] = useState<ProjectDraft>(emptyProject);
  const [projectChats, setProjectChats] = useState<{ id: string; chats: Thread[]; next: string | null }>();
  const [chatError, setChatError] = useState('');
  const [moreBusy, setMoreBusy] = useState(false);
  const [preview, setPreview] = useState<ProjectFile & { text: string }>();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'project' } | { kind: 'file'; file: ProjectFile }>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [working, setWorking] = useState(false);
  const [reload, setReload] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | undefined>(undefined);
  const projectId = screen.kind === 'detail' ? screen.id : undefined;
  const initialPreview = screen.kind === 'detail' ? screen.file : undefined;
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    readProject(account, projectId, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setDetails(value); setDraft(value.project); }
    }).catch((problem) => { if (!controller.signal.aborted) setError(problem.message); });
    return () => controller.abort();
  }, [account, projectId, reload]);
  useEffect(() => {
    if (!projectId || !initialPreview) return;
    const controller = new AbortController();
    readProjectFile(account, projectId, initialPreview, controller.signal).then((value) => {
      if (!controller.signal.aborted) setPreview(value);
    }).catch((problem) => { if (!controller.signal.aborted) setError(problem.message); });
    return () => controller.abort();
  }, [account, projectId, initialPreview]);
  useEffect(() => {
    if (!projectId || !library) return;
    const controller = new AbortController();
    listLibrary(account, controller.signal, { project: projectId, filter: 'all' }).then(({ entries, next }) => {
      if (!controller.signal.aborted) setProjectChats({ id: projectId, chats: entries.map(({ chat }) => chat), next });
    }).catch(() => { if (!controller.signal.aborted) setChatError('Could not load project chats. Reload the project to try again.'); });
    return () => controller.abort();
  }, [account, library, projectId, reload]);
  function navigate(next: Screen) {
    if (request.current) return;
    setDetails(undefined); setPreview(undefined); setProjectChats(undefined); setChatError(''); setError(''); setStatus(''); setConfirm(undefined); setEditing(false); setDraft(emptyProject()); setScreen(next);
    if (next.kind === 'index') onBackToList();
  }
  function refresh() { setReload((value) => value + 1); }
  async function perform(work: (signal: AbortSignal) => Promise<void>) {
    if (request.current) return;
    const controller = request.current = new AbortController();
    setError(''); setStatus(''); setWorking(true);
    try { await work(controller.signal); }
    catch (problem) { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'Could not complete this action.'); }
    finally { if (!controller.signal.aborted) { request.current = undefined; setWorking(false); } }
  }
  async function save() {
    await perform(async (signal) => {
      const result = await updateProject(account, projectId && details ? { action: 'update', id: projectId, updatedAt: details.project.updatedAt, project: draft }
        : { action: 'create', project: draft }, signal);
      signal.throwIfAborted();
      onChanged(result.project); setEditing(false); setConfirm(undefined);
      setScreen({ kind: 'detail', id: result.project.id });
      setStatus(projectId ? 'Project saved.' : 'Project created.'); refresh();
    });
  }
  function upload(items: File[]) {
    if (!details || !projectId || !items.length) return;
    const room = MAX_PROJECT_FILES - details.files.length;
    if (items.length > room) { setError(`This project has room for ${room} more file extracts.`); return; }
    void perform(async (signal) => {
      let saved = 0;
      const errors: string[] = [];
      for (const item of items) {
        try {
          const { name, text, truncated } = await readLocalFile(item, signal);
          await updateProject(account, { action: 'upload-text', id: projectId, name, text, truncated }, signal);
          signal.throwIfAborted(); saved++;
        } catch (problem) { signal.throwIfAborted(); errors.push(problem instanceof Error ? problem.message : 'Could not save this extract.'); }
      }
      if (saved) { setStatus(`${saved} file ${saved === 1 ? 'extract' : 'extracts'} saved.`); onChanged(); refresh(); }
      if (errors.length) setError(errors.join(' '));
    });
  }
  const selected = details?.project;
  const listed = library ? (projectChats?.id === selected?.id ? projectChats?.chats : undefined) : threads.filter(({ projectId }) => projectId === selected?.id);
  const title = screen.kind === 'create' ? 'New project' : selected?.name ?? 'Projects';
  return <Dialog title={title} subtitle={screen.kind === 'index' ? 'Organize private chats and reference files in your account.' : screen.kind === 'create' ? 'Create a private space for related conversations.' : selected?.description} className="project-dialog" onClose={onClose}>
    {screen.kind !== 'index' && <button className="secondary-button" type="button" disabled={working} onClick={() => navigate({ kind: 'index' })}><ArrowLeft size={15} /> All projects</button>}
    {(error || (screen.kind === 'index' && listError)) && <div className="project-status" role="alert">{error || listError}{screen.kind === 'index' && <button type="button" className="text-button" onClick={onBackToList}>Retry</button>}</div>}
    {status && <p className="project-status" role="status">{status}</p>}
    {screen.kind === 'index' && <>
      <div className="project-index-actions"><button type="button" className="primary-button" disabled={projects === undefined || projects.length >= MAX_PROJECTS} onClick={() => navigate({ kind: 'create' })}><Plus size={16} /> New project</button></div>
      {projects === undefined ? !listError && <p role="status">Loading your projects…</p> : projects.length === 0 ? <div className="project-empty"><Folder size={22} /><strong>No projects yet</strong><p>Group conversations with their own instructions and reference text.</p></div> : <ul className="project-list">{projects.map((project) => <li key={project.id}>
        <button type="button" className="project-tile" onClick={() => navigate({ kind: 'detail', id: project.id })}><ProjectIcon project={project} /><span><strong>{project.name}</strong><small>{project.fileCount} {project.fileCount === 1 ? 'file' : 'files'}{project.description ? ` · ${project.description}` : ''}</small></span></button>
      </li>)}</ul>}
    </>}
    {screen.kind === 'detail' && !selected && (error ? <button className="secondary-button" type="button" onClick={() => { setError(''); refresh(); }}>Reload project</button> : <p className="project-status" role="status">Opening project…</p>)}
    {(editing || screen.kind === 'create') && <form className="project-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="field-label">Name<input className="plugin-input" required maxLength={72} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="field-label">Description<textarea className="plugin-input" rows={2} maxLength={320} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <label className="field-label">Instructions<textarea className="plugin-input" rows={4} maxLength={MAX_PROJECT_INSTRUCTIONS} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></label>
      <div className="project-form-pair"><label className="field-label">Color<select className="plugin-input" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value as ProjectDraft['color'] })}>{PROJECT_COLORS.map((color) => <option key={color}>{color}</option>)}</select></label>
        <label className="field-label">Icon<select className="plugin-input" value={draft.icon} onChange={(event) => setDraft({ ...draft, icon: event.target.value as ProjectDraft['icon'] })}>{PROJECT_ICONS.map((icon) => <option key={icon}>{icon}</option>)}</select></label></div>
      <div className="dialog-actions">{selected && <button className="secondary-button" type="button" disabled={working} onClick={() => { setDraft(selected); setEditing(false); setError(''); }}>Cancel edit</button>}<button type="submit" className="primary-button" disabled={working || !draft.name.trim()}>{working ? 'Saving…' : 'Save project'}</button></div>
    </form>}
    {selected && details && !editing && <>
      <div className="project-detail-actions"><button type="button" className="primary-button" disabled={working} onClick={() => onStart(selected)}><Plus size={16} /> New project chat</button>
        <button type="button" className="secondary-button" disabled={working} onClick={() => setEditing(true)}>Edit project</button></div>
      {selected.instructions && <details className="project-instructions"><summary>Project instructions</summary><p>{selected.instructions}</p></details>}
      <section className="settings-section"><h3>Chats</h3>
        {listed?.length ? <div className="search-results">{listed.map((chat) => <button type="button" key={chat.id} className="search-result" onClick={() => onChat(chat)}>{chat.title}</button>)}</div>
          : <p className="form-hint">{chatError || (listed ? 'No chats in this project yet.' : 'Loading project chats…')}</p>}
        {library && projectChats?.next && <button className="secondary-button" type="button" disabled={moreBusy || working} onClick={() => void perform(async (signal) => {
          setMoreBusy(true);
          try {
            const { entries, next } = await listLibrary(account, signal, { project: selected.id, filter: 'all', older: projectChats.next ?? undefined });
            if (!signal.aborted) setProjectChats({ id: selected.id, next, chats: [...projectChats.chats, ...entries.filter(({ chat }) => !projectChats.chats.some(({ id }) => id === chat.id)).map(({ chat }) => chat)] });
          } finally { if (!signal.aborted) setMoreBusy(false); }
        })}>{moreBusy ? 'Loading…' : 'More project chats'}</button>}
      </section>
      <section className="settings-section"><h3>Reference files</h3><p className="form-hint">Text, readable PDF, Word, and Excel files, up to 4 MB each. Only extracted text is saved, not the original.</p>
        <button className="project-drop" type="button" disabled={working || details.files.length >= MAX_PROJECT_FILES} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!working) upload(Array.from(event.dataTransfer.files)); }} onClick={() => fileInput.current?.click()}><Paperclip size={17} /> {details.files.length >= MAX_PROJECT_FILES ? 'File limit reached' : working ? 'Working…' : 'Drop files here or browse'}</button>
        <input type="file" hidden ref={fileInput} multiple accept={ACCEPTED_FILES} onChange={(event) => { upload(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        <ul className="project-list">{details.files.map((file) => <li key={file.id} className="project-file-row">
          <button type="button" className="project-tile" disabled={working} onClick={() => void perform(async (signal) => { const item = await readProjectFile(account, selected.id, file.id, signal); if (!signal.aborted) setPreview(item); })}><FileText size={16} /><span><strong>{file.name}</strong><small>{file.characters.toLocaleString()} characters{file.truncated ? ' · excerpt' : ''}</small></span></button>
          <button type="button" className="icon-button" disabled={working} aria-label={`Remove ${file.name}`} onClick={() => setConfirm({ kind: 'file', file })}><Trash2 size={15} /></button>
        </li>)}</ul>
        {preview && <div className="project-preview"><header><strong>{preview.name}</strong><button type="button" className="secondary-button" onClick={() => setPreview(undefined)}>Close preview</button></header><pre tabIndex={0}>{preview.text}</pre></div>}
      </section>
      <button type="button" className="danger-button" disabled={working || !!confirm} onClick={() => setConfirm({ kind: 'project' })}>Delete project</button>
      {confirm && <div className="confirm-box"><p>{confirm.kind === 'project' ? 'Delete this project and its extracts? Chats remain in your history. Past replies may contain text from these files.' : `Remove ${confirm.file.name} from this project?`}</p><div>
        <button type="button" className="secondary-button" disabled={working} onClick={() => setConfirm(undefined)}>Cancel</button>
        <button type="button" className="danger-button" disabled={working} onClick={() => void perform(async (signal) => {
          if (confirm.kind === 'project') {
            await updateProject(account, { action: 'delete', id: selected.id, updatedAt: selected.updatedAt, confirm: 'DELETE' }, signal);
            signal.throwIfAborted(); onRemove(selected.id); setDetails(undefined); setPreview(undefined); setScreen({ kind: 'index' }); setStatus('Project deleted.');
          } else {
            await updateProject(account, { action: 'remove-file', id: selected.id, file: confirm.file.id }, signal);
            signal.throwIfAborted(); setPreview((item) => item?.id === confirm.file.id ? undefined : item); onChanged(); setStatus('File removed.'); refresh();
          }
          setConfirm(undefined);
        })}>Confirm {confirm.kind === 'project' ? 'deletion' : 'removal'}</button>
      </div></div>}
      {error && <button className="text-button" type="button" disabled={working} onClick={() => { setError(''); setConfirm(undefined); refresh(); }}>Reload project</button>}
    </>}
  </Dialog>;
}
