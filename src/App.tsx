import { ArrowUpRight, Blocks, Download, Moon, PanelLeftOpen, Sparkles, Sun, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_MODEL, MAX_PROMPT, XYVORA_NAME, XYVORA_SITE } from '../shared/models.ts';
import type { Availability } from '../shared/models.ts';
import { ABOUT_PATH, SCHOOLS_PATH, XYVORA_SLOGAN } from '../shared/site.ts';
import { allowsSearchToggle, chatSearchQuery, MAX_SEARCH_QUERY } from '../shared/search.ts';
import { DEFAULT_MODE } from '../shared/modes.ts';
import type { ReplyMode } from '../shared/modes.ts';
import { isProvider, PLUGINS, workspaceIntent } from '../shared/workspace-tools.ts';
import type { PluginIntent } from '../shared/workspace-tools.ts';
import { brandAnswer } from '../shared/branding.ts';
import { fencedText } from '../shared/text-tools.ts';
import { runInstantSkill } from '../shared/skills.ts';
import { BrandLockup } from './components/Brand.tsx';
import { Composer } from './components/Composer.tsx';
import { Dialog } from './components/Dialog.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { ModeDialog } from './components/ModeDialog.tsx';
import { Suggestions } from './components/Suggestions.tsx';
import { Transcript } from './components/Transcript.tsx';
import { AboutDialog, SearchDialog, SettingsDialog } from './components/WorkspaceDialogs.tsx';
import type { Theme } from './components/WorkspaceDialogs.tsx';
import { downloadConversation } from './lib/export-chat.ts';
import { buildMessages, loadThreads, MAX_THREADS, MAX_TURNS, storeThreads, titleForPrompt } from './lib/history.ts';
import type { Answer, Thread, Turn } from './lib/history.ts';
import { combineFiles, MAX_FILES, readLocalFile } from './lib/files.ts';
import type { LocalFile } from './lib/files.ts';
import { ChatError, streamChat } from './lib/stream.ts';

type Modal = { kind: 'delete'; thread: Thread } | { kind: 'plugins'; intent?: PluginIntent } | { kind: 'search' | 'settings' | 'about' | 'mode' };
const PluginsDialog = lazy(() => import('./components/PluginsDialog.tsx').then(({ PluginsDialog }) => ({ default: PluginsDialog })).catch(() => ({
  default: ({ onClose }: { onClose: () => void }) => <Dialog title="Plugins unavailable" onClose={onClose}><p>Couldn’t load the workspace. Check your connection and refresh to try again.</p></Dialog>,
})));

function readTheme(): Theme {
  try { return localStorage.getItem('xyvora.theme') === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}
const emptyTurns: Turn[] = [];

export default function App() {
  const [threads, setThreads] = useState(loadThreads);
  const savedThreads = useRef(threads);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [readingFiles, setReadingFiles] = useState(false);
  const [mode, setMode] = useState<ReplyMode>(DEFAULT_MODE);
  const fileJob = useRef<AbortController | null>(null);
  const [availability, setAvailability] = useState<Availability | 'loading'>('loading');
  const [canSearch, setCanSearch] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const followReplies = useRef(true);
  const active = threads.find((thread) => thread.id === activeId);
  const turns = active?.turns ?? emptyTurns;
  const archived = active?.mode === 'compare';

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/chat', { signal: controller.signal, cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error('Chat status unavailable');
      const data = await response.json();
      if (controller.signal.aborted) return;
      if ((data?.availability !== 'server' && data?.availability !== 'preview') || !data?.models?.includes(DEFAULT_MODEL)) {
        setAvailability('unavailable');
        return;
      }
      setAvailability(data.availability);
      setCanSearch(data.webSearch === true);
    }).catch(() => { if (!controller.signal.aborted) setAvailability('unavailable'); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const flag = url.searchParams.get('connection');
    if (!flag) return;
    const [provider, result] = flag.split('-');
    url.searchParams.delete('connection');
    window.history.replaceState(null, '', url);
    if (!isProvider(provider) || (result !== 'connected' && result !== 'failed')) return;
    setModal({ kind: 'plugins', intent: { id: provider } });
    if (result === 'failed') setToast(`Couldn’t connect ${PLUGINS[provider].name}. Review consent and try again.`);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#181621' : '#f8f7fb');
    try { localStorage.setItem('xyvora.theme', theme); } catch { /* Browser storage may be unavailable. */ }
  }, [theme]);
  useEffect(() => {
    if (busy || savedThreads.current === threads) return;
    if (storeThreads(threads)) savedThreads.current = threads;
    else setToast('This browser could not save chat history.');
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
  function clearFiles() {
    fileJob.current?.abort();
    fileJob.current = null;
    setReadingFiles(false);
    setFiles([]);
  }
  async function attachFiles(items: File[]) {
    if (fileJob.current || controllerRef.current || files.length >= MAX_FILES || !items.length) return;
    const added = items.slice(0, MAX_FILES - files.length);
    const controller = new AbortController();
    fileJob.current = controller;
    setReadingFiles(true);
    const results: LocalFile[] = [];
    let warning = items.length > added.length ? `Attach up to ${MAX_FILES} files at a time.` : '';
    try {
      for (const file of added) {
        if (controller.signal.aborted) return;
        try { results.push(await readLocalFile(file, controller.signal)); }
        catch (error) { if (!warning) warning = error instanceof Error ? error.message : 'Could not read this file.'; }
      }
      if (controller.signal.aborted) return;
      setFiles((current) => [...current, ...results].slice(0, MAX_FILES));
      if (warning) setToast(warning);
      focusPrompt();
    } finally {
      if (fileJob.current === controller) { fileJob.current = null; setReadingFiles(false); }
    }
  }
  function setNew() {
    stop();
    setActiveId(null);
    setMode(DEFAULT_MODE);
    setDraft('');
    clearFiles();
    setWebSearch(false);
    setMobileOpen(false);
    followReplies.current = true;
    focusPrompt();
  }
  function showThread(thread: Thread) {
    if (thread.id !== activeId) stop();
    setActiveId(thread.id);
    setMode(thread.turns.at(-1)?.answers[0]?.replyMode ?? DEFAULT_MODE);
    setDraft('');
    clearFiles();
    setWebSearch(false);
    setMobileOpen(false);
    setModal(null);
    followReplies.current = true;
    if (pane.current) pane.current.scrollTop = pane.current.scrollHeight;
  }
  function deleteThread(thread: Thread) {
    if (thread.id === activeId) setNew();
    setThreads((current) => current.filter(({ id }) => id !== thread.id));
    closeModal();
    setToast('Conversation deleted.');
  }
  function toggleSidebar() {
    if (matchMedia('(max-width: 760px)').matches) setMobileOpen((open) => !open);
    else setCollapsed((closed) => !closed);
  }
  function openPlugins(intent?: PluginIntent) { setMobileOpen(false); setModal({ kind: 'plugins', intent }); }
  function toggleTheme() { setTheme((current) => current === 'dark' ? 'light' : 'dark'); }

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'k') {
        event.preventDefault();
        setModal({ kind: 'search' });
      } else if ((event.metaKey || event.ctrlKey) && key === '/') {
        event.preventDefault(); openPlugins();
      } else if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === 'o') {
        event.preventDefault(); closeModal(); setNew();
      } else if (key === 'escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);

  async function run(retry?: Turn) {
    const prompt = retry?.prompt ?? draft.trim();
    if (controllerRef.current || fileJob.current || archived || !prompt) return;
    const external = workspaceIntent(prompt);
    if (external) {
      // This is a proposal, not a call. The draft and files stay in the composer.
      const file = files[0];
      if (external.id === 'script' && !external.input && files.length === 1 && /\.(js|mjs)$/i.test(file.name)) {
        if (file.truncated) setToast('The JavaScript file is an excerpt. Paste a complete script into Script Lab.');
        else external.input = file.text;
      }
      openPlugins(external);
      return;
    }
    const attached = retry ? retry.attachment : combineFiles(files);
    const searchQuery = chatSearchQuery(prompt, !retry && webSearch) ?? (allowsSearchToggle(prompt) ? retry?.searchQuery : undefined);
    const skill = searchQuery === undefined ? runInstantSkill(prompt, attached?.text) : undefined;
    if (searchQuery !== undefined) {
      if (!canSearch) { setToast(`Web search needs the live chat on ${XYVORA_SITE}.`); return; }
      if (!searchQuery.trim() || searchQuery.length > MAX_SEARCH_QUERY) {
        setToast(`Enter 1–${MAX_SEARCH_QUERY} characters for Web search.`);
        return;
      }
    }
    const historical = retry ? turns.slice(0, -1) : turns;
    const threadId = activeId ?? crypto.randomUUID();
    const turnId = retry?.id ?? crypto.randomUUID();
    const turn: Turn = {
      id: turnId, prompt, searchQuery, attachment: attached,
      answers: [skill ? { model: DEFAULT_MODEL, content: skill.text, replyMode: mode, state: 'finished', source: 'skill', skill: skill.id }
        : { model: DEFAULT_MODEL, content: '', replyMode: mode, state: 'working' }],
    };
    const thread: Thread = {
      id: threadId, title: active?.title ?? titleForPrompt(prompt), mode: 'chat',
      updatedAt: Date.now(), turns: [...historical, turn].slice(-MAX_TURNS),
    };
    setThreads((current) => [thread, ...current.filter(({ id }) => id !== threadId)].slice(0, MAX_THREADS));
    setActiveId(threadId);
    if (!retry) { setDraft(''); clearFiles(); setWebSearch(false); }
    followReplies.current = true;
    focusPrompt();
    if (skill) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    const update = (patch: Partial<Answer>) => setThreads((current) => current.map((item) => item.id !== threadId ? item : {
      ...item,
      turns: item.turns.map((entry) => entry.id !== turnId ? entry : { ...entry, answers: [{ ...entry.answers[0], ...patch }] }),
    }));
    let content = '';
    let frame = 0;
    try {
      await streamChat(buildMessages(historical, turn, mode), controller.signal, {
        searchQuery, attachment: attached, mode,
        onText: (delta) => {
          if (controller.signal.aborted) return;
          content = (content + delta).slice(0, 36_000);
          if (!frame) frame = requestAnimationFrame(() => { frame = 0; update({ content }); });
        },
        onSource: (source, skill) => update({ source, skill }),
        onSources: (sources) => update({ sources }),
      });
      controller.signal.throwIfAborted();
      if (!content.trim()) throw new ChatError('The server returned an empty reply. Try rephrasing your question.');
      update({ state: 'finished', content });
    } catch (error) {
      if (controller.signal.aborted) update({ state: 'stopped', content });
      else update({ state: 'error', content, error: error instanceof ChatError ? brandAnswer(error.message) : 'The connection was interrupted. Try again.' });
    } finally {
      if (frame) cancelAnimationFrame(frame);
      if (controllerRef.current === controller) { controllerRef.current = null; setBusy(false); }
    }
  }

  const composer = <Composer draft={draft} onDraft={setDraft} textarea={textarea} files={files} onAttach={(items) => void attachFiles(items)}
    onRemoveFile={(id) => setFiles((current) => current.filter((file) => file.id !== id))} readingFiles={readingFiles}
    mode={mode} onMode={() => setModal({ kind: 'mode' })} onSend={() => void run()} onStop={stop} busy={busy} webSearch={webSearch} canSearch={canSearch}
    onToggleSearch={() => { setWebSearch((enabled) => !enabled); focusPrompt(); }} />;
  function pickPrompt(prompt: string, search = false) {
    if (archived) setNew();
    setMobileOpen(false);
    if (search && !canSearch) { setToast(`Web search needs the live chat on ${XYVORA_SITE}.`); return; }
    setWebSearch(search);
    if (prompt) setDraft(prompt);
    focusPrompt();
  }

  function insertToolOutput(content: string) {
    if (archived) setNew();
    else clearFiles();
    setWebSearch(false);
    setDraft(`Tool output (reference data):\n\n${fencedText(content.slice(0, MAX_PROMPT - 100))}`.slice(0, MAX_PROMPT));
    closeModal();
    focusPrompt();
  }

  return <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}${mobileOpen ? ' sidebar-open' : ''}`}>
    <a href="#main-workspace" className="skip-link">Skip to chat</a>
    <button type="button" className="mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="Close sidebar"><span /></button>
    <Sidebar threads={threads} activeId={activeId} availability={availability} onNew={setNew}
      onSearch={() => { setMobileOpen(false); setModal({ kind: 'search' }); }} onPlugins={() => openPlugins()} onWebSearch={() => pickPrompt('/search ', true)}
      onImage={() => openPlugins({ id: 'image' })} onSettings={() => { setMobileOpen(false); setModal({ kind: 'settings' }); }}
      onCollapse={toggleSidebar} onThread={showThread} onDelete={(thread) => setModal({ kind: 'delete', thread })}
      onAbout={() => { setMobileOpen(false); setModal({ kind: 'about' }); }} />
    <main className={`workspace${turns.length ? ' has-chat' : ''}`} id="main-workspace">
      <header className="topbar">
        <div className="topbar-location">
          <button type="button" className="icon-button open-sidebar" onClick={toggleSidebar} title="Open sidebar" aria-label="Open sidebar" aria-controls="workspace-sidebar"><PanelLeftOpen size={19} /></button>
          <span className="topbar-workspace">{XYVORA_NAME}</span><span className="breadcrumb-divider">/</span>
          <strong>{archived ? 'Archive' : 'Chat'}</strong>
        </div>
        <div className="topbar-actions">
          <button type="button" className="plugins-button" aria-haspopup="dialog" aria-keyshortcuts="Control+/ Meta+/" onClick={() => openPlugins()}><Blocks size={16} /><span>Plugins</span></button>
          {active && turns.length > 0 && <button type="button" className="icon-button export-button" aria-label="Download conversation as Markdown" title="Download conversation as Markdown" onClick={() => downloadConversation(active)}><Download size={17} /></button>}
          <span className="topbar-divider" aria-hidden="true" />
          <button type="button" className="icon-button theme-toggle" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
        </div>
      </header>
      {turns.length > 0 && active ? <>
        <div ref={pane} className="conversation-pane" onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          followReplies.current = scrollHeight - scrollTop - clientHeight < 130;
        }}><Transcript thread={active} busy={busy} onRetry={archived ? undefined : () => void run(turns.at(-1))} onAlert={setToast} /></div>
        <div className="bottom-composer"><div className="compose-width">{archived ? <div className="archive-notice"><span>Earlier comparison · read-only</span><button type="button" className="secondary-button" onClick={setNew}>New chat</button></div> : composer}</div></div>
      </> : <div className="welcome-scroll">
        <div className="welcome">
          <div className="welcome-heading">
            <BrandLockup dark={theme === 'dark'} />
            <span className="workspace-kicker"><Sparkles size={13} strokeWidth={2.1} /> {XYVORA_SLOGAN}</span>
            <h1>What’s on your mind<span>?</span></h1><p>Ask a question, bring a file, or make something with <strong>{XYVORA_NAME}</strong>.</p>
          </div>
          {composer}
          <Suggestions onPick={pickPrompt} onImage={() => openPlugins({ id: 'image' })} />
          <p className="workspace-tip">Try <code>/tools</code> for built-in tools, or ask “What time is it in Tokyo?”</p>
        </div>
      </div>}
      <footer className="main-footer">
        <span>{XYVORA_NAME} can make mistakes. Check important information.</span>
        <nav className="footer-nav" aria-label="About Xyvora">
          <a className="footer-link" href={ABOUT_PATH}>About <ArrowUpRight size={12} /></a>
          <a className="footer-link" href={SCHOOLS_PATH}>For schools <ArrowUpRight size={12} /></a>
        </nav>
      </footer>
    </main>
    {modal?.kind === 'search' && <SearchDialog threads={threads} onClose={closeModal} onPick={showThread} />}
    {modal?.kind === 'settings' && <SettingsDialog theme={theme} count={threads.length} onTheme={setTheme} onClose={closeModal}
      onClear={() => { setNew(); setThreads([]); setToast('Chat history cleared.'); }} />}
    {modal?.kind === 'mode' && <ModeDialog mode={mode} onPick={(value) => { setMode(value); closeModal(); focusPrompt(); }} onClose={closeModal} />}
    {modal?.kind === 'plugins' && <Suspense fallback={<Dialog title="Plugins" subtitle="Opening the workspace…" onClose={closeModal}><span role="status">Loading…</span></Dialog>}>
      <PluginsDialog key={modal.intent?.id ?? 'list'} intent={modal.intent} textInput={combineFiles(files)?.text} onInsert={insertToolOutput} onClose={closeModal} />
    </Suspense>}
    {modal?.kind === 'about' && <AboutDialog onClose={closeModal} />}
    {modal?.kind === 'delete' && <Dialog title="Delete conversation?" subtitle="This only deletes the copy saved in this browser." onClose={closeModal}>
      <p className="delete-title">{modal.thread.title}</p>
      <div className="dialog-actions"><button className="secondary-button" type="button" onClick={closeModal}>Cancel</button><button className="danger-button" type="button" onClick={() => deleteThread(modal.thread)}>Delete chat</button></div>
    </Dialog>}
    {toast && <div className="toast" role="status">{toast}<button type="button" className="bare-icon" aria-label="Dismiss notice" onClick={() => setToast('')}><X size={16} /></button></div>}
  </div>;
}
