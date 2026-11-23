import { Blocks, Download, Folder, GitBranch, ListTree, LockKeyhole, MoreHorizontal, Moon, PanelLeftOpen, Shield, Sparkles, Sun, UserRound, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { guestAccount, parseAccountLink } from '../shared/account.ts';
import type { AccountLink, AccountStatus } from '../shared/account.ts';
import { isVisionFile, MAX_VISION_QUESTION } from '../shared/media.ts';
import { HOSTED_PROVIDERS } from '../shared/hosted-models.ts';
import type { ModelChoice } from '../shared/hosted-models.ts';
import { LIBRARY_MAX_CHATS, LIBRARY_MAX_TURNS } from '../shared/library.ts';
import { MAX_MEMORY_NOTE, memoryForSend } from '../shared/memory.ts';
import type { MemoryProfile } from '../shared/memory.ts';
import { readSkillCommand } from '../shared/skill-catalog.ts';
import { DEFAULT_MODEL, MAX_ATTACHMENT, MAX_PROMPT, XYVORA_NAME, XYVORA_SITE } from '../shared/models.ts';
import type { Availability, TextAttachment } from '../shared/models.ts';
import { XYVORA_SLOGAN } from '../shared/site.ts';
import type { Project } from '../shared/projects.ts';
import type { Appearance, Theme, WorkspacePreferences } from '../shared/preferences.ts';
import { allowsSearchToggle, chatSearchQuery, isResearchPrompt, MAX_SEARCH_QUERY } from '../shared/search.ts';
import { DEFAULT_MODE } from '../shared/modes.ts';
import type { ReplyMode } from '../shared/modes.ts';
import { isProvider, PLUGINS, WORKSPACE_PLUGINS_ENABLED, workspaceIntent } from '../shared/workspace-tools.ts';
import type { RepoWorkbenchDraft } from '../shared/repositories.ts';
import type { PluginIntent } from '../shared/workspace-tools.ts';
import { brandAnswer } from '../shared/branding.ts';
import { fencedText } from '../shared/text-tools.ts';
import { runInstantSkill, teamAnswerSkill } from '../shared/skills.ts';
import { AccountDialog, MemoryDialog, PasswordLinkDialog } from './components/AccountDialogs.tsx';
import { TasksDialog } from './components/TasksDialog.tsx';
import { VisionDialog } from './components/VisionDialog.tsx';
import { BrandLockup } from './components/Brand.tsx';
import { BranchDialog, ContextDialog } from './components/ChatControls.tsx';
import { ChatOptionsDialog } from './components/ChatOptionsDialog.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';
import { Composer } from './components/Composer.tsx';
import { Dialog } from './components/Dialog.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { SiteFooter } from './components/SiteFooter.ts';
import { ModeDialog } from './components/ModeDialog.tsx';
import { Suggestions } from './components/Suggestions.tsx';
import { Transcript } from './components/Transcript.tsx';
import { AboutDialog, SettingsDialog, ShortcutsDialog } from './components/WorkspaceDialogs.tsx';
import { accountChangeKey, accountMemoryChangeKey, guestMemoryKey, invalidSessionEvent, loadAccount, loadAccountMemory, loadGuestMemory, notifyAccountChange, saveAccountSettings } from './lib/account.ts';
import { EARLY_ACCESS, PUBLIC_CREDENTIALS } from './lib/early-access.ts';
import { downloadConversation } from './lib/export-chat.ts';
import { buildMessages, forkThread, loadThreads, MAX_THREADS, MAX_TURNS, titleForPrompt } from './lib/history.ts';
import type { Answer, Thread, Turn } from './lib/history.ts';
import { combineFiles, MAX_FILES, readLocalFile } from './lib/files.ts';
import type { LocalFile } from './lib/files.ts';
import { ChatError, streamChat } from './lib/stream.ts';
import { photoBase64, prepareVisionPhoto } from './lib/vision-file.ts';
import type { VisionPhoto } from './lib/vision-file.ts';
import { approveTool, getWorkspace } from './lib/workspace-api.ts';
import { appearanceFrom, browserAppearance, currentTheme, setBrowserTheme, styleWorkspace } from './lib/theme.ts';
import { useChatHistory } from './lib/use-history.ts';
import { useLibraryHistory } from './lib/use-library-history.ts';
import { useProjects } from './lib/use-projects.ts';

type ForkKind = 'edit' | 'reply';
type Modal = { kind: 'delete'; thread: Thread } | { kind: 'plugins'; intent?: PluginIntent }
  | { kind: 'fork'; turnId: string; fork: ForkKind } | { kind: 'memory'; initial?: string }
  | { kind: 'account'; view?: 'signup' } | { kind: 'projects'; id?: string; file?: string } | { kind: 'chat-options'; id: string }
  | { kind: 'search' | 'shortcuts' | 'settings' | 'about' | 'mode' | 'context' | 'vision' | 'tasks' | 'sync-conflict' };
const ProjectsDialog = lazy(() => import('./components/ProjectsDialog.tsx').then(({ ProjectsDialog }) => ({ default: ProjectsDialog })).catch(() => ({
  default: ({ onClose }: { onClose: () => void }) => <Dialog title="Projects unavailable" onClose={onClose}><p>Couldn’t open projects. Refresh to try again.</p></Dialog>,
})));
const PluginsDialog = WORKSPACE_PLUGINS_ENABLED ? lazy(() => import('./components/PluginsDialog.tsx').then(({ PluginsDialog }) => ({ default: PluginsDialog })).catch(() => ({
  default: ({ onClose }: { onClose: () => void }) => <Dialog title="Plugins unavailable" onClose={onClose}><p>Couldn’t load the workspace. Check your connection and refresh to try again.</p></Dialog>,
}))) : undefined;

const emptyTurns: Turn[] = [];

const guest = guestAccount();

export default function App() {
  const [chatStatus, setChatStatus] = useState<{ availability: Availability | 'loading'; canSearch: boolean; canResearch?: boolean }>({ availability: 'loading', canSearch: false });
  useEffect(() => {
    const controller = new AbortController();
    // Status doesn't depend on identity: verify the session and warm the chat
    // endpoint in parallel, without showing another account's history.
    fetch('/api/chat', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]), cache: 'no-store', credentials: PUBLIC_CREDENTIALS })
      .then(async (response) => {
        if (!response.ok) throw new Error('Chat status unavailable');
        const data = await response.json();
        if (controller.signal.aborted) return;
        const available = (data?.availability === 'server' || data?.availability === 'preview') && data?.models?.includes(DEFAULT_MODEL);
        setChatStatus({ availability: available ? data.availability : 'unavailable', canSearch: available && data.webSearch === true, canResearch: available && data.research === true });
      }).catch(() => { if (!controller.signal.aborted) setChatStatus({ availability: 'unavailable', canSearch: false }); });
    return () => controller.abort();
  }, []);
  const [accountLink, setAccountLink] = useState(() => parseAccountLink(window.location.hash));
  useEffect(() => {
    function takeLink() {
      const link = parseAccountLink(window.location.hash);
      if (!link) return;
      setAccountLink(link);
      history.replaceState(null, '', location.pathname + location.search);
    }
    takeLink();
    window.addEventListener('hashchange', takeLink);
    return () => window.removeEventListener('hashchange', takeLink);
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
    window.addEventListener(invalidSessionEvent, refresh);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener('pageshow', restore); window.removeEventListener(invalidSessionEvent, refresh); };
  }, []);
  // Keep chat, drafts, and memory in a fresh component when the identity changes.
  // No guest history is loaded before the server checks a possible session.
  return <Workspace key={session ? session.account.user?.id ?? 'guest' : 'checking'} account={session?.account ?? guest}
    checking={!session} chatStatus={chatStatus} accountError={session?.error} onCheckAccount={refresh}
    accountLink={accountLink} dismissLink={() => setAccountLink(undefined)} />;
}

function Workspace({ account, checking, chatStatus: { availability, canSearch, canResearch }, accountError, onCheckAccount, accountLink, dismissLink }: { account: AccountStatus; checking: boolean; chatStatus: { availability: Availability | 'loading'; canSearch: boolean; canResearch?: boolean }; accountError?: string; onCheckAccount: () => void; accountLink?: AccountLink; dismissLink: () => void }) {
  const accountId = account.user?.id;
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const libraryEnabled = !!(accountId && account.library);
  const legacyHistory = useChatHistory(accountId, checking, busy, !libraryEnabled);
  const libraryHistory = useLibraryHistory(libraryEnabled ? accountId : undefined, busy, activeId);
  const history = libraryEnabled ? libraryHistory : legacyHistory;
  const { chats: threads, setChats: setThreads } = history;
  const totalChats = libraryEnabled ? libraryHistory.count : threads.length;
  const maxChats = libraryEnabled ? LIBRARY_MAX_CHATS : MAX_THREADS;
  const projectsEnabled = account.projects && !!accountId;
  const projectStore = useProjects(projectsEnabled ? accountId : undefined);
  const [projectSelection, setProjectSelection] = useState<string>();
  const [useProjectFiles, setUseProjectFiles] = useState(true);
  const [recentSearch, setRecentSearch] = useState<string[]>([]);
  const canSignIn = !!(account.supabase || account.passwords || account.providers.length);
  const blocked = checking || !history.ready;
  const [hasLegacy, setHasLegacy] = useState(() => !!accountId && loadThreads(accountId).length > 0);
  const [defaultMode, setDefaultMode] = useState(account.settings?.mode ?? DEFAULT_MODE);
  const settingsUpdates = useRef<Promise<void>>(Promise.resolve());
  const settingsLife = useRef<AbortController | null>(null);
  const openJob = useRef<AbortController | undefined>(undefined);
  const [openingChat, setOpeningChat] = useState(false);
  // Temporary conversations and unsent branches never enter the saved list.
  const [scratch, setScratch] = useState<{ thread: Thread | null } | null>(null);
  const [branchDraft, setBranchDraft] = useState<{ thread: Thread; originalId: string } | null>(null);
  const [isolated, setIsolated] = useState(false);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [photo, setPhoto] = useState<VisionPhoto>();
  const [canAnalyze, setCanAnalyze] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);
  const repositoryDraft = useRef<RepoWorkbenchDraft | undefined>(undefined);
  const [memory, setMemory] = useState<MemoryProfile | undefined>(() => accountId || checking ? undefined : loadGuestMemory());
  const [memoryError, setMemoryError] = useState('');
  const [memoryRequest, setMemoryRequest] = useState(0);
  const [readingFiles, setReadingFiles] = useState(false);
  const [mode, setMode] = useState<ReplyMode>(defaultMode);
  const [modelChoice, setModelChoice] = useState<ModelChoice>('xyvora');
  const hostedLabel = modelChoice === 'xyvora' ? undefined : modelChoice === 'auto' ? 'Auto model' : HOSTED_PROVIDERS[modelChoice];
  const fileJob = useRef<AbortController | null>(null);
  const [webSearch, setWebSearch] = useState(false);
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const [appearance, setAppearance] = useState(() => accountId ? appearanceFrom(account.settings) : browserAppearance());
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const followReplies = useRef(true);
  const jumpToTurn = useRef<string | undefined>(undefined);
  const temporary = scratch !== null;
  const conflictExport = libraryEnabled ? libraryHistory.conflictChat : undefined;
  const active = temporary ? scratch.thread ?? undefined : branchDraft?.thread ?? threads.find((thread) => thread.id === activeId);
  const turns = active?.turns ?? emptyTurns;
  const archived = active?.mode === 'compare' || active?.archived === true;
  const projectId = temporary ? undefined : active ? active.projectId : projectSelection;
  const project = projectStore.projects?.find(({ id }) => id === projectId);
  const optionsChat = modal?.kind === 'chat-options' ? threads.find(({ id }) => id === modal.id) : undefined;
  const sidebarThreads = threads.filter((chat) => !chat.archived && (project ? chat.projectId === project.id : true))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
  const forkTurn = modal?.kind === 'fork' ? turns.find(({ id }) => id === modal.turnId) : undefined;

  useEffect(() => {
    if (checking) return;
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get('account');
    const flag = url.searchParams.get('connection');
    if (url.searchParams.has('account') || url.searchParams.has('connection')) {
      url.searchParams.delete('account');
      url.searchParams.delete('connection');
      window.history.replaceState(null, '', url);
    }
    if (outcome === 'signed-in' && account.user) setToast('You’re signed in to Xyvora.');
    else if (outcome === 'password-reset') {
      if (!account.user && canSignIn) setModal({ kind: 'account' });
      setToast('Password changed. Use your new password to sign in.');
    } else if (outcome === 'signed-in' || outcome === 'failed') {
      setModal({ kind: 'account' });
      setToast('Couldn’t finish sign-in. Try the provider again.');
    }
    if (!WORKSPACE_PLUGINS_ENABLED || !flag) return;
    const [provider, result] = flag.split('-');
    if (!isProvider(provider) || (result !== 'connected' && result !== 'failed')) return;
    setModal({ kind: 'plugins', intent: { id: provider } });
    if (result === 'failed') setToast(`Couldn’t connect ${PLUGINS[provider].name}. Review consent and try again.`);
  }, [account, checking, canSignIn]);

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
  useEffect(() => () => { controllerRef.current?.abort(); fileJob.current?.abort(); openJob.current?.abort(); }, []);

  useLayoutEffect(() => {
    const update = () => setTheme(currentTheme());
    window.addEventListener('xyvora:theme', update);
    if (account.settings?.theme) setBrowserTheme(account.settings.theme);
    update();
    return () => window.removeEventListener('xyvora:theme', update);
  }, [account.settings?.theme]);
  useEffect(() => {
    const life = new AbortController();
    settingsLife.current = life;
    return () => { life.abort(); settingsLife.current = null; };
  }, []);
  function syncSettings(patch: WorkspacePreferences) {
    const signal = settingsLife.current?.signal;
    if (!accountId || !signal) return;
    settingsUpdates.current = settingsUpdates.current.then(async () => {
      signal.throwIfAborted();
      await saveAccountSettings(accountId, patch, signal);
    }).catch(() => { if (!signal.aborted) setToast('Could not sync workspace settings. Try that change again.'); });
  }
  useLayoutEffect(() => { styleWorkspace(appearance, !accountId && !checking); }, [accountId, appearance, checking]);
  function chooseAppearance<K extends keyof Appearance>(key: K, value: Appearance[K]) {
    setAppearance((previous) => ({ ...previous, [key]: value })); syncSettings({ [key]: value });
  }
  function chooseTheme(value: Theme) { setBrowserTheme(value); syncSettings({ theme: value }); }
  function chooseDefaultMode(value: ReplyMode) { setDefaultMode(value); setMode(value); syncSettings({ mode: value }); }
  function importBrowserChats() {
    if (!history.ready || !accountId) return;
    const known = new Set(threads.map(({ id }) => id));
    const drafts = loadThreads(accountId).filter((thread) => !known.has(thread.id) && thread.turns.length && thread.turns.every((turn) => turn.answers.length));
    if (drafts.length + totalChats > maxChats) { setToast('Remove some saved chats before importing older conversations.'); return; }
    if (drafts.length) setThreads((current) => [...current, ...drafts].sort((a, b) => b.updatedAt - a.updatedAt));
    setHasLegacy(false);
  }
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5_000);
    return () => clearTimeout(timer);
  }, [toast]);
  useLayoutEffect(() => {
    if (jumpToTurn.current) {
      const target = document.getElementById(`xyvora-turn-${jumpToTurn.current}`);
      jumpToTurn.current = undefined;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'start' });
    } else if (pane.current && followReplies.current) pane.current.scrollTop = pane.current.scrollHeight;
  }, [active, modal]);

  const closeModal = () => setModal(null);
  const focusPrompt = () => requestAnimationFrame(() => textarea.current?.focus());
  const stop = () => controllerRef.current?.abort();
  function clearFiles() {
    fileJob.current?.abort();
    fileJob.current = null;
    setReadingFiles(false);
    setFiles([]);
    setPhoto(undefined);
    setCanAnalyze(false);
  }
  async function attachFiles(items: File[]) {
    if (checking || (!history.ready && !temporary) || fileJob.current || controllerRef.current || !items.length || photo) return;
    const images = items.filter(isVisionFile);
    if (images.length) {
      if (images.length !== 1 || items.length !== 1 || files.length) {
        setToast('Attach one image at a time, without other files.'); return;
      }
      const controller = new AbortController();
      fileJob.current = controller;
      setReadingFiles(true);
      try {
        // Preview stays local even if hosted analysis is turned off. No
        // provider sees the image before explicit review and approval.
        const [prepared, status] = await Promise.all([
          prepareVisionPhoto(images[0], controller.signal),
          WORKSPACE_PLUGINS_ENABLED ? getWorkspace(AbortSignal.any([controller.signal, AbortSignal.timeout(4_000)])).catch(() => undefined) : undefined,
        ]);
        controller.signal.throwIfAborted();
        setCanAnalyze(status?.hostedVision === true);
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
  function startChat(temporary: boolean, inProject?: string) {
    openJob.current?.abort(); openJob.current = undefined; setOpeningChat(false);
    stop();
    setProjectSelection(inProject);
    setUseProjectFiles(true);
    jumpToTurn.current = undefined;
    setActiveId(null);
    setScratch(temporary ? { thread: null } : null);
    setBranchDraft(null);
    setIsolated(false);
    setMode(defaultMode);
    setModelChoice('xyvora');
    setDraft('');
    clearFiles();
    setWebSearch(false);
    setMobileOpen(false);
    closeModal();
    followReplies.current = true;
    focusPrompt();
  }
  const setNew = () => startChat(false);
  function showThread(thread: Thread, turnId?: string) {
    openJob.current?.abort(); openJob.current = undefined; setOpeningChat(false);
    if (!libraryEnabled || thread.turns.length) { showLoadedThread(thread, turnId); return; }
    const controller = openJob.current = new AbortController();
    setOpeningChat(true);
    setMobileOpen(false); closeModal();
    void libraryHistory.open(thread, controller.signal).then((loaded) => {
      if (!controller.signal.aborted) showLoadedThread(loaded, turnId);
    }).catch((error) => {
      if (!controller.signal.aborted) setToast(error instanceof Error ? error.message : 'Could not open this chat.');
    }).finally(() => { if (openJob.current === controller) { openJob.current = undefined; setOpeningChat(false); } });
  }
  function showLoadedThread(thread: Thread, turnId?: string) {
    if (thread.id !== active?.id) stop();
    setScratch(null);
    setBranchDraft(null);
    setActiveId(thread.id);
    setProjectSelection(thread.projectId);
    setUseProjectFiles(true);
    jumpToTurn.current = turnId;
    const latest = thread.turns.at(-1);
    setMode(latest?.answers[0]?.replyMode ?? defaultMode);
    setModelChoice('xyvora');
    setIsolated(latest?.contextOnly === true);
    setDraft('');
    clearFiles();
    setWebSearch(false);
    setMobileOpen(false);
    closeModal();
    followReplies.current = !turnId;
    if (!turnId && pane.current) pane.current.scrollTop = pane.current.scrollHeight;
  }
  function openProjects(id?: string, file?: string) {
    if (!projectsEnabled) return;
    setMobileOpen(false);
    setModal({ kind: 'projects', id, file });
  }
  function patchThread(thread: Thread, patch: Partial<Thread>) {
    if (!history.ready || controllerRef.current) return;
    const updatedAt = Date.now();
    setThreads((current) => current.map((chat) => chat.id === thread.id ? { ...chat, ...patch, updatedAt } : chat));
    closeModal();
    setToast(patch.archived ? 'Chat archived. Find it with the Archive search filter.' : 'Chat updated.');
  }
  function duplicateThread(thread: Thread) {
    if (!history.ready || controllerRef.current || totalChats >= maxChats) return;
    const copy = { ...thread, id: crypto.randomUUID(), title: `${thread.title.slice(0, 90)} · copy`, updatedAt: Date.now(), pinned: undefined, favorite: undefined, archived: undefined };
    setThreads((current) => [copy, ...current]);
    showThread(copy); setToast('Conversation duplicated.');
  }
  function openFork(turn: Turn, fork: ForkKind) {
    if (totalChats >= maxChats) { setToast('Delete a saved chat before starting a branch.'); return; }
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
      setMode(turn.answers[0]?.replyMode ?? defaultMode);
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
  function openPlugins(intent?: PluginIntent) {
    if (!WORKSPACE_PLUGINS_ENABLED) return;
    setMobileOpen(false); setModal({ kind: 'plugins', intent });
  }
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
  function toggleTheme() { chooseTheme(currentTheme() === 'dark' ? 'light' : 'dark'); }

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const key = event.key.toLowerCase();
      const command = (event.metaKey || event.ctrlKey) && !event.altKey;
      if (key === 'escape') { setMobileOpen(false); return; }
      if (modal || (accountLink && !checking)) return;
      if (command && key === 'k' && !event.shiftKey) {
        event.preventDefault(); setMobileOpen(false); setModal({ kind: 'search' });
      } else if (WORKSPACE_PLUGINS_ENABLED && command && key === '/' && !event.shiftKey) {
        event.preventDefault(); openPlugins();
      } else if (command && event.shiftKey && (key === 'n' || key === 'o')) {
        event.preventDefault(); setNew();
      } else if (key === '?' && !command && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const target = event.target;
        if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))) return;
        event.preventDefault(); setMobileOpen(false); setModal({ kind: 'shortcuts' });
      }
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [modal, accountLink, checking, defaultMode]);

  async function run(retry?: Turn, accessCode?: string) {
    const prompt = retry?.prompt ?? draft.trim();
    if (checking || (!history.ready && !temporary) || controllerRef.current || fileJob.current || openingChat || archived || !prompt || retry?.imageName) return;
    if (projectId && projectsEnabled && !projectStore.projects) { setToast('Wait for your projects to load, or start a new chat outside the project.'); return; }
    const team = teamAnswerSkill(prompt);
    const picture = retry || team ? undefined : photo;
    if (picture && (!WORKSPACE_PLUGINS_ENABLED || !canAnalyze || prompt.length > MAX_VISION_QUESTION)) return;
    if (picture && !accessCode) { setModal({ kind: 'vision' }); return; }
    const remember = !picture && !retry ? /^\/remember(?:\s+([\s\S]*))?$/i.exec(prompt) : null;
    if (remember) {
      const note = remember[1]?.trim();
      if (note && (note.length > MAX_MEMORY_NOTE || /[\x00-\x1f\x7f]/.test(note))) { setToast(`Write one memory note, up to ${MAX_MEMORY_NOTE} characters.`); return; }
      openMemory(note); return;
    }
    if (!temporary && (branchDraft || !active) && totalChats >= maxChats) {
      setToast('Export or delete a saved chat before starting another, or use Temporary chat.'); return;
    }
    const external = WORKSPACE_PLUGINS_ENABLED && !picture && !team ? workspaceIntent(prompt) : undefined;
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
    const searchQuery = picture || team ? undefined : chatSearchQuery(prompt, !retry && webSearch) ?? (allowsSearchToggle(prompt) ? retry?.searchQuery : undefined);
    const skill = team ?? (!picture && searchQuery === undefined ? runInstantSkill(prompt, attached?.text) : undefined);
    if (searchQuery !== undefined) {
      if (isResearchPrompt(prompt) && !canResearch) { setToast('Research briefs are unavailable in this workspace. Use /search for a regular lookup.'); return; }
      if (!canSearch) { setToast(`Web search needs the live chat on ${XYVORA_SITE}.`); return; }
      if (!searchQuery.trim() || searchQuery.length > MAX_SEARCH_QUERY) {
        setToast(`Enter 1–${MAX_SEARCH_QUERY} characters for Web search.`);
        return;
      }
    }
    if (libraryEnabled && !temporary && !retry && turns.length >= LIBRARY_MAX_TURNS) { setToast('This conversation has reached its turn limit. Start a new chat or branch from an earlier message.'); return; }
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
      ...active, projectId: project?.id ?? (projectsEnabled ? undefined : active?.projectId),
      id: threadId, title: active?.title ?? titleForPrompt(prompt), mode: 'chat',
      updatedAt: Date.now(), turns: [...historical, turn].slice(-(libraryEnabled && !temporary ? LIBRARY_MAX_TURNS : MAX_TURNS)),
    };
    if (temporary) setScratch({ thread });
    else {
      setThreads((current) => { const next = [thread, ...current.filter(({ id }) => id !== threadId)]; return libraryEnabled ? next : next.slice(0, MAX_THREADS); });
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
      if (WORKSPACE_PLUGINS_ENABLED && picture) {
        const image = await photoBase64(picture.blob, controller.signal);
        const result = await approveTool<{ text: string }>({ action: 'vision', image, prompt, accessCode }, controller.signal);
        controller.signal.throwIfAborted();
        if (typeof result.text !== 'string') throw new ChatError('Image analysis did not return a reply.');
        content = result.text.slice(0, 4_000);
        if (content.trim()) { setPhoto(undefined); setDraft(''); }
      } else await streamChat(buildMessages(historical, turn, mode), controller.signal, {
        searchQuery, attachment: attached, mode,
        project: project && accountId && !turn.contextOnly && !temporary && (availability === 'server' || modelChoice !== 'xyvora') ? { id: project.id, accountId, includeFiles: useProjectFiles } : undefined,
        memory: projectId || readSkillCommand(prompt)?.id === 'translate' ? undefined : memoryForSend(memory, temporary, !!turn.contextOnly),
        onText: (delta) => {
          if (controller.signal.aborted) return;
          content = (content + delta).slice(0, 36_000);
          if (!frame) frame = requestAnimationFrame(() => { frame = 0; update({ content }); });
        },
        onSource: (source, skill) => update({ source, skill }),
        hosted: modelChoice !== 'xyvora' && accountId ? { choice: modelChoice, accountId } : undefined,
        onModel: (hostedModel) => update({ hostedModel }),
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

  const composer = <Composer draft={draft} onDraft={setDraft} textarea={textarea} files={files} photo={photo} filePicker={filePicker} checking={checking || openingChat || (!history.ready && !temporary)} canAnalyze={canAnalyze}
    usesMemory={!projectId && readSkillCommand(draft)?.id !== 'translate' && !!memoryForSend(memory, temporary, isolated)} onRemovePhoto={() => setPhoto(undefined)} onAttach={(items) => void attachFiles(items)}
    onRemoveFile={(id) => setFiles((current) => current.filter((file) => file.id !== id))} readingFiles={readingFiles}
    mode={mode} hostedLabel={hostedLabel} onMode={() => setModal({ kind: 'mode' })} onSend={() => void run()} onStop={stop} busy={busy} isolated={isolated} webSearch={webSearch} canSearch={canSearch}
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
    if (blocked || fileJob.current || controllerRef.current) { setToast('Finish the current response or file read first.'); return; }
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
    <Sidebar threads={sidebarThreads} activeId={activeId} availability={availability} temporary={temporary} memoryOn={memory?.enabled === true} signedIn={!!accountId} onMemory={() => openMemory()} onNew={setNew}
      onTemporary={() => { if (temporary) { setMobileOpen(false); focusPrompt(); } else startChat(true); }}
      onSearch={() => { setMobileOpen(false); setModal({ kind: 'search' }); }} onProjects={projectsEnabled ? () => openProjects() : undefined} projectName={project?.name} onWebSearch={() => pickPrompt('/search ', true)}
      onPlugins={WORKSPACE_PLUGINS_ENABLED ? () => openPlugins() : undefined} onRepo={WORKSPACE_PLUGINS_ENABLED ? () => openPlugins({ id: 'repo' }) : undefined}
      onImage={WORKSPACE_PLUGINS_ENABLED ? () => openPlugins({ id: 'image' }) : undefined} onTasks={account.background ? () => { setMobileOpen(false); setModal({ kind: 'tasks' }); } : undefined}
      onSettings={() => { setMobileOpen(false); setModal({ kind: 'settings' }); }}
      syncLabel={history.loading ? 'Loading saved chats…' : history.unsynced ? 'Sync pending' : history.ready ? 'Cloud history' : 'History unavailable'} onCollapse={toggleSidebar} onThread={showThread} onDelete={(thread) => setModal({ kind: 'delete', thread })}
      onMore={libraryEnabled && libraryHistory.hasMore && !project ? () => void libraryHistory.more() : undefined} paging={libraryHistory.paging} pageError={libraryHistory.pageError}
      onAbout={() => { setMobileOpen(false); setModal({ kind: 'about' }); }} />
    <main className={`workspace${turns.length ? ' has-chat' : ''}`} id="main-workspace">
      <header className="topbar">
        <div className="topbar-location">
          <button type="button" className="icon-button open-sidebar" onClick={toggleSidebar} title="Open sidebar" aria-label="Open sidebar" aria-controls="workspace-sidebar"><PanelLeftOpen size={19} /></button>
          <span className="topbar-workspace">{XYVORA_NAME}</span><span className="breadcrumb-divider">/</span>
          <strong>{archived ? 'Archive' : temporary ? 'Temporary' : branchDraft ? 'Branch' : project ? 'Project' : 'Chat'}</strong>
        </div>
        <div className="topbar-actions">
          {EARLY_ACCESS && <form className="preview-lock" method="post" action="/_xyvora/relock"><button className="secondary-button" type="submit" aria-label="Lock preview" title="End early access in this browser"><LockKeyhole size={14} /><span>Lock preview</span></button></form>}
          {WORKSPACE_PLUGINS_ENABLED && <button type="button" className="plugins-button" aria-label="Plugins" aria-haspopup="dialog" aria-keyshortcuts="Control+/ Meta+/" onClick={() => openPlugins()}><Blocks size={16} /><span>Plugins</span></button>}
          {!archived && <button type="button" className={`context-button${isolated ? ' context-isolated' : ''}`} aria-label="Message context" title={isolated ? 'Message context: This message only' : 'Message context: Recent chat'} aria-haspopup="dialog" disabled={busy} onClick={() => setModal({ kind: 'context' })}><ListTree size={16} /><span>Context</span></button>}
          {active && !temporary && !branchDraft && turns.length > 0 && <button type="button" className="icon-button export-button" aria-label="Chat options" title="Chat options" disabled={busy} onClick={() => setModal({ kind: 'chat-options', id: active.id })}><MoreHorizontal size={18} /></button>}
          {active && !temporary && !branchDraft && turns.length > 0 && <button type="button" className="icon-button export-button" aria-label="Download conversation as Markdown" title="Download conversation as Markdown" onClick={() => downloadConversation(active)}><Download size={17} /></button>}
          <button type="button" className="identity-button" aria-label={accountId ? 'Your account' : canSignIn || checking ? 'Sign in' : 'Guest workspace'} aria-haspopup="dialog" title={accountId ? 'Your account' : canSignIn ? 'Sign in or create an account' : 'Guest workspace'}
            disabled={checking} onClick={openAccount}><UserRound size={16} /><span>{accountId ? 'Account' : canSignIn || checking ? 'Sign in' : 'Guest'}</span></button>
          <span className="topbar-divider" aria-hidden="true" />
          <button type="button" className="icon-button theme-toggle" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
        </div>
      </header>
      {history.problem && <aside className="chat-notice sync-notice" aria-label="Saved history">
        <div><strong>{accountId ? 'Chat sync needs attention' : 'Chat history'}</strong><p role="status">{history.problem}</p></div>
        {history.conflict ? <button type="button" className="secondary-button" onClick={() => setModal({ kind: 'sync-conflict' })}>Review</button>
          : accountId && <button type="button" className="secondary-button" onClick={history.retry}>Retry</button>}
      </aside>}
      {openingChat && <p className="cloud-loading" role="status">Opening conversation…</p>}
      {history.loading && <p className="cloud-loading" role="status">Loading saved chats…</p>}
      {temporary && <aside className="chat-notice" aria-label="Temporary chat privacy"><Shield size={17} /><div><strong>Temporary chat</strong><p>Not saved in history and never uses memory. Messages and attachments can still be sent for replies.</p></div><button type="button" className="secondary-button" aria-label="End temporary chat" onClick={setNew}>End chat</button></aside>}
      {project && <aside className="chat-notice project-chat-notice" aria-label="Project context"><Folder size={16} /><div><button type="button" className="text-button project-name" onClick={() => openProjects(project.id)}>{project.name}</button><p>{isolated ? 'This message only: project instructions and files are off.' : availability === 'preview' ? 'Private project · sample replies don’t use project context.' : 'Project instructions and selected excerpts can inform replies.'}</p></div>
        {!archived && <label className="project-context-toggle"><input type="checkbox" checked={useProjectFiles && !isolated && availability === 'server' && !!project.fileCount} disabled={isolated || busy || availability !== 'server' || !project.fileCount} onChange={(event) => setUseProjectFiles(event.target.checked)} /><span>Use project files</span></label>}
      </aside>}
      {branchDraft && <aside className="chat-notice" aria-label="Branch draft"><GitBranch size={17} /><div><strong>New branch</strong><p>Your original stays intact. This branch is saved separately when you send.</p></div><button type="button" className="secondary-button" aria-label="Cancel branch" onClick={cancelFork}>Cancel</button></aside>}
      {turns.length > 0 && active ? <>
        <div ref={pane} className="conversation-pane" onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          followReplies.current = scrollHeight - scrollTop - clientHeight < 130;
        }}><Transcript thread={active} busy={busy} onRetry={archived || branchDraft ? undefined : () => void run(turns.at(-1))}
          onFork={archived || temporary || branchDraft ? undefined : openFork} onAlert={setToast} /></div>
        <div className="bottom-composer"><div className="compose-width">{archived ? <div className="archive-notice"><span>{active.mode === 'compare' ? 'Earlier comparison · read-only' : 'Archived conversation'}</span>{active.archived && active.mode !== 'compare'
          ? <button type="button" className="secondary-button" onClick={() => patchThread(active, { archived: undefined })}>Restore chat</button>
          : <button type="button" className="secondary-button" onClick={setNew}>New chat</button>}</div> : composer}</div></div>
      </> : <div className="welcome-scroll">
        <div className="welcome">
          <div className="welcome-heading">
            <BrandLockup />
            <span className="workspace-kicker"><Sparkles size={13} strokeWidth={2.1} /> {EARLY_ACCESS ? 'XYVORA EARLY ACCESS' : XYVORA_SLOGAN}</span>
            {EARLY_ACCESS ? <><h1>What can I help with?</h1><p>A quiet space to think, write, and make things.</p></> : <><h1>What’s on your mind<span>?</span></h1><p>Ask a question, bring a file, or make something with <strong>{XYVORA_NAME}</strong>.</p></>}
          </div>
          {composer}
          <Suggestions onPick={pickPrompt} onImage={WORKSPACE_PLUGINS_ENABLED ? () => openPlugins({ id: 'image' }) : undefined} />
          <p className="workspace-tip">Try <code>/tools</code> for built-in tools, or ask “What time is it in Tokyo?”</p>
          {!accountId && canSignIn && <p className="welcome-account">Pick up where you left off on any device.
            <button type="button" className="text-button" onClick={() => setModal({ kind: 'account', view: 'signup' })}>Create an account <span aria-hidden="true">↗</span></button>
          </p>}
        </div>
      </div>}
      <SiteFooter />
    </main>
    {modal?.kind === 'search' && <CommandPalette threads={threads} accountId={accountId} library={libraryEnabled} projects={projectStore.projects} recent={recentSearch}
      onRemember={(query) => setRecentSearch((previous) => [query, ...previous.filter((item) => item !== query)].slice(0, 4))} onClose={closeModal} onThread={showThread} onProject={openProjects}
      commands={[
        { id: 'new', label: 'New chat', keywords: 'create conversation', run: setNew },
        { id: 'temporary', label: 'Temporary chat', keywords: 'private scratch', run: () => startChat(true) },
        { id: 'settings', label: 'Workspace settings', keywords: 'preferences appearance theme', run: () => setModal({ kind: 'settings' }) },
        { id: 'account', label: accountId ? 'Your account' : canSignIn ? 'Sign in' : 'Guest workspace', keywords: 'profile security identity', run: openAccount },
        { id: 'memory', label: 'Manage memory', keywords: 'personalization notes', run: () => openMemory() },
        { id: 'shortcuts', label: 'Keyboard shortcuts', keywords: 'keys help', run: () => setModal({ kind: 'shortcuts' }) },
        ...(projectsEnabled ? [{ id: 'project-list', label: 'Manage projects', keywords: 'new project folders documents', run: () => openProjects() }] : []),
        ...(account.background ? [{ id: 'tasks', label: 'Background tasks', keywords: 'jobs queue', run: () => setModal({ kind: 'tasks' }) }] : []),
        ...(canResearch ? [{ id: 'research', label: 'Research brief', keywords: 'source report citations', run: () => { closeModal(); pickPrompt('/research ', true); } }] : []),
        ...(canSearch ? [{ id: 'web', label: 'Web search', keywords: 'internet research', run: () => { closeModal(); pickPrompt('/search ', true); } }] : []),
        ...(WORKSPACE_PLUGINS_ENABLED ? [{ id: 'plugins', label: 'Plugins', keywords: 'integrations connections', run: () => openPlugins() }] : []),
      ]} />}
    {modal?.kind === 'chat-options' && optionsChat && <ChatOptionsDialog key={optionsChat.id} thread={optionsChat} projects={projectStore.projects} canDuplicate={history.ready && totalChats < maxChats}
      onSave={(patch) => patchThread(optionsChat, patch)} onDuplicate={() => duplicateThread(optionsChat)} onDelete={() => setModal({ kind: 'delete', thread: optionsChat })} onClose={closeModal} />}
    {modal?.kind === 'projects' && projectsEnabled && accountId && <Suspense fallback={<Dialog title="Projects" onClose={closeModal}><p role="status">Opening your projects…</p></Dialog>}>
      <ProjectsDialog key={`${modal.id ?? 'all'}:${modal.file ?? ''}`} account={accountId} projects={projectStore.projects} error={projectStore.error} initialId={modal.id} initialFile={modal.file} threads={threads} library={libraryEnabled}
        onBackToList={projectStore.refresh} onChanged={(item) => { if (item) projectStore.setProjects((current) => [item, ...(current ?? []).filter(({ id }) => id !== item.id)]); projectStore.refresh(); }}
        onRemove={(id) => { projectStore.setProjects((items) => items?.filter((item) => item.id !== id)); projectStore.refresh(); if (projectSelection === id) setProjectSelection(undefined); }}
        onStart={(item) => { projectStore.setProjects((items) => [item, ...(items ?? []).filter(({ id }) => id !== item.id)]); startChat(false, item.id); }} onChat={showThread} onClose={() => { closeModal(); projectStore.refresh(); }} />
    </Suspense>}
    {modal?.kind === 'settings' && <SettingsDialog theme={theme} appearance={appearance} onAppearance={chooseAppearance} count={totalChats} signedIn={!!accountId} canSignIn={canSignIn} defaultMode={defaultMode} onDefaultMode={chooseDefaultMode}
      onAccount={openAccount} onMemory={() => openMemory()} onTheme={chooseTheme} onShortcuts={() => setModal({ kind: 'shortcuts' })} onImport={hasLegacy ? importBrowserChats : undefined} onClose={closeModal}
      onClear={async () => { if (libraryEnabled) await libraryHistory.clear(); else setThreads([]); setNew(); setToast('Chat history cleared.'); }} />}
    {modal?.kind === 'shortcuts' && <ShortcutsDialog onClose={closeModal} />}
    {modal?.kind === 'tasks' && <TasksDialog accountId={accountId} available={account.background} onSignIn={openAccount} onClose={closeModal} />}
    {modal?.kind === 'account' && <AccountDialog account={account} error={accountError} unsynced={history.unsynced} initialView={modal.view} onRetry={onCheckAccount} onClose={closeModal} onMemory={() => openMemory()} />}
    {accountLink && !checking && <PasswordLinkDialog key={accountLink.token} link={accountLink} onClose={dismissLink} />}
    {modal?.kind === 'memory' && <MemoryDialog key={memory ? 'ready' : 'loading'} profile={memory} accountId={accountId}
      initial={modal.initial} error={memoryError} onReload={() => { setMemoryError(''); setMemoryRequest((value) => value + 1); }}
      onSave={(saved) => { setMemory(saved); if (/^\/remember(?:\s|$)/i.test(draft.trim())) setDraft(''); closeModal(); setToast('Memory saved.'); }} onClose={closeModal} />}
    {WORKSPACE_PLUGINS_ENABLED && modal?.kind === 'vision' && photo && <VisionDialog photo={photo} question={draft.trim()} onClose={closeModal}
      onApprove={(code) => { closeModal(); void run(undefined, code); }} />}
    {modal?.kind === 'context' && <ContextDialog isolated={isolated} onPick={(value) => { setIsolated(value); closeModal(); focusPrompt(); }} onClose={closeModal} />}
    {modal?.kind === 'fork' && forkTurn && <BranchDialog key={forkTurn.id} turn={forkTurn} editing={modal.fork === 'edit'} hasDraft={!!draft.trim() || !!files.length || !!photo}
      onStart={(carry) => startFork(forkTurn, modal.fork, carry)} onClose={closeModal} />}
    {modal?.kind === 'mode' && <ModeDialog mode={mode} hostedModels={account.hostedModels} model={modelChoice} onModel={setModelChoice} onPick={(value) => { setMode(value); closeModal(); focusPrompt(); }} onClose={closeModal} />}
    {PluginsDialog && modal?.kind === 'plugins' && <Suspense fallback={<Dialog title="Plugins" subtitle="Opening the workspace…" onClose={closeModal}><span role="status">Loading…</span></Dialog>}>
      <PluginsDialog key={modal.intent?.id ?? 'list'} intent={modal.intent} textInput={combineFiles(files)?.text} onInsert={insertToolOutput} onChoosePhoto={pickPhoto} repoDraft={repositoryDraft.current} onRepoFile={attachRepoFile} onClose={closeModal} />
    </Suspense>}
    {modal?.kind === 'about' && <AboutDialog onClose={closeModal} />}
    {modal?.kind === 'delete' && <Dialog title="Delete conversation?" subtitle={accountId ? 'This removes the conversation from your synced history.' : 'This only deletes the copy saved in this browser.'} onClose={closeModal}>
      <p className="delete-title">{modal.thread.title}</p>
      <div className="dialog-actions"><button className="secondary-button" type="button" onClick={closeModal}>Cancel</button><button className="danger-button" type="button" onClick={() => deleteThread(modal.thread)}>Delete chat</button></div>
    </Dialog>}
    {modal?.kind === 'sync-conflict' && <Dialog title={libraryEnabled ? 'Use the synced conversation?' : 'Use cloud history?'} subtitle={libraryEnabled ? 'The synced version replaces only the conflicting chat. Other unsynced edits stay here.' : 'Another device made changes. Replacing this copy discards unsynced edits here.'} onClose={closeModal}>
      {conflictExport?.turns.length ? <button type="button" className="secondary-button" onClick={() => downloadConversation(conflictExport)}><Download size={15} /> Export unsynced conversation</button>
        : !libraryEnabled && active && !temporary && !branchDraft && <button type="button" className="secondary-button" onClick={() => downloadConversation(active)}><Download size={15} /> Export open conversation</button>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={closeModal}>Cancel</button><button type="button" className="danger-button" onClick={() => { history.useCloudCopy(); setNew(); }}>Use cloud {libraryEnabled ? 'version' : 'copies'}</button></div>
    </Dialog>}
    {toast && <div className="toast" role="status">{toast}<button type="button" className="bare-icon" aria-label="Dismiss notice" onClick={() => setToast('')}><X size={16} /></button></div>}
  </div>;
}
