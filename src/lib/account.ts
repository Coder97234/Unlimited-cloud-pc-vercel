import { ACCOUNT_AUTH_PATHS, isAccountId, isAccountProvider } from '../../shared/account.ts';
import type { AccountProvider, AccountStatus } from '../../shared/account.ts';
import { emptyMemory, parseMemory } from '../../shared/memory.ts';
import type { MemoryProfile } from '../../shared/memory.ts';
import { forgetThreads } from './history.ts';

export const guestMemoryKey = 'xyvora.memory.v1';
export const accountChangeKey = 'xyvora.account.change';
export const accountMemoryChangeKey = (id: string) => `xyvora.memory.changed.${id}`;
export function notifyAccountChange() {
  try { localStorage.setItem(accountChangeKey, crypto.randomUUID()); } catch { /* Session cookies still work. */ }
}

async function accountJson(path: '' | '?section=memory', signal: AbortSignal, payload?: object, accountId?: string) {
  const response = await fetch(`/api/account${path}`, {
    cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { ...(payload && { 'Content-Type': 'application/json' }), ...(accountId && { 'X-Xyvora-Account': accountId }) },
    ...(payload && { method: 'POST', body: JSON.stringify(payload) }),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value) throw new Error(typeof value?.error === 'string' ? value.error : 'The account service is unavailable.');
  return value;
}

export async function loadAccount(signal: AbortSignal): Promise<AccountStatus> {
  const value = await accountJson('', signal);
  const providers = Array.isArray(value.providers) ? value.providers.filter(isAccountProvider) : [];
  const user = value.user;
  if (user !== null && (!isAccountId(user?.id) || typeof user?.name !== 'string' || typeof user?.email !== 'string')) throw new Error('Could not verify your account.');
  return { providers, user, passwords: value.passwords === true, background: value.background === true };
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

export async function passwordSignIn(username: string, password: string, register: boolean, signal: AbortSignal) {
  const result = await accountJson('', signal, { action: register ? 'register' : 'login', username, password });
  if (result.signedIn !== true) throw new Error('Could not sign in. Try again.');
  notifyAccountChange();
  window.location.replace('/?account=signed-in');
}

export async function deleteAccount(accountId: string, signal: AbortSignal) {
  const result = await accountJson('', signal, { action: 'delete-account', confirm: 'DELETE' }, accountId);
  if (result.deleted !== true) throw new Error('Could not delete the account. Try again.');
  forgetThreads(accountId);
  try { localStorage.removeItem(accountMemoryChangeKey(accountId)); } catch { /* Browser storage settings can prevent cleanup. */ }
  notifyAccountChange();
  window.location.replace('/');
}

export function loadGuestMemory(): MemoryProfile {
  try { return parseMemory(JSON.parse(localStorage.getItem(guestMemoryKey) ?? 'null')) ?? emptyMemory(); }
  catch { return emptyMemory(); }
}

export async function loadAccountMemory(accountId: string, signal: AbortSignal): Promise<MemoryProfile> {
  const result = await accountJson('?section=memory', signal, undefined, accountId);
  const profile = parseMemory(result.profile);
  if (!profile) throw new Error('Could not read account memory.');
  return profile;
}

export async function saveMemory(profile: MemoryProfile, accountId: string | undefined, signal: AbortSignal): Promise<MemoryProfile> {
  signal.throwIfAborted();
  if (accountId) {
    const result = await accountJson('?section=memory', signal, { action: 'save-memory', profile }, accountId);
    const saved = parseMemory(result.profile);
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
