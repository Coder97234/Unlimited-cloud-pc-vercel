import {
  Blocks, Brain, Check, Circle, CircleHelp, Columns2, Folder, GitBranch, ImagePlus, ListFilter, ListTodo, PanelLeftClose, Pencil, Pin, Plus, Search, Settings2, Shield, Star, Trash2, UserRound, X,
} from 'lucide-react';
import { XYVORA_NAME } from '../../shared/models.ts';
import { useLayoutEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { chatTitle } from '../../shared/history.ts';
import { useLabels } from '../lib/labels.ts';
import type { Availability } from '../../shared/models.ts';
import type { Thread } from '../lib/history.ts';

export function Sidebar({ threads, activeId, availability, temporary, memoryOn, accountName, syncLabel, onMemory, onNew, onTemporary, onSearch, onFilter, onProjects, projectName, onPlugins, onRepo, onTasks, onImage, onSettings, onCollapse, closeControl, onThread, onRename, canRename, onDelete, onMore, paging, pageError, onAbout }: {
  threads: Thread[]; activeId: string | null; availability: Availability | 'loading';
  temporary: boolean; memoryOn: boolean; accountName?: string; syncLabel: string; onMemory: () => void; onNew: () => void; onTemporary: () => void; onSearch: () => void; onFilter: () => void;
  onProjects?: () => void; projectName?: string; onPlugins?: () => void; onRepo?: () => void; onTasks?: () => void; onImage?: () => void;
  onSettings: () => void; onCollapse: () => void; closeControl: Ref<HTMLButtonElement>; onThread: (thread: Thread) => void;
  onRename: (thread: Thread, title: string) => void; canRename: boolean; onDelete: (thread: Thread) => void; onMore?: () => void; paging: boolean; pageError: string; onAbout: () => void;
}) {
  const t = useLabels();
  const mac = navigator.platform.includes('Mac');
  const fresh = !activeId && !projectName && !temporary;
  const status = availability === 'preview' ? 'Preview mode' : availability === 'unavailable' ? 'Chat connection unavailable' : availability === 'loading' ? 'Connecting to chat…' : 'Chat ready';
  const initial = accountName ? Array.from(accountName)[0]?.toLocaleUpperCase() : undefined;
  return <aside className="sidebar" id="workspace-sidebar" aria-label="Workspace sidebar">
    <div className="sidebar-top">
      <button ref={closeControl} type="button" className="icon-button sidebar-toggle" aria-label="Close sidebar" title="Close sidebar" onClick={onCollapse}><PanelLeftClose size={16} /></button>
      <button type="button" className="wordmark" onClick={onNew} aria-label={`${XYVORA_NAME} home`}>{XYVORA_NAME}</button>
    </div>
    <div className="sidebar-content">
      <nav className="workspace-nav" aria-label="Workspace">
        <button className="nav-button new-chat" type="button" onClick={onNew} aria-current={fresh ? 'page' : undefined} aria-keyshortcuts="Control+Shift+N Meta+Shift+N"><Plus size={17} /> <span>{t('newChat')}</span><kbd aria-hidden="true">{mac ? '⌘ ⇧ N' : 'Ctrl ⇧ N'}</kbd></button>
        <button className="nav-button search-trigger" type="button" onClick={onSearch} aria-keyshortcuts="Control+K Meta+K"><Search size={16} /><span>{t('searchChats')}</span><kbd aria-hidden="true">{mac ? '⌘ K' : 'Ctrl K'}</kbd></button>
        {onProjects && <button type="button" className="nav-button" onClick={onProjects}><Folder size={16} /><span>Projects</span></button>}
        <button className={`nav-button${temporary ? ' active' : ''}`} type="button" aria-current={temporary ? 'page' : undefined} onClick={onTemporary}><Shield size={16} /><span>{t('temporary')}</span></button>
        {onTasks && <button type="button" className="nav-button" onClick={onTasks}><ListTodo size={16} /><span>Background tasks</span></button>}
        {onRepo && <button type="button" className="nav-button" onClick={onRepo}><GitBranch size={16} /><span>GitHub projects</span></button>}
        {onPlugins && <button type="button" className="nav-button" onClick={onPlugins}><Blocks size={16} /><span>Plugins</span></button>}
        {onImage && <button type="button" className="nav-button" onClick={onImage}><ImagePlus size={16} /><span>Image Studio</span></button>}
        <button type="button" className="nav-button" onClick={onMemory}><Brain size={16} /><span>{t('memory')}</span>{memoryOn && <small className="memory-indicator">{t('on')}</small>}</button>
      </nav>
      <section className="history-section" aria-label={projectName ? 'Project chats' : t('recentChats')}>
        <div className="history-title">
          <h2>{projectName ? 'Project chats' : t('recentChats')}</h2>
          <button type="button" className="bare-icon" title="Filter chats" aria-label="Filter chats" onClick={onFilter}><ListFilter size={15} /></button>
        </div>
        {threads.length === 0
          ? <p className="history-empty">{t('emptyHistory')}</p>
          : <ul className="history-list">
            {threads.map((thread) => <HistoryRow key={thread.id} thread={thread} active={thread.id === activeId} canRename={canRename} onOpen={onThread} onRename={onRename} onDelete={onDelete} />)}
          </ul>}
        {onMore && <button type="button" className="nav-button history-more" disabled={paging} onClick={onMore}>{paging ? 'Loading…' : 'Load more chats'}</button>}
        {pageError && <p className="form-hint" role="status">{pageError}</p>}
      </section>
    </div>
    <div className="sidebar-bottom">
      <button type="button" className="workspace-settings" onClick={onSettings} aria-label={t('settings')}>
        <span className="workspace-avatar" aria-hidden="true">{initial ?? <UserRound size={13} />}</span>
        <span className="workspace-profile"><strong title={accountName}>{accountName || t('workspace')}</strong><small>{accountName ? syncLabel : t('local')}</small></span>
        <Settings2 size={15} className="settings-icon" />
      </button>
      <button type="button" className="icon-button sidebar-status" onClick={onAbout} title={`About Xyvora · ${status}`} aria-label={`${status} — About Xyvora`}><CircleHelp size={16} /></button>
    </div>
  </aside>;
}

function HistoryRow({ thread, active, canRename, onOpen, onRename, onDelete }: {
  thread: Thread; active: boolean; canRename: boolean; onOpen: (thread: Thread) => void;
  onRename: (thread: Thread, title: string) => void; onDelete: (thread: Thread) => void;
}) {
  const t = useLabels();
  const [value, setValue] = useState<string>();
  const field = useRef<HTMLInputElement>(null);
  const entry = useRef<HTMLButtonElement>(null);
  const editing = value !== undefined;
  const previous = useRef(false);
  useLayoutEffect(() => {
    if (editing) { field.current?.focus({ preventScroll: true }); field.current?.select(); }
    else if (previous.current) entry.current?.focus({ preventScroll: true });
    previous.current = editing;
  }, [editing]);
  function start() { if (canRename) setValue(thread.title); }
  const title = chatTitle(value);
  return <li className={`history-row${active ? ' active' : ''}`}>
    {editing ? <form className="history-rename" onSubmit={(event) => {
      event.preventDefault(); if (!title || !canRename) return;
      if (title !== thread.title) onRename(thread, title);
      setValue(undefined);
    }} onKeyDown={(event) => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
      event.preventDefault(); event.stopPropagation(); setValue(undefined);
    }}>
      <input ref={field} aria-label={t('title')} value={value} maxLength={100} onChange={(event) => setValue(event.target.value)} />
      <button className="bare-icon" type="submit" aria-label={t('save')} title={t('save')} disabled={!title || !canRename}><Check size={15} /></button>
      <button className="bare-icon" type="button" aria-label={t('cancel')} title={t('cancel')} onClick={() => setValue(undefined)}><X size={14} /></button>
    </form> : <>
      <button ref={entry} type="button" className="history-entry" title={thread.title} onClick={(event) => { if (event.detail <= 1) onOpen(thread); }} onDoubleClick={start}
        aria-keyshortcuts={canRename ? 'F2' : undefined} onKeyDown={(event) => { if (canRename && event.key === 'F2') { event.preventDefault(); start(); } }} aria-current={active ? 'page' : undefined}>
        {thread.pinned ? <Pin size={13} /> : thread.mode === 'compare' ? <Columns2 size={13} /> : <span className="history-marker" aria-hidden="true"><Circle size={6} /></span>}<span className="history-entry-text">{thread.title}</span>{thread.favorite && <Star size={11} className="history-star" aria-label="Favorite" />}
      </button>
      <div className="history-actions">
        {canRename && <button type="button" className="bare-icon history-edit" aria-label={`${t('rename')}: ${thread.title}`} title={t('rename')} onClick={start}><Pencil size={13} /></button>}
        <button type="button" className="bare-icon history-delete" aria-label={`Delete ${thread.title}`} title="Delete chat" onClick={() => onDelete(thread)}><Trash2 size={14} /></button>
      </div>
    </>}
  </li>;
}
