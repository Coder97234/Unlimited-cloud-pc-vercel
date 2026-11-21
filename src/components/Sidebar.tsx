import {
  Blocks, Brain, Clock3, Columns2, FolderOpen, GitBranch, Globe, ImagePlus, ListTodo, MessageSquare, PanelLeftClose, Plus, Search, Settings2, Shield, Trash2, UserRound,
} from 'lucide-react';
import { XYVORA_NAME } from '../../shared/models.ts';
import type { Availability } from '../../shared/models.ts';
import type { Thread } from '../lib/history.ts';
import { Mascot } from './Brand.tsx';

export function Sidebar({ threads, activeId, availability, temporary, memoryOn, signedIn, syncLabel, onMemory, onNew, onTemporary, onSearch, onPlugins, onRepo, onTasks, onWebSearch, onImage, onSettings, onCollapse, onThread, onDelete, onAbout }: {
  threads: Thread[]; activeId: string | null; availability: Availability | 'loading';
  temporary: boolean; memoryOn: boolean; signedIn: boolean; syncLabel: string; onMemory: () => void; onNew: () => void; onTemporary: () => void; onSearch: () => void; onPlugins?: () => void; onRepo?: () => void; onTasks?: () => void; onWebSearch: () => void; onImage?: () => void;
  onSettings: () => void; onCollapse: () => void; onThread: (thread: Thread) => void;
  onDelete: (thread: Thread) => void; onAbout: () => void;
}) {
  const mac = navigator.platform.includes('Mac');
  return <aside className="sidebar" id="workspace-sidebar" aria-label="Workspace sidebar">
    <div className="sidebar-top">
      <button type="button" className="wordmark" onClick={onNew} aria-label={`${XYVORA_NAME} home`}>
        <Mascot /><span>{XYVORA_NAME}<span className="wordmark-period">.</span></span>
      </button>
      <button type="button" className="icon-button sidebar-toggle" aria-label="Close sidebar" title="Close sidebar" onClick={onCollapse}><PanelLeftClose size={18} /></button>
    </div>
    <div className="sidebar-content">
      <button className="new-chat" type="button" onClick={onNew} aria-keyshortcuts="Control+Shift+N Meta+Shift+N"><Plus size={19} strokeWidth={2.2} /> <span>New chat</span><kbd>{mac ? '⌘⇧N' : 'Ctrl ⇧ N'}</kbd></button>
      <button className={`nav-button temporary-trigger${temporary ? ' active' : ''}`} type="button" aria-current={temporary ? 'true' : undefined} onClick={onTemporary}><Shield size={17} /><span>Temporary chat</span></button>
      <button className="search-trigger nav-button" type="button" onClick={onSearch} aria-keyshortcuts="Control+K Meta+K"><Search size={17} /><span>Search chats</span><kbd>{mac ? '⌘ K' : 'Ctrl K'}</kbd></button>
      <nav className="workspace-nav" aria-label="Workspace">
        <div className="sidebar-label">WORKSPACE</div>
        {onPlugins && <button type="button" className="nav-button" onClick={onPlugins}><Blocks size={17} /><span>Plugins</span></button>}
        <button type="button" className="nav-button" onClick={onWebSearch}><Globe size={17} /><span>Web search</span></button>
        {onRepo && <button type="button" className="nav-button" onClick={onRepo}><GitBranch size={17} /><span>GitHub projects</span></button>}
        {onTasks && <button type="button" className="nav-button" onClick={onTasks}><ListTodo size={17} /><span>Background tasks</span></button>}
        {onImage && <button type="button" className="nav-button" onClick={onImage}><ImagePlus size={17} /><span>Image Studio</span></button>}
        <button type="button" className="nav-button" onClick={onMemory}><Brain size={17} /><span>Memory</span>{memoryOn && <small className="memory-indicator">On</small>}</button>
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
        {availability === 'preview' ? 'Preview mode' : availability === 'unavailable' ? 'Chat connection unavailable' : availability === 'loading' ? 'Connecting to chat…' : 'Chat ready'}
      </button>
      <button type="button" className="workspace-settings" onClick={onSettings} aria-label="Workspace settings">
        <span className="workspace-avatar" aria-hidden="true"><UserRound size={16} /></span>
        <span className="workspace-profile"><strong>Personal workspace</strong><small>{signedIn ? syncLabel : 'History on this device'}</small></span>
        <Settings2 size={16} className="settings-icon" />
      </button>
    </div>
  </aside>;
}
