import {
  ArrowLeft, ArrowUpRight, ChevronDown, Columns2, Moon, PanelLeftOpen, Sparkles, Sun, X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_MODEL, HOSTED_MODELS, isHostedModel, MODELS } from '../shared/models.ts';
import type { Availability, HostedModelId, ModelId } from '../shared/models.ts';
import { HeroMark, ModelIcon } from './components/Brand.tsx';
import { Composer } from './components/Composer.tsx';
import { Dialog } from './components/Dialog.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { Suggestions } from './components/Suggestions.tsx';
import { Transcript } from './components/Transcript.tsx';
import { AboutDialog, ModelDialog, SearchDialog, SettingsDialog } from './components/WorkspaceDialogs.tsx';
import type { Theme } from './components/WorkspaceDialogs.tsx';
import { buildMessages, loadThreads, MAX_THREADS, MAX_TURNS, storeThreads, titleForPrompt } from './lib/history.ts';
import type { Answer, Attachment, ChatMode, Thread, Turn } from './lib/history.ts';
import { ChatError, streamHosted } from './lib/stream.ts';

type Modal = { kind: 'models'; lane?: 0 | 1 } | { kind: 'delete'; thread: Thread } | { kind: 'search' | 'settings' | 'about' };

function readTheme(): Theme {
  try { return localStorage.getItem('xyvora.theme') === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}
const emptyTurns: Turn[] = [];

function CompareModels({ models, onChoose, compact = false }: { models: [HostedModelId, HostedModelId]; onChoose: (lane: 0 | 1) => void; compact?: boolean }) {
  return <div className={`compare-models${compact ? ' compare-models-compact' : ''}`}>
    {([0, 1] as const).map((lane) => <button type="button" key={lane} className="compare-model" onClick={() => onChoose(lane)} aria-label={`Choose ${lane === 0 ? 'left' : 'right'} model, ${MODELS[models[lane]].name}`}>
      <ModelIcon id={models[lane]} size={20} />
      <span><small>MODEL {lane === 0 ? 'A' : 'B'}</small><strong>{MODELS[models[lane]].name}</strong></span><ChevronDown size={17} />
    </button>)}
  </div>;
}

export default function App() {
  const [threads, setThreads] = useState(loadThreads);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<ChatMode>('chat');
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<Attachment>();
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [pair, setPair] = useState<[HostedModelId, HostedModelId]>(['qwen', 'gpt-oss']);
  const [availability, setAvailability] = useState<Availability | 'loading'>('loading');
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const explicitlySelectedModel = useRef(false);
  const followReplies = useRef(true);
  const active = threads.find((thread) => thread.id === activeId);
  const turns = active?.turns ?? emptyTurns;

  useEffect(() => {
    const controller = new AbortController();
    function setMode(mode: Availability) {
      if (controller.signal.aborted) return;
      setAvailability(mode);
      if (mode === 'on-device' && !explicitlySelectedModel.current) setModel('local');
    }
    fetch('/api/chat', { signal: controller.signal, cache: 'no-store' }).then(async (response) => {
      const data = await response.json();
      setMode(data?.availability === 'hosted' || data?.availability === 'preview' ? data.availability : 'on-device');
    }).catch(() => setMode('on-device'));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#181621' : '#f8f7fb');
    try { localStorage.setItem('xyvora.theme', theme); } catch { /* Browser storage may be unavailable. */ }
  }, [theme]);
  useEffect(() => {
    if (!busy && !storeThreads(threads)) setToast('This browser could not save chat history.');
  }, [threads, busy]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5_000);
    return () => clearTimeout(timer);
  }, [toast]);
  useLayoutEffect(() => {
    if (pane.current && followReplies.current) pane.current.scrollTop = pane.current.scrollHeight;
  }, [active]);

  const closeModal = () => setModal(null);
  const focusPrompt = () => requestAnimationFrame(() => textarea.current?.focus());
  const stop = () => controllerRef.current?.abort();
  function setNew(mode: ChatMode = 'chat') {
    stop();
    setView(mode);
    setActiveId(null);
    setDraft('');
    setAttachment(undefined);
    setMobileOpen(false);
    followReplies.current = true;
    focusPrompt();
  }
  function openView(mode: ChatMode) {
    if (view === mode) { setMobileOpen(false); return; }
    setNew(mode);
  }
  function showThread(thread: Thread) {
    if (thread.id !== activeId) stop();
    setView(thread.mode);
    setActiveId(thread.id);
    setDraft('');
    setAttachment(undefined);
    setMobileOpen(false);
    setModal(null);
    const answers = thread.turns.at(-1)?.answers;
    if (thread.mode === 'chat' && answers?.[0]) selectModel(answers[0].model);
    if (thread.mode === 'compare' && isHostedModel(answers?.[0]?.model) && isHostedModel(answers?.[1]?.model) && answers[0].model !== answers[1].model) {
      setPair([answers[0].model, answers[1].model]);
    }
    followReplies.current = true;
    if (pane.current) pane.current.scrollTop = pane.current.scrollHeight;
  }
  function selectModel(id: ModelId) { explicitlySelectedModel.current = true; setModel(id); }
  function deleteThread(thread: Thread) {
    if (thread.id === activeId) setNew(view);
    setThreads((current) => current.filter(({ id }) => id !== thread.id));
    closeModal();
    setToast('Conversation deleted.');
  }
  function toggleSidebar() {
    if (matchMedia('(max-width: 760px)').matches) setMobileOpen((open) => !open);
    else setCollapsed((closed) => !closed);
  }
  function openModels(lane?: 0 | 1) {
    setMobileOpen(false);
    setModal({ kind: 'models', lane: lane ?? (view === 'compare' ? 0 : undefined) });
  }
  function toggleTheme() { setTheme((current) => current === 'dark' ? 'light' : 'dark'); }

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'k') {
        event.preventDefault();
        setModal({ kind: 'search' });
      } else if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === 'o') {
        event.preventDefault(); closeModal(); setNew();
      } else if (key === 'escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  });

  async function run(retry?: Turn, overrideModel?: ModelId) {
    const prompt = retry?.prompt ?? draft.trim();
    if (controllerRef.current || !prompt) return;
    const sendingMode = view;
    const chosen: ModelId[] = sendingMode === 'compare' ? pair : [overrideModel ?? model];
    const controller = new AbortController();
    controllerRef.current = controller;
    const historical = retry ? turns.slice(0, -1) : turns;
    const threadId = activeId ?? crypto.randomUUID();
    const turnId = retry?.id ?? crypto.randomUUID();
    const turn: Turn = {
      id: turnId, prompt, attachment: retry ? retry.attachment : attachment,
      answers: chosen.map((id) => ({
        model: id, content: '', state: 'working',
        source: id === 'local' ? 'on-device' : availability === 'preview' ? 'preview' : 'hosted',
      })),
    };
    const thread: Thread = {
      id: threadId, title: active?.title ?? titleForPrompt(prompt), mode: sendingMode,
      updatedAt: Date.now(), turns: [...historical, turn].slice(-MAX_TURNS),
    };
    setThreads((current) => [thread, ...current.filter(({ id }) => id !== threadId)].slice(0, MAX_THREADS));
    setActiveId(threadId);
    setBusy(true);
    setProgress(null);
    if (!retry) { setDraft(''); setAttachment(undefined); }
    followReplies.current = true;
    focusPrompt();

    const update = (lane: number, patch: Partial<Answer>) => setThreads((current) => current.map((item) => item.id !== threadId ? item : {
      ...item,
      turns: item.turns.map((entry) => entry.id !== turnId ? entry : {
        ...entry, answers: entry.answers.map((answer, index) => index === lane ? { ...answer, ...patch } : answer),
      }),
    }));
    try {
      await Promise.all(chosen.map(async (id, lane) => {
        let content = '';
        let frame = 0;
        const onText = (delta: string) => {
          if (controller.signal.aborted) return;
          content = (content + delta).slice(0, 36_000);
          if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(lane, { content }); });
        };
        try {
          const messages = buildMessages(historical, turn, lane, id);
          if (id === 'local') {
            const { streamDevice } = await import('./lib/device.ts');
            await streamDevice(messages, controller.signal, onText, setProgress);
          } else await streamHosted(id, messages, controller.signal, onText);
          controller.signal.throwIfAborted();
          if (!content.trim()) throw new ChatError('The model returned an empty reply. Try a shorter prompt or choose another model.');
          update(lane, { state: 'finished', content });
        } catch (error) {
          if (controller.signal.aborted) update(lane, { state: 'stopped', content });
          else update(lane, {
            state: 'error', content,
            error: error instanceof ChatError ? error.message : 'The connection was interrupted. Try again.',
            canUseDevice: error instanceof ChatError && error.canUseDevice,
          });
        } finally { if (frame) cancelAnimationFrame(frame); }
      }));
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; setBusy(false); setProgress(null); }
    }
  }

  const composer = <Composer draft={draft} onDraft={setDraft} textarea={textarea} attachment={attachment} onAttachment={setAttachment}
    onAlert={setToast} onSend={() => void run()} onStop={stop} onChooseModel={() => openModels()} model={model} busy={busy} mode={view} />;
  const compareModels = (compact = false) => <CompareModels models={pair} onChoose={openModels} compact={compact} />;
  const pickPrompt = (prompt: string) => { setDraft(prompt); focusPrompt(); };
  const toggleCompare = () => openView(view === 'compare' ? 'chat' : 'compare');
  const modelDialog = modal?.kind === 'models' ? modal : null;
  const activeLane = modelDialog?.lane;

  return <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}${mobileOpen ? ' sidebar-open' : ''}`}>
    <a href="#main-workspace" className="skip-link">Skip to chat</a>
    <button type="button" className="mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="Close sidebar"><span /></button>
    <Sidebar threads={threads} activeId={activeId} view={view} availability={availability} onNew={() => setNew()} onView={openView}
      onSearch={() => { setMobileOpen(false); setModal({ kind: 'search' }); }} onModels={() => openModels()}
      onSettings={() => { setMobileOpen(false); setModal({ kind: 'settings' }); }} onCollapse={toggleSidebar} onThread={showThread}
      onDelete={(thread) => setModal({ kind: 'delete', thread })} onAbout={() => { setMobileOpen(false); setModal({ kind: 'about' }); }} />
    <main className={`workspace${turns.length ? ' has-chat' : ''}${view === 'compare' ? ' compare-view' : ''}`} id="main-workspace">
      <header className="topbar">
        <div className="topbar-location">
          <button type="button" className="icon-button open-sidebar" onClick={toggleSidebar} title="Open sidebar" aria-label="Open sidebar" aria-controls="workspace-sidebar"><PanelLeftOpen size={19} /></button>
          <span className="topbar-workspace">Workspace</span><span className="breadcrumb-divider">/</span>
          <strong>{view === 'compare' ? 'Compare' : 'Chat'}</strong>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={toggleCompare} className={`compare-switch${view === 'compare' ? ' compare-switch-active' : ''}`}>
            {view === 'compare' ? <ArrowLeft size={16} /> : <Columns2 size={16} />}
            <span>{view === 'compare' ? 'Back to chat' : 'Compare models'}</span>
          </button>
          <span className="topbar-divider" aria-hidden="true" />
          <button type="button" className="icon-button theme-toggle" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
        </div>
      </header>
      {turns.length > 0 && active ? <>
        {view === 'compare' && <div className="compare-thread-header">{compareModels(true)}</div>}
        <div ref={pane} className="conversation-pane" onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          followReplies.current = scrollHeight - scrollTop - clientHeight < 130;
        }}><Transcript thread={active} busy={busy} progress={progress} onRetry={() => void run(turns.at(-1))}
          onDevice={() => { selectModel('local'); void run(turns.at(-1), 'local'); }} onAlert={setToast} /></div>
        <div className="bottom-composer"><div className="compose-width">{composer}</div></div>
      </> : <div className="welcome-scroll">
        <div className="welcome">
          <div className="welcome-heading">
            <HeroMark />
            <span className="workspace-kicker"><Sparkles size={13} strokeWidth={2.1} /> OPEN MODEL WORKSPACE</span>
            {view === 'chat' ? <><h1>What’s on your mind<span>?</span></h1><p>Chat, create, and explore with open AI models.</p></>
              : <><h1>One prompt, two perspectives<span>.</span></h1><p>See how two open models answer the same question.</p></>}
          </div>
          {view === 'compare' && compareModels()}
          {composer}
          {view === 'chat' ? <Suggestions onPick={pickPrompt} /> : <Suggestions onPick={pickPrompt} compact />}
        </div>
      </div>}
      <footer className="main-footer">
        <span>Xyvora can make mistakes. Check important information.</span>
        <button type="button" className="footer-link" onClick={() => setModal({ kind: 'about' })}>About <ArrowUpRight size={12} /></button>
      </footer>
    </main>
    {modelDialog && <ModelDialog value={activeLane === undefined ? model : pair[activeLane]} lane={activeLane} excluded={activeLane === undefined ? undefined : pair[activeLane === 0 ? 1 : 0]}
      availability={availability} onClose={closeModal} onChoose={(id) => {
        if (activeLane === undefined) selectModel(id);
        else if (isHostedModel(id) && HOSTED_MODELS.includes(id)) setPair((current) => activeLane === 0 ? [id, current[1]] : [current[0], id]);
        closeModal(); focusPrompt();
      }} />}
    {modal?.kind === 'search' && <SearchDialog threads={threads} onClose={closeModal} onPick={showThread} />}
    {modal?.kind === 'settings' && <SettingsDialog theme={theme} count={threads.length} onTheme={setTheme} onClose={closeModal}
      onClear={() => { setNew(); setThreads([]); setToast('Chat history cleared.'); }} />}
    {modal?.kind === 'about' && <AboutDialog onClose={closeModal} />}
    {modal?.kind === 'delete' && <Dialog title="Delete conversation?" subtitle="This only deletes the copy saved in this browser." onClose={closeModal}>
      <p className="delete-title">{modal.thread.title}</p>
      <div className="dialog-actions"><button className="secondary-button" type="button" onClick={closeModal}>Cancel</button><button className="danger-button" type="button" onClick={() => deleteThread(modal.thread)}>Delete chat</button></div>
    </Dialog>}
    {toast && <div className="toast" role="status">{toast}<button type="button" className="bare-icon" aria-label="Dismiss notice" onClick={() => setToast('')}><X size={16} /></button></div>}
  </div>;
}
