import { ACCOUNT_AUTH_PATHS, isAccountId, isAccountProvider } from '../../shared/account.ts';
import type { AccountLink, AccountProvider, AccountStatus } from '../../shared/account.ts';
import { emptyMemory, parseMemory } from '../../shared/memory.ts';
import type { MemoryProfile } from '../../shared/memory.ts';
import { forgetThreads } from './history.ts';
import { MAX_CLOUD_HISTORY_BYTES, parseCloudThreads } from '../../shared/history.ts';
import type { CloudHistory, Thread } from '../../shared/history.ts';
import { parsePreferences } from '../../shared/preferences.ts';
import type { WorkspacePreferences } from '../../shared/preferences.ts';

export const guestMemoryKey = 'xyvora.memory.v1';
export const accountChangeKey = 'xyvora.account.change';
export const accountMemoryChangeKey = (id: string) => `xyvora.memory.changed.${id}`;
export const accountHistoryChangeKey = (id: string) => `xyvora.history.changed.${id}`;
export function notifyAccountChange(key = accountChangeKey) {
  try { localStorage.setItem(key, crypto.randomUUID()); } catch { /* Session cookies still work. */ }
}

async function accountJson(path: '' | '?section=memory' | '?section=settings' | '?section=history', signal: AbortSignal, payload?: object, accountId?: string) {
  const response = await fetch(`/api/account${path}`, {
    cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { ...(payload && { 'Content-Type': 'application/json' }), ...(accountId && { 'X-Xyvora-Account': accountId }) },
    ...(payload && { method: 'POST', body: JSON.stringify(payload), keepalive: path === '?section=settings' }),
  });
  const value = await response.json().catch(() => null);
  if (path === '?section=history' && response.status === 409 && value?.conflict === true) return value;
  if (!response.ok || !value) throw new Error(typeof value?.error === 'string' ? value.error : 'The account service is unavailable.');
  return value;
}

export async function loadAccount(signal: AbortSignal): Promise<AccountStatus> {
  const value = await accountJson('', signal);
  const providers = Array.isArray(value.providers) ? value.providers.filter(isAccountProvider) : [];
  const user = value.user;
  if (user !== null && (!isAccountId(user?.id) || typeof user?.name !== 'string' || typeof user?.email !== 'string')) throw new Error('Could not verify your account.');
  return { providers, user, passwords: value.passwords === true, background: value.background === true, settings: parsePreferences(value.settings) };
}

export async function startSignIn(provider: AccountProvider, signal: AbortSignal) {
  const value = await accountJson('', signal, { action: 'start', provider });
  let redirect: URL;
  try { redirect = new URL(value.url); } catch { throw new Error('The sign-in page is unavailable.'); }
  if (redirect.origin + redirect.pathname !== ACCOUNT_AUTH_PATHS[provider] || redirect.username || redirect.password || redirect.hash) throw new Error('The sign-in link was not valid.');
  signal.throwIfAborted();
  window.location.assign(redirect.href);
}

export async function signOut(accountId: string, signal: AbortSignal) {
  const value = await accountJson('', signal, { action: 'sign-out' }, accountId);
  if (value.signedOut !== true) throw new Error('Could not sign out. Try again.');
  notifyAccountChange();
  window.location.replace('/');
}

function signedIn(result: { signedIn?: boolean }) {
  if (result.signedIn !== true) throw new Error('Could not sign in. Try again.');
  notifyAccountChange();
  window.location.replace('/?account=signed-in');
}
export async function passwordSignIn(email: string, password: string, signal: AbortSignal) {
  signedIn(await accountJson('', signal, { action: 'login', email, password }));
}
export async function requestAccountLink(action: 'request-signup' | 'request-reset', email: string, signal: AbortSignal) {
  const result = await accountJson('', signal, { action, email });
  if (result.accepted !== true) throw new Error('Could not request the email. Try again.');
}
export async function finishAccountLink(link: AccountLink, password: string, signal: AbortSignal) {
  const result = await accountJson('', signal, { action: link.purpose === 'signup' ? 'verify-email' : 'reset-password', token: link.token, password });
  if (link.purpose === 'signup') return signedIn(result);
  if (result.reset !== true) throw new Error('Could not reset your password. Try again.');
  notifyAccountChange();
  window.location.replace('/?account=password-reset');
}

function cloudHistory(data: { revision?: unknown; chats?: unknown }): CloudHistory {
  const chats = parseCloudThreads(data.chats);
  if ((data.revision !== null && !isAccountId(data.revision)) || !chats) throw new Error('Could not read your synced chats.');
  return { revision: data.revision, chats };
}
export async function loadCloudHistory(id: string, signal: AbortSignal) {
  return cloudHistory(await accountJson('?section=history', signal, undefined, id));
}
export async function saveCloudHistory(id: string, revision: string | null, draft: Thread[], signal: AbortSignal) {
  const chats = parseCloudThreads(draft);
  if (!chats) throw new Error('The saved chat format is invalid.');
  if (new TextEncoder().encode(JSON.stringify(chats)).length > MAX_CLOUD_HISTORY_BYTES) throw new Error('Cloud history is full. Export and remove a conversation before saving.');
  const result = await accountJson('?section=history', signal, { action: 'sync', revision, chats }, id);
  if (result.conflict) return { conflict: cloudHistory(result) };
  if (!isAccountId(result.revision)) throw new Error('The history save could not be confirmed.');
  notifyAccountChange(accountHistoryChangeKey(id));
  return { saved: { revision: result.revision, chats } satisfies CloudHistory };
}
export async function saveAccountSettings(id: string, settings: WorkspacePreferences, signal: AbortSignal) {
  const result = await accountJson('?section=settings', signal, { action: 'save-settings', settings }, id);
  if (!parsePreferences(result.settings)) throw new Error('Could not sync your workspace settings.');
}

export async function deleteAccount(accountId: string, signal: AbortSignal) {
  const result = await accountJson('', signal, { action: 'delete-account', confirm: 'DELETE' }, accountId);
  if (result.deleted !== true) throw new Error('Could not delete the account. Try again.');
  forgetThreads(accountId);
  try { localStorage.removeItem(accountMemoryChangeKey(accountId)); localStorage.removeItem(accountHistoryChangeKey(accountId)); } catch { /* Browser storage settings can prevent cleanup. */ }
  notifyAccountChange();
  window.location.replace('/');
}

export function loadGuestMemory(): MemoryProfile {
  try { return parseMemory(JSON.parse(localStorage.getItem(guestMemoryKey) ?? 'null')) ?? emptyMemory(); }
  catch { return emptyMemory(); }
}

export async function loadAccountMemory(accountId: string, signal: AbortSignal): Promise<MemoryProfile> {
  const result = await accountJson('?section=memory', signal, undefined, accountId);
  const profile = parseMemory(result.profile, true);
  if (!profile) throw new Error('Could not read account memory.');
  return profile;
}

export async function saveMemory(profile: MemoryProfile, accountId: string | undefined, signal: AbortSignal): Promise<MemoryProfile> {
  signal.throwIfAborted();
  if (accountId) {
    const result = await accountJson('?section=memory', signal, { action: 'save-memory', profile }, accountId);
    const saved = parseMemory(result.profile, true);
    if (!saved) throw new Error('The account service did not confirm the save.');
    try { localStorage.setItem(accountMemoryChangeKey(accountId), crypto.randomUUID()); } catch { /* Cloud memory is saved. */ }
    return saved;
  }
  try {
    if (!profile.enabled && !profile.notes.length) localStorage.removeItem(guestMemoryKey);
    else localStorage.setItem(guestMemoryKey, JSON.stringify(profile));
  } catch { throw new Error('This browser could not save memory.'); }
  return profile;
}
