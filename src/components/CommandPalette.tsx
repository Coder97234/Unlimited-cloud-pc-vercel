import { FileText, Folder, MessageSquare, Search, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LibraryEntry } from '../../shared/library.ts';
import type { Project } from '../../shared/projects.ts';
import type { Thread } from '../lib/history.ts';
import { listLibrary } from '../lib/library.ts';
import { searchProjectFiles } from '../lib/projects.ts';
import { useLabels } from '../lib/labels.ts';
import { Dialog } from './Dialog.tsx';

export type PaletteCommand = { id: string; label: string; keywords: string; run: () => void };
type Filter = 'All' | 'Chats' | 'Messages' | 'Projects' | 'Files' | 'Actions' | 'Favorites' | 'Archive';
type FileMatch = Awaited<ReturnType<typeof searchProjectFiles>>[number];
type Match = { id: string; title: string; kind: Exclude<Filter, 'All'>; hint?: string; run: () => void };
const limit = 32;
const snippet = (text: string, term: string) => {
  const compact = text.replace(/\s+/g, ' ').trim();
  const start = Math.max(0, compact.toLowerCase().indexOf(term) - 28);
  return (start ? '…' : '') + compact.slice(start, start + 118) + (compact.length > start + 118 ? '…' : '');
};
export function CommandPalette({ threads, projects, accountId, library, commands, recent, chatsOnly, onRemember, onClose, onThread, onProject }: {
  threads: Thread[]; projects?: Project[]; accountId?: string; library: boolean; commands: PaletteCommand[]; recent: string[]; chatsOnly?: boolean;
  onRemember: (query: string) => void; onClose: () => void; onThread: (chat: Thread, turn?: string) => void; onProject: (id: string, file?: string) => void;
}) {
  const t = useLabels();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(chatsOnly ? 'Chats' : 'All');
  const [selected, setSelected] = useState(-1);
  const [cloud, setCloud] = useState<{ key: string; entries?: LibraryEntry[]; error?: string }>();
  const [files, setFiles] = useState<{ query: string; items?: FileMatch[]; error?: string }>();
  const term = query.toLowerCase().trim();
  const withFiles = !!accountId && !!projects && (filter === 'All' || filter === 'Files') && term.length >= 2;
  useEffect(() => {
    if (!withFiles || !accountId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchProjectFiles(accountId, term, controller.signal).then((items) => {
        if (!controller.signal.aborted) setFiles({ query: term, items });
      }).catch(() => { if (!controller.signal.aborted) setFiles({ query: term, error: 'File search is unavailable. Try again shortly.' }); });
    }, 260);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [term, withFiles, accountId]);
  const withLibrary = !!accountId && library && (filter === 'Archive' || filter === 'Favorites' || (!!term && ['All', 'Chats', 'Messages'].includes(filter)));
  const searchKey = `${filter}:${term}`;
  useEffect(() => {
    if (!withLibrary || !accountId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      listLibrary(accountId, controller.signal, { q: term || undefined, filter: filter === 'Archive' ? 'archive' : filter === 'Favorites' ? 'favorite' : 'all' }).then(({ entries }) => {
        if (!controller.signal.aborted) setCloud({ key: searchKey, entries });
      }).catch(() => { if (!controller.signal.aborted) setCloud({ key: searchKey, error: 'Cloud search is unavailable. Recent matches still appear below.' }); });
    }, 220);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [withLibrary, accountId, term, filter, searchKey]);
  const filters: Filter[] = ['All', 'Chats', 'Messages', ...(projects ? ['Projects', 'Files'] as const : []), 'Actions', 'Favorites', 'Archive'];
  const has = (value: string) => value.toLowerCase().includes(term);
  const list: Match[] = [];
  const cloudEntries = withLibrary && cloud?.key === searchKey ? cloud.entries ?? [] : [];
  const recentById = new Map(threads.map((thread) => [thread.id, thread]));
  const matchingCloud = new Set(cloudEntries.map(({ chat }) => chat.id));
  const searchableChats = [...threads, ...cloudEntries.filter(({ chat }) => !recentById.has(chat.id)).map(({ chat }) => chat)];
  if (filter === 'All' || filter === 'Chats' || filter === 'Favorites' || filter === 'Archive') {
    for (const thread of searchableChats) {
      if ((filter === 'Favorites' && !thread.favorite) || (filter === 'Archive' && !thread.archived && thread.mode !== 'compare')) continue;
      const inMessage = !!term && thread.turns.some(({ prompt }) => has(prompt));
      if (!has(thread.title) && !inMessage && !matchingCloud.has(thread.id)) continue;
      const project = projects?.find(({ id }) => id === thread.projectId)?.name;
      list.push({ id: `chat:${thread.id}`, title: thread.title, hint: [project, thread.archived || thread.mode === 'compare' ? 'Archived' : '', thread.favorite ? 'Favorite' : ''].filter(Boolean).join(' · '), kind: 'Chats', run: () => onThread(thread) });
      if (list.length >= 20) break;
    }
  }
  if (filter === 'All' || filter === 'Actions') for (const command of commands) {
    if (has(`${command.label} ${command.keywords}`)) list.push({ ...command, title: command.label, kind: 'Actions' });
  }
  if (projects && (filter === 'All' || filter === 'Projects')) for (const project of projects) {
    if (has(`${project.name} ${project.description}`)) list.push({ id: `project:${project.id}`, kind: 'Projects', title: project.name, hint: project.description, run: () => onProject(project.id) });
  }
  if (withFiles && files?.query === term) for (const file of files.items ?? []) {
    list.push({ id: `file:${file.id}`, kind: 'Files', title: file.name, hint: projects?.find(({ id }) => id === file.projectId)?.name, run: () => onProject(file.projectId, file.id) });
  }
  if (term && (filter === 'All' || filter === 'Messages')) {
    let added = 0;
    for (const { chat, match } of cloudEntries) {
      const cached = recentById.get(chat.id) ?? chat;
      if (!match || (cached.turns.length && !cached.turns.some(({ id }) => id === match.turnId))) continue;
      list.push({ id: `cloud-message:${chat.id}:${match.turnId}`, title: match.text, hint: cached.title, kind: 'Messages', run: () => onThread(cached, match.turnId) });
      if (++added >= 16) break;
    }
    for (const thread of threads) {
      if (added >= 16) break;
      for (const turn of thread.turns) {
        if (list.some(({ id }) => id === `cloud-message:${thread.id}:${turn.id}`)) continue;
        const value = [turn.prompt, ...turn.answers.map(({ content }) => content)].find(has);
        if (value) {
          list.push({ id: `message:${thread.id}:${turn.id}`, kind: 'Messages', title: snippet(value, term), hint: thread.title, run: () => onThread(thread, turn.id) });
          added++;
        }
        if (added >= 16) break;
      }
      if (added >= 16) break;
    }
  }
  const visible = list.slice(0, limit);
  const run = (item: Match) => { if (query.trim()) onRemember(query.trim()); item.run(); };
  const busy = (withFiles && files?.query !== term) || (withLibrary && cloud?.key !== searchKey);
  return <Dialog title={t('searchChats')} subtitle="Find workspace content or run a command. Use the arrow keys and Enter to open a result." className="palette-dialog" onClose={onClose}>
    <label className="search-field"><Search size={18} /><input type="search" value={query} maxLength={100} onChange={(event) => { setQuery(event.target.value); setSelected(-1); setFiles(undefined); }} placeholder={t('searchChats')} aria-label="Search workspace" data-dialog-focus
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || !visible.length) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const next = selected < 0 ? event.key === 'ArrowDown' ? 0 : visible.length - 1 : (selected + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
          setSelected(next); document.getElementById(`palette-${next}`)?.scrollIntoView({ block: 'nearest' });
        } else if (event.key === 'Enter') { event.preventDefault(); run(visible[Math.min(Math.max(0, selected), visible.length - 1)]); }
      }} /></label>
    <div className="palette-filters" aria-label="Filter results">{filters.map((item) => <button type="button" key={item} aria-pressed={item === filter} onClick={() => { setSelected(-1); setFilter(item); }}>{item}</button>)}</div>
    {!term && recent.length > 0 && <div className="palette-recent"><span>Recent searches</span>{recent.map((item) => <button className="text-button" type="button" key={item} onClick={() => { setQuery(item); setSelected(-1); }}>{item}</button>)}</div>}
    {withFiles && files?.query === term && files.error && <p className="form-hint" role="status">{files.error}</p>}
    {withLibrary && cloud?.key === searchKey && cloud.error && <p className="form-hint" role="status">{cloud.error}</p>}
    {!visible.length && <p className="form-hint" role="status">{busy ? 'Searching your workspace…' : !term && filter === 'Messages' ? 'Enter a word to search across messages.' : !term && filter === 'Files' ? 'Enter at least two characters to find file names and content.' : 'No matches.'}</p>}
    <div className="search-results palette-results" aria-label="Search results">{visible.map((item, index) => {
      const Icon = item.kind === 'Projects' ? Folder : item.kind === 'Files' ? FileText : item.kind === 'Actions' ? Zap : MessageSquare;
      return <button type="button" id={`palette-${index}`} key={item.id} className={`search-result${selected === index ? ' keyboard-selected' : ''}`} onClick={() => run(item)}>
        <Icon size={16} /><span><strong>{item.title}</strong>{item.hint && <small>{item.hint}</small>}</span>{item.kind !== 'Chats' && <small className="palette-kind">{item.kind}</small>}
      </button>;
    })}</div>
    <span className="sr-only" role="status">{visible.length} results{selected >= 0 && visible[selected] ? `, ${visible[selected].title} selected` : ''}.</span>
  </Dialog>;
}
