import {
  Clock3, Columns2, FolderOpen, Globe, MessageSquare, PanelLeftClose, Plus, Search, Settings2, Trash2,
} from 'lucide-react';
import type { Availability } from '../../shared/models.ts';
import type { Thread } from '../lib/history.ts';
import { Mark } from './Brand.tsx';

export function Sidebar({ threads, activeId, availability, onNew, onSearch, onWebSearch, onClock, onSettings, onCollapse, onThread, onDelete, onAbout }: {
  threads: Thread[]; activeId: string | null; availability: Availability | 'loading';
  onNew: () => void; onSearch: () => void; onWebSearch: () => void; onClock: () => void;
  onSettings: () => void; onCollapse: () => void; onThread: (thread: Thread) => void;
  onDelete: (thread: Thread) => void; onAbout: () => void;
}) {
  const mac = navigator.platform.includes('Mac');
  return <aside className="sidebar" id="workspace-sidebar" aria-label="Workspace sidebar">
    <div className="sidebar-top">
      <button type="button" className="wordmark" onClick={onNew} aria-label="Xyvora home">
        <Mark /><span>xyvora<span className="wordmark-period">.</span></span>
      </button>
      <button type="button" className="icon-button sidebar-toggle" aria-label="Close sidebar" title="Close sidebar" onClick={onCollapse}><PanelLeftClose size={18} /></button>
    </div>
    <div className="sidebar-content">
      <button className="new-chat" type="button" onClick={onNew}><Plus size={19} strokeWidth={2.2} /> <span>New chat</span><kbd>{mac ? '⌘⇧O' : 'Ctrl ⇧ O'}</kbd></button>
      <button className="search-trigger nav-button" type="button" onClick={onSearch}><Search size={17} /><span>Search chats</span><kbd>{mac ? '⌘ K' : 'Ctrl K'}</kbd></button>
      <nav className="workspace-nav" aria-label="Workspace">
        <div className="sidebar-label">WORKSPACE</div>
        <button type="button" className="nav-button" onClick={onWebSearch}><Globe size={17} /><span>Web search</span></button>
        <button type="button" className="nav-button" onClick={onClock}><Clock3 size={17} /><span>Time and date</span></button>
      </nav>
      <section className="history-section" aria-label="Recent chats">
        <div className="sidebar-label history-title">RECENT CHATS <Clock3 size={13} /></div>
        {threads.length === 0
          ? <div className="history-empty"><FolderOpen size={17} /><span>Your chats will appear here.</span></div>
          : <ul className="history-list">
            {threads.map((thread) => <li key={thread.id} className={`history-row${thread.id === activeId ? ' active' : ''}`}>
              <button type="button" className="history-entry" title={thread.title} onClick={() => onThread(thread)} aria-current={thread.id === activeId ? 'true' : undefined}>
                {thread.mode === 'compare' ? <Columns2 size={15} /> : <MessageSquare size={15} />}<span>{thread.title}</span>
              </button>
              <button type="button" className="bare-icon history-delete" aria-label={`Delete ${thread.title}`} title="Delete chat" onClick={() => onDelete(thread)}><Trash2 size={14} /></button>
            </li>)}
          </ul>}
      </section>
    </div>
    <div className="sidebar-bottom">
      <button type="button" className="sidebar-status" onClick={onAbout}>
        <span className={`status-dot status-${availability}`} />
        {availability === 'preview' ? 'Preview mode' : availability === 'unavailable' ? 'Chat connection unavailable' : 'Qwen 2.5 workspace'}
      </button>
      <button type="button" className="workspace-settings" onClick={onSettings} aria-label="Workspace settings">
        <span className="workspace-avatar" aria-hidden="true">X</span>
        <span className="workspace-profile"><strong>Personal workspace</strong><small>History on this device</small></span>
        <Settings2 size={16} className="settings-icon" />
      </button>
    </div>
  </aside>;
}
