import { ArrowUpRight, Blocks, Download, GitBranch, ListTree, Moon, PanelLeftOpen, Shield, Sparkles, Sun, UserRound, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { guestAccount } from '../shared/account.ts';
import type { AccountStatus } from '../shared/account.ts';
import { isVisionFile, MAX_VISION_QUESTION } from '../shared/media.ts';
import { MAX_MEMORY_NOTE, memoryForSend } from '../shared/memory.ts';
import type { MemoryProfile } from '../shared/memory.ts';
import { readSkillCommand } from '../shared/skill-catalog.ts';
import { DEFAULT_MODEL, MAX_ATTACHMENT, MAX_PROMPT, XYVORA_NAME, XYVORA_SITE } from '../shared/models.ts';
import type { Availability, TextAttachment } from '../shared/models.ts';
import { ABOUT_PATH, SCHOOLS_PATH, XYVORA_SLOGAN } from '../shared/site.ts';
import { allowsSearchToggle, chatSearchQuery, MAX_SEARCH_QUERY } from '../shared/search.ts';
import { DEFAULT_MODE } from '../shared/modes.ts';
import type { ReplyMode } from '../shared/modes.ts';
import { isProvider, PLUGINS, workspaceIntent } from '../shared/workspace-tools.ts';
import type { RepoWorkbenchDraft } from '../shared/repositories.ts';
import type { PluginIntent } from '../shared/workspace-tools.ts';
import { brandAnswer } from '../shared/branding.ts';
import { fencedText } from '../shared/text-tools.ts';
import { runInstantSkill } from '../shared/skills.ts';
import { AccountDialog, MemoryDialog } from './components/AccountDialogs.tsx';
import { TasksDialog } from './components/TasksDialog.tsx';
import { VisionDialog } from './components/VisionDialog.tsx';
import { BrandLockup } from './components/Brand.tsx';
import { BranchDialog, ContextDialog } from './components/ChatControls.tsx';
import { Composer } from './components/Composer.tsx';
import { Dialog } from './components/Dialog.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { ModeDialog } from './components/ModeDialog.tsx';
import { Suggestions } from './components/Suggestions.tsx';
import { Transcript } from './components/Transcript.tsx';
import { AboutDialog, SearchDialog, SettingsDialog } from './components/WorkspaceDialogs.tsx';
import type { Theme } from './components/WorkspaceDialogs.tsx';
import { accountChangeKey, accountMemoryChangeKey, guestMemoryKey, loadAccount, loadAccountMemory, loadGuestMemory, notifyAccountChange } from './lib/account.ts';
import { downloadConversation } from './lib/export-chat.ts';
import { buildMessages, forkThread, loadThreads, MAX_THREADS, MAX_TURNS, storeThreads, titleForPrompt } from './lib/history.ts';
import type { Answer, Thread, Turn } from './lib/history.ts';
import { combineFiles, MAX_FILES, readLocalFile } from './lib/files.ts';
import type { LocalFile } from './lib/files.ts';
import { ChatError, streamChat } from './lib/stream.ts';
import { photoBase64, prepareVisionPhoto } from './lib/vision-file.ts';
import type { VisionPhoto } from './lib/vision-file.ts';
import { approveTool, getWorkspace } from './lib/workspace-api.ts';

type ForkKind = 'edit' | 'reply';
type Modal = { kind: 'delete'; thread: Thread } | { kind: 'plugins'; intent?: PluginIntent }
  | { kind: 'fork'; turnId: string; fork: ForkKind } | { kind: 'memory'; initial?: string }
  | { kind: 'search' | 'settings' | 'about' | 'mode' | 'context' | 'account' | 'vision' | 'tasks' };
const PluginsDialog = lazy(() => import('./components/PluginsDialog.tsx').then(({ PluginsDialog }) => ({ default: PluginsDialog })).catch(() => ({
  default: ({ onClose }: { onClose: () => void }) => <Dialog title="Plugins unavailable" onClose={onClose}><p>Couldn’t load the workspace. Check your connection and refresh to try again.</p></Dialog>,
})));

function readTheme(): Theme {
  try { return localStorage.getItem('xyvora.theme') === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}
const emptyTurns: Turn[] = [];

const guest = guestAccount();

export default function App() {
  const [chatStatus, setChatStatus] = useState<{ availability: Availability | 'loading'; canSearch: boolean }>({ availability: 'loading', canSearch: false });
  useEffect(() => {
    const controller = new AbortController();
    // Status doesn't depend on identity: verify the session and warm the chat
    // endpoint in parallel, without showing another account's history.
    fetch('/api/chat', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]), cache: 'no-store', credentials: 'omit' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Chat status unavailable');
        const data = await response.json();
        if (controller.signal.aborted) return;
        const available = (data?.availability === 'server' || data?.availability === 'preview') && data?.models?.includes(DEFAULT_MODEL);
        setChatStatus({ availability: available ? data.availability : 'unavailable', canSearch: available && data.webSearch === true });
      }).catch(() => { if (!controller.signal.aborted) setChatStatus({ availability: 'unavailable', canSearch: false }); });
    return () => controller.abort();
  }, []);
  const [session, setSession] = useState<{ account: AccountStatus; error?: string }>();
  const [check, setCheck] = useState(0);
  const refresh = () => { setSession(undefined); setCheck((value) => value + 1); };
  useEffect(() => {
    const controller = new AbortController();
    loadAccount(controller.signal).then((account) => {
      if (controller.signal.aborted) return;
      if (account.user && new URLSearchParams(window.location.search).get('account') === 'signed-in') notifyAccountChange();
      setSession({ account });
    }).catch(() => {
      if (!controller.signal.aborted) setSession({ account: guest, error: 'Could not verify sign-in. You’re using the guest workspace.' });
    });
    return () => controller.abort();
  }, [check]);
  useEffect(() => {
    const storage = (event: StorageEvent) => { if (event.key === accountChangeKey) refresh(); };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    window.addEventListener('storage', storage);
    window.addEventListener('pageshow', restore);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener('pageshow', restore); };
  }, []);
  // Keep chat, drafts, and memory in a fresh component when the identity changes.
  // No guest history is loaded before the server checks a possible session.
  return <Workspace key={session ? session.account.user?.id ?? 'guest' : 'checking'} account={session?.account ?? guest}
    checking={!session} chatStatus={chatStatus} accountError={session?.error} onCheckAccount={refresh} />;
}

function Workspace({ account, checking, chatStatus: { availability, canSearch }, accountError, onCheckAccount }: { account: AccountStatus; checking: boolean; chatStatus: { availability: Availability | 'loading'; canSearch: boolean }; accountError?: string; onCheckAccount: () => void }) {
  const accountId = account.user?.id;
  const [threads, setThreads] = useState(() => checking ? [] : loadThreads(accountId));
  const savedThreads = useRef(threads);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Temporary conversations and unsent branches never enter the saved list.
  const [scratch, setScratch] = useState<{ thread: Thread | null } | null>(null);
  const [branchDraft, setBranchDraft] = useState<{ thread: Thread; originalId: string } | null>(null);
  const [isolated, setIsolated] = useState(false);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [photo, setPhoto] = useState<VisionPhoto>();
  const filePicker = useRef<HTMLInputElement>(null);
  const repositoryDraft = useRef<RepoWorkbenchDraft | undefined>(undefined);
  const [memory, setMemory] = useState<MemoryProfile | undefined>(() => accountId || checking ? undefined : loadGuestMemory());
  const [memoryError, setMemoryError] = useState('');
  const [memoryRequest, setMemoryRequest] = useState(0);
  const [readingFiles, setReadingFiles] = useState(false);
  const [mode, setMode] = useState<ReplyMode>(DEFAULT_MODE);
  const fileJob = useRef<AbortController | null>(null);
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
  const temporary = scratch !== null;
  const active = temporary ? scratch.thread ?? undefined : branchDraft?.thread ?? threads.find((thread) => thread.id === activeId);
  const turns = active?.turns ?? emptyTurns;
  const archived = active?.mode === 'compare';
  const forkTurn = modal?.kind === 'fork' ? turns.find(({ id }) => id === modal.turnId) : undefined;

  useEffect(() => {
    if (checking) return;
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get('account');
    const flag = url.searchParams.get('connection');
    if (outcome || flag) {
      url.searchParams.delete('account');
      url.searchParams.delete('connection');
      window.history.replaceState(null, '', url);
    }
    if (outcome === 'signed-in' && account.user) setToast('You’re signed in to Xyvora.');
    else if (outcome === 'signed-in' || outcome === 'failed') {
      setModal({ kind: 'account' });
      setToast('Couldn’t finish sign-in. Try the provider again.');
    }
    if (!flag) return;
    const [provider, result] = flag.split('-');
    if (!isProvider(provider) || (result !== 'connected' && result !== 'failed')) return;
    setModal({ kind: 'plugins', intent: { id: provider } });
    if (result === 'failed') setToast(`Couldn’t connect ${PLUGINS[provider].name}. Review consent and try again.`);
  }, [account, checking]);

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    loadAccountMemory(accountId, controller.signal).then((value) => {
      if (!controller.signal.aborted) setMemory(value);
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setMemoryError(error.message);
    });
    return () => controller.abort();
  }, [accountId, memoryRequest]);
  useEffect(() => {
    if (checking) return;
    const reload = (event: StorageEvent) => {
      if (!accountId && (event.key === guestMemoryKey || event.key === null)) setMemory(loadGuestMemory());
      if (accountId && event.key === accountMemoryChangeKey(accountId)) {
        setMemory(undefined); setMemoryError(''); setMemoryRequest((value) => value + 1);
      }
    };
    window.addEventListener('storage', reload);
    return () => window.removeEventListener('storage', reload);
  }, [accountId, checking]);
  useEffect(() => () => { controllerRef.current?.abort(); fileJob.current?.abort(); }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#181621' : '#f8f7fb');
    try { localStorage.setItem('xyvora.theme', theme); } catch { /* Browser storage may be unavailable. */ }
  }, [theme]);
  useEffect(() => {
    if (checking || busy || savedThreads.current === threads) return;
    if (storeThreads(threads, accountId)) savedThreads.current = threads;
    else setToast('This browser could not save chat history.');
  }, [threads, busy, accountId, checking]);
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
    setPhoto(undefined);
  }
  async function attachFiles(items: File[]) {
    if (checking || fileJob.current || controllerRef.current || !items.length || photo) return;
    const images = items.filter(isVisionFile);
    if (images.length) {
      if (images.length !== 1 || items.length !== 1 || files.length) {
        setToast('Attach one image at a time, without other files.'); return;
      }
      const controller = new AbortController();
      fileJob.current = controller;
      setReadingFiles(true);
      try {
        // A capability check is a GET, not a file upload.
        const status = await getWorkspace(controller.signal);
        if (!status.hostedVision) throw new Error('Image analysis needs a provider configured by the site owner.');
        const prepared = await prepareVisionPhoto(images[0], controller.signal);
        controller.signal.throwIfAborted();
        setPhoto(prepared);
        setWebSearch(false);
        focusPrompt();
      } catch (error) {
        if (!controller.signal.aborted) setToast(error instanceof Error ? error.message : 'Could not read the image.');
      } finally {
        if (fileJob.current === controller) { fileJob.current = null; setReadingFiles(false); }
      }
      return;
    }
    if (items.some(({ type }) => type.startsWith('image/'))) { setToast('Choose a JPEG, PNG, or WebP image.'); return; }
    if (files.length >= MAX_FILES) return;
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
  function startChat(temporary: boolean) {
    stop();
    setActiveId(null);
    setScratch(temporary ? { thread: null } : null);
    setBranchDraft(null);
    setIsolated(false);
    setMode(DEFAULT_MODE);
    setDraft('');
    clearFiles();
    setWebSearch(false);
    setMobileOpen(false);
    closeModal();
    followReplies.current = true;
    focusPrompt();
  }
  const setNew = () => startChat(false);
  function showThread(thread: Thread) {
    if (thread.id !== active?.id) stop();
    setScratch(null);
    setBranchDraft(null);
    setActiveId(thread.id);
    const latest = thread.turns.at(-1);
    setMode(latest?.answers[0]?.replyMode ?? DEFAULT_MODE);
    setIsolated(latest?.contextOnly === true);
    setDraft('');
    clearFiles();
    setWebSearch(false);
    setMobileOpen(false);
    closeModal();
    followReplies.current = true;
    if (pane.current) pane.current.scrollTop = pane.current.scrollHeight;
  }
  function openFork(turn: Turn, fork: ForkKind) {
    if (threads.length >= MAX_THREADS) { setToast('Delete a saved chat before starting a branch.'); return; }
    setModal({ kind: 'fork', turnId: turn.id, fork });
  }
  function startFork(turn: Turn, fork: ForkKind, carryAttachment: boolean) {
    if (!active || temporary || branchDraft || controllerRef.current) return;
    const branch = forkThread(active, turn.id, fork);
    if (!branch) { closeModal(); setToast('That turn can no longer be branched.'); return; }
    showThread(branch);
    setBranchDraft({ thread: branch, originalId: active.id });
    if (fork === 'edit') {
      setDraft(turn.prompt.slice(0, MAX_PROMPT));
      setMode(turn.answers[0]?.replyMode ?? DEFAULT_MODE);
      setIsolated(turn.contextOnly === true);
      if (carryAttachment && turn.attachment) setFiles([{ ...turn.attachment, id: crypto.randomUUID(), truncated: false }]);
    }
    focusPrompt();
  }
  function cancelFork() {
    const original = threads.find(({ id }) => id === branchDraft?.originalId);
    if (original) showThread(original);
    else setNew();
    focusPrompt();
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
  function openAccount() { if (!checking) { setMobileOpen(false); setModal({ kind: 'account' }); } }
  function openMemory(initial?: string) { if (!checking) { setMobileOpen(false); setModal({ kind: 'memory', initial }); } }
  function pickPhoto() {
    if (checking || controllerRef.current || fileJob.current) return;
    if (archived) setNew();
    else closeModal();
    if (photo) { focusPrompt(); return; }
    if (files.length) { setToast('Remove text attachments before adding an image.'); focusPrompt(); return; }
    requestAnimationFrame(() => filePicker.current?.click());
  }
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

  async function run(retry?: Turn, accessCode?: string) {
    const prompt = retry?.prompt ?? draft.trim();
    if (checking || controllerRef.current || fileJob.current || archived || !prompt || retry?.imageName) return;
    const picture = retry ? undefined : photo;
    if (picture && prompt.length > MAX_VISION_QUESTION) return;
    if (picture && !accessCode) { setModal({ kind: 'vision' }); return; }
    const remember = !picture && !retry ? /^\/remember(?:\s+([\s\S]*))?$/i.exec(prompt) : null;
    if (remember) {
      const note = remember[1]?.trim();
      if (note && (note.length > MAX_MEMORY_NOTE || /[\x00-\x1f\x7f]/.test(note))) { setToast(`Write one memory note, up to ${MAX_MEMORY_NOTE} characters.`); return; }
      openMemory(note); return;
    }
    if (branchDraft && threads.length >= MAX_THREADS) { setToast('Delete a saved chat before saving this branch.'); return; }
    const external = picture ? undefined : workspaceIntent(prompt);
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
    const attached = picture ? undefined : retry ? retry.attachment : combineFiles(files);
    const searchQuery = picture ? undefined : chatSearchQuery(prompt, !retry && webSearch) ?? (allowsSearchToggle(prompt) ? retry?.searchQuery : undefined);
    const skill = !picture && searchQuery === undefined ? runInstantSkill(prompt, attached?.text) : undefined;
    if (searchQuery !== undefined) {
      if (!canSearch) { setToast(`Web search needs the live chat on ${XYVORA_SITE}.`); return; }
      if (!searchQuery.trim() || searchQuery.length > MAX_SEARCH_QUERY) {
        setToast(`Enter 1–${MAX_SEARCH_QUERY} characters for Web search.`);
        return;
      }
    }
    const historical = retry ? turns.slice(0, -1) : turns;
    const threadId = active?.id ?? crypto.randomUUID();
    const turnId = retry?.id ?? crypto.randomUUID();
    const turn: Turn = {
      id: turnId, prompt, searchQuery, attachment: attached, imageName: picture?.name,
      // Retrying must not relax the historical turn’s isolation, or the
      // stricter setting the user selected before pressing Retry.
      contextOnly: (retry?.contextOnly || isolated) ? true : undefined,
      answers: [skill ? { model: DEFAULT_MODEL, content: skill.text, replyMode: mode, state: 'finished', source: 'skill', skill: skill.id }
        : { model: DEFAULT_MODEL, content: '', replyMode: picture ? undefined : mode, source: picture ? 'vision' : undefined, state: 'working' }],
    };
    const thread: Thread = {
      id: threadId, title: active?.title ?? titleForPrompt(prompt), mode: 'chat',
      updatedAt: Date.now(), turns: [...historical, turn].slice(-MAX_TURNS),
    };
    if (temporary) setScratch({ thread });
    else {
      setThreads((current) => [thread, ...current.filter(({ id }) => id !== threadId)].slice(0, MAX_THREADS));
      setBranchDraft(null);
      setActiveId(threadId);
    }
    if (!retry && !picture) { setDraft(''); clearFiles(); setWebSearch(false); }
    followReplies.current = true;
    focusPrompt();
    if (skill) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    const update = (patch: Partial<Answer>) => {
      const apply = (item: Thread): Thread => item.id !== threadId ? item : {
        ...item,
        turns: item.turns.map((entry) => entry.id !== turnId ? entry : { ...entry, answers: [{ ...entry.answers[0], ...patch }] }),
      };
      if (temporary) setScratch((current) => current?.thread?.id === threadId ? { thread: apply(current.thread) } : current);
      else setThreads((current) => current.map(apply));
    };
    let content = '';
    let frame = 0;
    try {
      if (picture) {
        const image = await photoBase64(picture.blob, controller.signal);
        const result = await approveTool<{ text: string }>({ action: 'vision', image, prompt, accessCode }, controller.signal);
        controller.signal.throwIfAborted();
        if (typeof result.text !== 'string') throw new ChatError('Image analysis did not return a reply.');
        content = result.text.slice(0, 4_000);
        if (content.trim()) { setPhoto(undefined); setDraft(''); }
      } else await streamChat(buildMessages(historical, turn, mode), controller.signal, {
        searchQuery, attachment: attached, mode,
        memory: readSkillCommand(prompt)?.id === 'translate' ? undefined : memoryForSend(memory, temporary, !!turn.contextOnly),
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
      else update({ state: 'error', content, error: error instanceof Error && (picture || error instanceof ChatError) ? brandAnswer(error.message) : 'The connection was interrupted. Try again.' });
    } finally {
      if (frame) cancelAnimationFrame(frame);
      if (controllerRef.current === controller) { controllerRef.current = null; setBusy(false); }
    }
  }

  const composer = <Composer draft={draft} onDraft={setDraft} textarea={textarea} files={files} photo={photo} filePicker={filePicker} checking={checking}
    usesMemory={readSkillCommand(draft)?.id !== 'translate' && !!memoryForSend(memory, temporary, isolated)} onRemovePhoto={() => setPhoto(undefined)} onAttach={(items) => void attachFiles(items)}
    onRemoveFile={(id) => setFiles((current) => current.filter((file) => file.id !== id))} readingFiles={readingFiles}
    mode={mode} onMode={() => setModal({ kind: 'mode' })} onSend={() => void run()} onStop={stop} busy={busy} isolated={isolated} webSearch={webSearch} canSearch={canSearch}
    onToggleSearch={() => { setWebSearch((enabled) => !enabled); focusPrompt(); }} />;
  function pickPrompt(prompt: string, search = false) {
    if (archived) setNew();
    setMobileOpen(false);
    if (search && photo) { setToast('Remove the attached image before using Web search.'); return; }
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

  function attachRepoFile(attachment: TextAttachment, copy: RepoWorkbenchDraft) {
    if (checking || fileJob.current || controllerRef.current) { setToast('Finish the current response or file read first.'); return; }
    if (!archived && (photo || files.length >= MAX_FILES)) { setToast('Remove an attachment before adding a repository file.'); return; }
    const file = { ...attachment, text: attachment.text.slice(0, MAX_ATTACHMENT), id: crypto.randomUUID(), truncated: attachment.text.length > MAX_ATTACHMENT };
    if (archived) { setNew(); setFiles([file]); }
    else setFiles((current) => [...current, file]);
    if (/^\/repo(?:\s|$)/i.test(draft.trim())) setDraft('');
    setWebSearch(false);
    repositoryDraft.current = copy;
    closeModal(); focusPrompt();
    setToast('Repository text added to the draft.');
  }

  return <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}${mobileOpen ? ' sidebar-open' : ''}`}>
    <a href="#main-workspace" className="skip-link">Skip to chat</a>
    <button type="button" className="mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="Close sidebar"><span /></button>
    <Sidebar threads={threads} activeId={activeId} availability={availability} temporary={temporary} memoryOn={memory?.enabled === true} signedIn={!!accountId} onMemory={() => openMemory()} onNew={setNew}
      onTemporary={() => { if (temporary) { setMobileOpen(false); focusPrompt(); } else startChat(true); }}
      onSearch={() => { setMobileOpen(false); setModal({ kind: 'search' }); }} onPlugins={() => openPlugins()} onWebSearch={() => pickPrompt('/search ', true)}
      onRepo={() => openPlugins({ id: 'repo' })} onTasks={() => { setMobileOpen(false); setModal({ kind: 'tasks' }); }}
      onImage={() => openPlugins({ id: 'image' })} onSettings={() => { setMobileOpen(false); setModal({ kind: 'settings' }); }}
      onCollapse={toggleSidebar} onThread={showThread} onDelete={(thread) => setModal({ kind: 'delete', thread })}
      onAbout={() => { setMobileOpen(false); setModal({ kind: 'about' }); }} />
    <main className={`workspace${turns.length ? ' has-chat' : ''}`} id="main-workspace">
      <header className="topbar">
        <div className="topbar-location">
          <button type="button" className="icon-button open-sidebar" onClick={toggleSidebar} title="Open sidebar" aria-label="Open sidebar" aria-controls="workspace-sidebar"><PanelLeftOpen size={19} /></button>
          <span className="topbar-workspace">{XYVORA_NAME}</span><span className="breadcrumb-divider">/</span>
          <strong>{archived ? 'Archive' : temporary ? 'Temporary' : branchDraft ? 'Branch' : 'Chat'}</strong>
        </div>
        <div className="topbar-actions">
          <button type="button" className="plugins-button" aria-label="Plugins" aria-haspopup="dialog" aria-keyshortcuts="Control+/ Meta+/" onClick={() => openPlugins()}><Blocks size={16} /><span>Plugins</span></button>
          {!archived && <button type="button" className={`context-button${isolated ? ' context-isolated' : ''}`} aria-label="Message context" title={isolated ? 'Message context: This message only' : 'Message context: Recent chat'} aria-haspopup="dialog" disabled={busy} onClick={() => setModal({ kind: 'context' })}><ListTree size={16} /><span>Context</span></button>}
          {active && !temporary && !branchDraft && turns.length > 0 && <button type="button" className="icon-button export-button" aria-label="Download conversation as Markdown" title="Download conversation as Markdown" onClick={() => downloadConversation(active)}><Download size={17} /></button>}
          <button type="button" className="identity-button" aria-label={accountId ? 'Your account' : 'Sign in'} aria-haspopup="dialog" title={accountId ? 'Your account' : 'Sign in or create an account'}
            disabled={checking} onClick={openAccount}><UserRound size={16} /><span>{accountId ? 'Account' : 'Sign in'}</span></button>
          <span className="topbar-divider" aria-hidden="true" />
          <button type="button" className="icon-button theme-toggle" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
        </div>
      </header>
      {temporary && <aside className="chat-notice" aria-label="Temporary chat privacy"><Shield size={17} /><div><strong>Temporary chat</strong><p>Not saved in history and never uses memory. Messages and attachments can still be sent for replies.</p></div><button type="button" className="secondary-button" aria-label="End temporary chat" onClick={setNew}>End chat</button></aside>}
      {branchDraft && <aside className="chat-notice" aria-label="Branch draft"><GitBranch size={17} /><div><strong>New branch</strong><p>Your original stays intact. This branch is saved separately when you send.</p></div><button type="button" className="secondary-button" aria-label="Cancel branch" onClick={cancelFork}>Cancel</button></aside>}
      {turns.length > 0 && active ? <>
        <div ref={pane} className="conversation-pane" onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          followReplies.current = scrollHeight - scrollTop - clientHeight < 130;
        }}><Transcript thread={active} busy={busy} onRetry={archived || branchDraft ? undefined : () => void run(turns.at(-1))}
          onFork={archived || temporary || branchDraft ? undefined : openFork} onAlert={setToast} /></div>
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
        <nav className="footer-nav" aria-label="Xyvora resources">
          <a className="footer-link" href={ABOUT_PATH}>About <ArrowUpRight size={12} /></a>
          <a className="footer-link" href={SCHOOLS_PATH}>For schools</a>
          <a className="footer-link" href="/developers">API</a>
          <a className="footer-link" href="/analytics">Analytics</a>
          <a className="footer-link" href="/terms">Terms</a>
          <a className="footer-link" href="/privacy">Privacy</a>
          <a className="footer-link" href="/cookies">Cookies</a>
        </nav>
      </footer>
    </main>
    {modal?.kind === 'search' && <SearchDialog threads={threads} onClose={closeModal} onPick={showThread} />}
    {modal?.kind === 'settings' && <SettingsDialog theme={theme} count={threads.length} signedIn={!!accountId} onAccount={openAccount} onMemory={() => openMemory()} onTheme={setTheme} onClose={closeModal}
      onClear={() => { setNew(); setThreads([]); setToast('Chat history cleared.'); }} />}
    {modal?.kind === 'tasks' && <TasksDialog accountId={accountId} available={account.background} onSignIn={openAccount} onClose={closeModal} />}
    {modal?.kind === 'account' && <AccountDialog account={account} error={accountError} onRetry={onCheckAccount} onClose={closeModal} onMemory={() => openMemory()} />}
    {modal?.kind === 'memory' && <MemoryDialog key={memory ? 'ready' : 'loading'} profile={memory} accountId={accountId}
      initial={modal.initial} error={memoryError} onReload={() => { setMemoryError(''); setMemoryRequest((value) => value + 1); }}
      onSave={(saved) => { setMemory(saved); if (/^\/remember(?:\s|$)/i.test(draft.trim())) setDraft(''); closeModal(); setToast('Memory saved.'); }} onClose={closeModal} />}
    {modal?.kind === 'vision' && photo && <VisionDialog photo={photo} question={draft.trim()} onClose={closeModal}
      onApprove={(code) => { closeModal(); void run(undefined, code); }} />}
    {modal?.kind === 'context' && <ContextDialog isolated={isolated} onPick={(value) => { setIsolated(value); closeModal(); focusPrompt(); }} onClose={closeModal} />}
    {modal?.kind === 'fork' && forkTurn && <BranchDialog key={forkTurn.id} turn={forkTurn} editing={modal.fork === 'edit'} hasDraft={!!draft.trim() || !!files.length || !!photo}
      onStart={(carry) => startFork(forkTurn, modal.fork, carry)} onClose={closeModal} />}
    {modal?.kind === 'mode' && <ModeDialog mode={mode} onPick={(value) => { setMode(value); closeModal(); focusPrompt(); }} onClose={closeModal} />}
    {modal?.kind === 'plugins' && <Suspense fallback={<Dialog title="Plugins" subtitle="Opening the workspace…" onClose={closeModal}><span role="status">Loading…</span></Dialog>}>
      <PluginsDialog key={modal.intent?.id ?? 'list'} intent={modal.intent} textInput={combineFiles(files)?.text} onInsert={insertToolOutput} onChoosePhoto={pickPhoto} repoDraft={repositoryDraft.current} onRepoFile={attachRepoFile} onClose={closeModal} />
    </Suspense>}
    {modal?.kind === 'about' && <AboutDialog onClose={closeModal} />}
    {modal?.kind === 'delete' && <Dialog title="Delete conversation?" subtitle="This only deletes the copy saved in this browser." onClose={closeModal}>
      <p className="delete-title">{modal.thread.title}</p>
      <div className="dialog-actions"><button className="secondary-button" type="button" onClick={closeModal}>Cancel</button><button className="danger-button" type="button" onClick={() => deleteThread(modal.thread)}>Delete chat</button></div>
    </Dialog>}
    {toast && <div className="toast" role="status">{toast}<button type="button" className="bare-icon" aria-label="Dismiss notice" onClick={() => setToast('')}><X size={16} /></button></div>}
  </div>;
}
