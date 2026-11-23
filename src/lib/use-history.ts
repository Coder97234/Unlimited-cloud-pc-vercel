import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
import { mergeChatHistory } from '../../shared/history.ts';
import type { CloudHistory, Thread } from '../../shared/history.ts';
import { accountHistoryChangeKey, loadCloudHistory, saveCloudHistory } from './account.ts';
import { loadThreads, storeThreads } from './history.ts';

type State = { chats: Thread[]; base?: CloudHistory; problem?: string; conflict?: CloudHistory };

export function useChatHistory(accountId: string | undefined, checking: boolean, busy: boolean, enabled = true) {
  const [state, setState] = useState<State>(() => ({ chats: !enabled || checking || accountId ? [] : loadThreads() }));
  const current = useRef(state);
  const localBase = useRef(state.chats);
  const inFlight = useRef<AbortController | null>(null);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [localWarning, setLocalWarning] = useState('');
  const busyRef = useRef(busy);
  useLayoutEffect(() => { current.current = state; busyRef.current = busy; }, [state, busy]);
  const setChats = (value: SetStateAction<Thread[]>) => setState((before) => ({ ...before,
    problem: before.conflict ? before.problem : undefined,
    chats: typeof value === 'function' ? value(before.chats) : value,
  }));
  useEffect(() => {
    if (!enabled || accountId || checking || busy || localBase.current === state.chats) return;
    if (storeThreads(state.chats)) { localBase.current = state.chats; setLocalWarning(''); }
    else setLocalWarning('This browser could not save chat history.');
  }, [state.chats, accountId, checking, busy, enabled]);

  useEffect(() => {
    if (!accountId || !enabled) return;
    const load = new AbortController();
    let reading = false;
    const refresh = async () => {
      const previous = current.current;
      if (reading || busyRef.current || inFlight.current || (previous.base && previous.base.chats !== previous.chats)) return;
      reading = true;
      try {
        const base = await loadCloudHistory(accountId, load.signal);
        if (load.signal.aborted) return;
        setState((before) => {
          if (before.base !== previous.base || busyRef.current || (before.base && before.base.chats !== before.chats)) return before;
          if (before.base?.revision === base.revision) return before;
          return { base, chats: base.chats };
        });
      } catch (error) {
        if (!load.signal.aborted && !current.current.base) setState((before) => ({ ...before, problem: error instanceof Error ? error.message : 'Could not load saved chats.' }));
      } finally { reading = false; }
    };
    const storage = (event: StorageEvent) => { if (event.key === accountHistoryChangeKey(accountId)) void refresh(); };
    const visibility = () => { if (!document.hidden) void refresh(); };
    void refresh();
    const interval = setInterval(visibility, 60_000);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      load.abort(); clearInterval(interval);
      window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', visibility);
    };
  }, [accountId, reload, enabled]);
  useEffect(() => () => { inFlight.current?.abort(); inFlight.current = null; }, []);

  useEffect(() => {
    const { base, chats, problem, conflict } = state;
    if (!enabled || !accountId || !base || base.chats === chats || busy || problem || conflict || saving || inFlight.current) return;
    const timer = setTimeout(() => {
      if (inFlight.current) return;
      const send = inFlight.current = new AbortController();
      setSaving(true);
      void (async () => {
        let expected = base, wanted = chats;
        for (let tries = 0; tries < 3; tries++) {
          const outcome = await saveCloudHistory(accountId, expected.revision, wanted, send.signal);
          send.signal.throwIfAborted();
          if ('saved' in outcome && outcome.saved) {
            const revision = outcome.saved.revision;
            setState((before) => {
              const combined = before.chats === chats ? wanted : wanted === chats ? before.chats : mergeChatHistory(chats, before.chats, wanted);
              if (!combined) return { ...before, conflict: { revision, chats: wanted }, problem: 'This chat changed on another device. Export your unsynced copy before using the cloud history.' };
              const synced = before.chats === chats ? combined : wanted;
              return { base: { revision, chats: synced }, chats: combined };
            });
            return;
          }
          if (!outcome.conflict) throw new Error('Could not confirm the history save.');
          expected = outcome.conflict;
          const merged = mergeChatHistory(base.chats, chats, expected.chats);
          if (!merged || tries === 2) {
            setState((before) => ({ ...before, conflict: expected, problem: 'Cloud history changed on another device. Export unsynced chats before using the cloud copy.' }));
            return;
          }
          wanted = merged;
        }
      })().catch((error) => {
        if (!send.signal.aborted) setState((before) => ({ ...before, problem: error instanceof Error ? error.message : 'Could not sync your chats.' }));
      }).finally(() => {
        if (inFlight.current === send) { inFlight.current = null; setSaving(false); }
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [state, accountId, busy, saving, enabled]);
  return {
    chats: state.chats,
    setChats,
    loading: !!accountId && !state.base && !state.problem,
    ready: !accountId || !!state.base,
    unsynced: !!accountId && !!state.base && state.chats !== state.base.chats,
    problem: state.problem ?? localWarning,
    conflict: !!state.conflict,
    retry: () => {
      setState((before) => ({ ...before, problem: undefined }));
      if (!current.current.base) setReload((value) => value + 1);
    },
    useCloudCopy: () => setState((before) => before.conflict ? { base: before.conflict, chats: before.conflict.chats } : before),
  };
}
