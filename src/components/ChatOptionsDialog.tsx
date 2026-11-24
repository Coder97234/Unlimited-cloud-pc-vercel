import { chatTitle } from '../../shared/history.ts';
import { Archive, ArchiveRestore, Copy, Pin, PinOff, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Project } from '../../shared/projects.ts';
import type { Thread } from '../lib/history.ts';
import { Dialog } from './Dialog.tsx';

export function ChatOptionsDialog({ thread, projects, canDuplicate, onSave, onDuplicate, onDelete, onClose }: {
  thread: Thread; projects?: Project[]; canDuplicate: boolean; onSave: (next: Partial<Thread>) => void;
  onDuplicate: () => void; onDelete: () => void; onClose: () => void;
}) {
  const [title, setTitle] = useState(thread.title);
  const [projectId, setProjectId] = useState(projects?.some((project) => project.id === thread.projectId) ? thread.projectId ?? '' : '');
  return <Dialog title="Chat options" subtitle={thread.title} onClose={onClose}>
    <form className="project-form" onSubmit={(event) => { event.preventDefault(); const name = chatTitle(title); if (!name) return; onSave({ title: name, ...(projects && { projectId: projectId || undefined }) }); }}>
      <label className="field-label">Chat title<input className="plugin-input" value={title} required maxLength={100} data-dialog-focus onChange={(event) => setTitle(event.target.value)} /></label>
      {projects && <label className="field-label">Project<select className="plugin-input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
        <option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>}
      <div className="dialog-actions"><button type="submit" className="primary-button" disabled={!chatTitle(title)}>Save changes</button></div>
    </form>
    <div className="chat-option-actions" aria-label="Conversation actions">
      <button type="button" className="secondary-button" onClick={() => onSave({ pinned: thread.pinned ? undefined : true })}>{thread.pinned ? <PinOff size={15} /> : <Pin size={15} />}{thread.pinned ? 'Unpin chat' : 'Pin chat'}</button>
      <button type="button" className="secondary-button" onClick={() => onSave({ favorite: thread.favorite ? undefined : true })}><Star size={15} />{thread.favorite ? 'Remove favorite' : 'Favorite chat'}</button>
      <button type="button" className="secondary-button" onClick={() => onSave({ archived: thread.archived ? undefined : true })}>{thread.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}{thread.archived ? 'Restore chat' : 'Archive chat'}</button>
      {canDuplicate && <button type="button" className="secondary-button" onClick={onDuplicate}><Copy size={15} /> Duplicate chat</button>}
      <button type="button" className="danger-button" onClick={onDelete}><Trash2 size={15} /> Delete chat</button>
    </div>
  </Dialog>;
}
