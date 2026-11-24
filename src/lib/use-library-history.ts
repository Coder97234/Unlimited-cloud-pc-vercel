import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
import type { Thread } from '../../shared/history.ts';
import type { LibraryEntry, LibraryPage } from '../../shared/library.ts';
import { accountHistoryChangeKey } from './account.ts';
import { clearLibrary, listLibrary, openLibraryChat, saveLibraryChat } from './library.ts';

type Version = Pick<LibraryPage, 'total' | 'revision'>;
type State = {
  chats: Thread[]; base: Map<string, LibraryEntry>; page?: Version & { next: string | null };
  headRevision?: string; problem?: string; conflict?: { id: string; entry: LibraryEntry | null; version: Version };
};
const empty = (): State => ({ chats: [], base: new Map() });
const message = (error: unknown) => error instanceof Error ? error.message : 'Conversation sync failed. Try again.';
function pending({ chats, base }: State) {
  const next = new Map(chats.map((chat) => [chat.id, chat]));
  return [...new Set([...next.keys(), ...base.keys()])].filter((id) => next.get(id) !== base.get(id)?.chat);
}
function sorted(chats: Thread[]) {
  return chats.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));
}
function trimLoaded(state: State, keep: string | null): State {
  const base = new Map(state.base);
  let expanded = 0;
  const chats = state.chats.map((chat) => {
    const cached = base.get(chat.id);
    if (!chat.turns.length || !cached || cached.chat !== chat || chat.id === keep || expanded++ < 5) return chat;
    const summary = { ...chat, turns: [] };
    base.set(chat.id, { ...cached, chat: summary });
    return summary;
  });
  return { ...state, base, chats };
}
function confirmed(state: State, id: string, saved: LibraryEntry | null, version: Version, original?: Thread): State {
  const base = new Map(state.base);
  const chats = state.chats.filter((item) => item.id !== id);
  const local = state.chats.find((item) => item.id === id);
  // Edits made while this write was in flight remain dirty for the next save.
  const desired = original === local ? saved?.chat
    : local && saved && original?.turns === local.turns ? { ...local, turns: saved.chat.turns } : local;
  if (saved) base.set(id, saved); else base.delete(id);
  if (desired) chats.push(desired);
  return { ...state, base, chats: sorted(chats), page: { next: state.page?.next ?? null, revision: version.revision, total: version.total } };
}

export function useLibraryHistory(accountId: string | undefined, busy: boolean, activeId: string | null) {
  const [state, setState] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState('');
  const [reload, setReload] = useState(0);
  const current = useRef(state);
  const writing = useRef<AbortController | undefined>(undefined);
  const pagingJob = useRef<AbortController | undefined>(undefined);
  const activity = useRef({ busy, activeId });
  useLayoutEffect(() => { current.current = state; activity.current = { busy, activeId }; }, [state, busy, activeId]);
  useEffect(() => () => { writing.current?.abort(); pagingJob.current?.abort(); }, []);

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    let reading = false;
    async function refresh() {
      const base = current.current;
      if (!accountId || reading || writing.current || pagingJob.current || activity.current.busy || pending(base).length) return;
      reading = true;
      try {
        const page = await listLibrary(accountId, controller.signal);
        const selected = activity.current.activeId;
        if (base.headRevision === page.revision) return;
        const cache = new Map(page.entries.map((item) => {
          const old = base.base.get(item.chat.id);
          return [item.chat.id, old?.revision === item.revision && old.chat.projectId === item.chat.projectId && old.chat.turns.length ? old : item];
        }));
        if (selected && !cache.get(selected)?.chat.turns.length) {
          try {
            const opened = await openLibraryChat(accountId, selected, controller.signal);
            cache.set(selected, opened);
          } catch (error) {
            if (controller.signal.aborted) return;
            if (message(error) !== 'Conversation not found.') throw error;
          }
        }
        if (!controller.signal.aborted) setState((stale) => {
          if (stale !== base || activity.current.busy || activity.current.activeId !== selected || writing.current) return stale;
          return { base: cache, chats: sorted([...cache.values()].map(({ chat }) => chat)), page, headRevision: page.revision };
        });
      } catch (error) {
        if (!controller.signal.aborted && !base.page) setState((before) => ({ ...before, problem: message(error) }));
      } finally { reading = false; }
    }
    const visibility = () => { if (!document.hidden) void refresh(); };
    const storage = (event: StorageEvent) => { if (event.key === accountHistoryChangeKey(accountId)) void refresh(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('storage', storage);
    const interval = setInterval(visibility, 45_000);
    void refresh();
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('storage', storage); };
  }, [accountId, reload]);

  useEffect(() => {
    if (!accountId || !state.page || state.problem || busy || saving || writing.current) return;
    const [id] = pending(state);
    if (!id) return;
    const desired = state.chats.find((item) => item.id === id);
    const expected = state.base.get(id);
    const timer = setTimeout(() => {
      if (activity.current.busy || writing.current || current.current !== state) return;
      const controller = writing.current = new AbortController();
      setSaving(true);
      void saveLibraryChat(accountId, id, expected, desired, controller.signal).then((outcome) => {
        if (controller.signal.aborted) return;
        if (outcome.conflict) setState((before) => ({ ...before,
          problem: 'This conversation changed on another device. Export your unsynced copy before using the cloud version.',
          conflict: { id, entry: outcome.entry, version: outcome },
        }));
        else setState((before) => trimLoaded(confirmed(before, id, outcome.entry, outcome, desired), activity.current.activeId));
      }).catch((error) => { if (!controller.signal.aborted) setState((before) => ({ ...before, problem: message(error) })); })
        .finally(() => { if (writing.current === controller) { writing.current = undefined; if (!controller.signal.aborted) setSaving(false); } });
    }, 180);
    return () => clearTimeout(timer);
  }, [state, saving, accountId, busy]);

  async function open(chat: Thread, signal: AbortSignal) {
    const snapshot = current.current;
    const cached = snapshot.chats.find(({ id }) => id === chat.id);
    if (!accountId) return cached ?? chat;
    if (cached?.turns.length) return cached;
    if (cached && cached !== snapshot.base.get(chat.id)?.chat) throw new Error('Wait for the new title to sync, then open this chat.');
    const entry = await openLibraryChat(accountId, chat.id, signal);
    signal.throwIfAborted();
    const latest = current.current.chats.find(({ id }) => id === chat.id);
    if (latest?.turns.length) return latest;
    if (latest && latest !== current.current.base.get(chat.id)?.chat) throw new Error('Wait for the new title to sync, then open this chat.');
    setState((before) => {
      const now = before.chats.find(({ id }) => id === chat.id);
      if (now && (now.turns.length || now !== before.base.get(chat.id)?.chat)) return before;
      const base = new Map(before.base).set(chat.id, entry);
      return trimLoaded({ ...before, base, chats: sorted([...before.chats.filter(({ id }) => id !== chat.id), entry.chat]) }, chat.id);
    });
    return entry.chat;
  }
  async function more() {
    const before = current.current;
    const older = before.page?.next;
    if (!accountId || !older || writing.current || pagingJob.current) return;
    const controller = pagingJob.current = new AbortController();
    setPaging(true); setPageError('');
    try {
      const page = await listLibrary(accountId, controller.signal, { older });
      if (controller.signal.aborted) return;
      setState((previous) => {
        if (previous.page?.next !== older) return previous;
        const base = new Map(previous.base), chats = [...previous.chats];
        for (const item of page.entries) if (!base.has(item.chat.id) && !chats.some(({ id }) => id === item.chat.id)) { base.set(item.chat.id, item); chats.push(item.chat); }
        return { ...previous, base, chats: sorted(chats), page: { ...previous.page, next: page.next } };
      });
    } catch (error) { if (!controller.signal.aborted) setPageError(message(error)); }
    finally { if (pagingJob.current === controller) { pagingJob.current = undefined; if (!controller.signal.aborted) setPaging(false); } }
  }
  async function clear() {
    const before = current.current;
    if (!accountId || !before.page || activity.current.busy || writing.current || pending(before).length) throw new Error('Finish syncing before clearing the conversation library.');
    const controller = writing.current = new AbortController();
    setSaving(true);
    try {
      const data = await clearLibrary(accountId, before.page.revision, controller.signal);
      controller.signal.throwIfAborted();
      setState({ ...empty(), page: { ...data, next: null } });
    } finally { if (writing.current === controller) { writing.current = undefined; if (!controller.signal.aborted) setSaving(false); } }
  }
  const dirty = pending(state);
  return {
    chats: state.chats,
    setChats: (update: SetStateAction<Thread[]>) => setState((before) => ({ ...before, problem: before.conflict ? before.problem : undefined,
      chats: typeof update === 'function' ? update(before.chats) : update })),
    count: (state.page?.total ?? 0) + dirty.reduce((total, id) => total + (state.base.has(id) ? state.chats.some((chat) => chat.id === id) ? 0 : -1 : 1), 0),
    loading: !!accountId && !state.page && !state.problem,
    ready: !!state.page, unsynced: dirty.length > 0 || saving, problem: state.problem,
    conflict: !!state.conflict,
    conflictChat: state.chats.find(({ id }) => id === state.conflict?.id),
    retry: () => { setState((previous) => ({ ...previous, problem: undefined })); setReload((value) => value + 1); },
    useCloudCopy: () => setState((previous) => {
      const item = previous.conflict;
      if (!item) return previous;
      return { ...confirmed(previous, item.id, item.entry, item.version, previous.chats.find(({ id }) => id === item.id)), conflict: undefined, problem: undefined };
    }),
    open, more, clear, hasMore: !!state.page?.next, paging, pageError,
  };
}
