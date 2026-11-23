import { isAccountId, isSupabaseAuthOrigin } from '../shared/account.ts';
import type { SupabaseAuthPublic } from '../shared/account.ts';
import { wellFormedText } from '../shared/stored-text.ts';
import { asObject, boundedJson, shortText, ToolError } from './workspace-http.ts';

type SupabaseIdentity = { subject: string; name: string; email: string };
export type SupabaseAuthConfig = SupabaseAuthPublic & { publishableKey: string; adminKey: string };
export function supabaseAuthFrom(env: Record<string, string | undefined>): SupabaseAuthConfig | undefined {
  if (env.XYVORA_ENABLE_SUPABASE_AUTH !== '1' || (env.XYVORA_AUTH_SECRET?.trim().length ?? 0) < 32) return;
  const origin = env.XYVORA_SUPABASE_AUTH_URL?.trim(), publishableKey = env.XYVORA_SUPABASE_PUBLISHABLE_KEY?.trim(), adminKey = env.XYVORA_SUPABASE_ADMIN_KEY?.trim();
  if (!isSupabaseAuthOrigin(origin) || !publishableKey || !adminKey || publishableKey === adminKey
    || !/^(?:sb_publishable_[\w-]{20,250}|eyJ[A-Za-z0-9_.-]{40,1800})$/.test(publishableKey)
    || !/^(?:sb_secret_[\w-]{20,250}|eyJ[A-Za-z0-9_.-]{40,1800})$/.test(adminKey)) return;
  const providers = [...new Set((env.XYVORA_SUPABASE_AUTH_PROVIDERS ?? '').split(',').map((value) => value.trim()).filter((value): value is 'google' | 'github' => value === 'google' || value === 'github'))];
  return { origin, publishableKey, adminKey, providers, passwords: env.XYVORA_SUPABASE_EMAIL_AUTH === '1' };
}
const validAccess = (token: unknown): token is string => typeof token === 'string' && /^[A-Za-z0-9_.-]{20,4096}$/.test(token);

async function authApi(config: SupabaseAuthConfig, signal: AbortSignal, route: string, options: { method?: string; body?: object; bearer?: string; admin?: boolean } = {}) {
  const key = options.admin ? config.adminKey : config.publishableKey;
  const headers = new Headers({ apikey: key, Accept: 'application/json' });
  if (options.bearer || (options.admin && key.startsWith('eyJ'))) headers.set('Authorization', `Bearer ${options.bearer ?? key}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  try {
    const response = await fetch(`${config.origin}/auth/v1${route}`, { method: options.method ?? 'GET', headers, body: options.body && JSON.stringify(options.body), redirect: 'error', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(9_000)]) });
    if (!response.ok || response.status === 204) { await response.body?.cancel().catch(() => undefined); return { status: response.status, data: {} }; }
    return { status: response.status, data: asObject(await boundedJson(response, 80_000)) };
  } catch { throw new ToolError('Could not reach Supabase Auth. Try again shortly.', 503); }
}
const success = (status: number) => status >= 200 && status < 300;
const serviceError = () => new ToolError('Supabase Auth is unavailable. Try again shortly.', 503);
function checkService(status: number) {
  if (status === 429) throw new ToolError('Wait a minute before trying again.', 429);
  if (status >= 500 || status === 403 || status === 404) throw serviceError();
}

export function authEmail(value: unknown) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s\x00-\x1f\x7f@]{1,100}@[^\s\x00-\x1f\x7f@]{1,150}\.[^\s\x00-\x1f\x7f@]{1,60}$/.test(email) || email.length > 254 || wellFormedText(email) !== email) throw new ToolError('Enter a valid email address.');
  return email;
}
function authPassword(value: unknown) {
  // Hosted Supabase password accounts use bcrypt. Respect its UTF-8 limit
  // instead of accepting passwords that might be silently truncated.
  if (typeof value !== 'string' || value.length < 12 || Buffer.byteLength(value) > 72 || /[\0\r\n]/.test(value) || wellFormedText(value) !== value) {
    throw new ToolError('Use a password of at least 12 characters and at most 72 UTF-8 bytes.');
  }
  return value;
}

async function verifiedIdentity(config: SupabaseAuthConfig, signal: AbortSignal, access: unknown, expected?: { email?: string; provider?: string }) {
  if (!validAccess(access)) throw new ToolError('Sign-in was not verified. Please try again.', 401);
  const { status, data } = await authApi(config, signal, '/user', { bearer: access });
  const verifiedEmail = typeof data.email_confirmed_at === 'string' && data.email_confirmed_at ? shortText(data.email, 254).toLowerCase() : '';
  const providers = Array.isArray(data.identities) ? data.identities.map((identity) => asObject(identity).provider) : [];
  if (!success(status) || !isAccountId(data.id) || (expected?.email && verifiedEmail !== expected.email) || (expected?.provider && !providers.includes(expected.provider))) {
    throw new ToolError('Sign-in was not verified. Please try again.', 401);
  }
  const metadata = asObject(data.user_metadata);
  return { subject: data.id, name: shortText(metadata.full_name ?? metadata.name ?? metadata.user_name, 72).trim() || verifiedEmail.split('@')[0].slice(0, 72) || 'Xyvora member', email: verifiedEmail } satisfies SupabaseIdentity;
}

async function closeSession(config: SupabaseAuthConfig, signal: AbortSignal, access: string, scope: 'local' | 'global') {
  const { status } = await authApi(config, signal, `/logout?scope=${scope}`, { method: 'POST', bearer: access });
  if (!success(status) && status !== 401) throw serviceError();
}

export async function sendSupabaseCode(config: SupabaseAuthConfig, signal: AbortSignal, action: 'signup' | 'recover', email: string, password?: unknown) {
  const endpoint = action === 'signup' ? '/signup' : '/recover';
  const { status, data } = await authApi(config, signal, endpoint, { method: 'POST', body: { email, ...(action === 'signup' && { password: authPassword(password) }) } });
  // Auth must require verified email. Never treat a signup response as proof.
  if (validAccess(data.access_token)) {
    await closeSession(config, signal, data.access_token, 'local');
    throw new ToolError('Email verification must be enabled by the workspace administrator.', 503);
  }
  checkService(status);
  if (!success(status) && ![400, 409, 422].includes(status)) throw serviceError();
  // Keep success identical if the address already exists or cannot be used.
}

export async function exchangeSupabaseOauth(config: SupabaseAuthConfig, signal: AbortSignal, code: string, verifier: string, provider: 'google' | 'github') {
  const { status, data } = await authApi(config, signal, '/token?grant_type=pkce', { method: 'POST', body: { auth_code: code, code_verifier: verifier } });
  if (!success(status) || !validAccess(data.access_token)) throw new ToolError('Could not verify the provider sign-in.', 401);
  try { return await verifiedIdentity(config, signal, data.access_token, { provider }); }
  finally { await closeSession(config, signal, data.access_token, 'local'); }
}

export async function supabasePasswordLogin(config: SupabaseAuthConfig, signal: AbortSignal, email: string, password: unknown) {
  const { status, data } = await authApi(config, signal, '/token?grant_type=password', { method: 'POST', body: { email, password: authPassword(password) } });
  checkService(status);
  if (!success(status) || !validAccess(data.access_token)) throw new ToolError('That email or password did not work, or the email was not verified.', 401);
  try { return await verifiedIdentity(config, signal, data.access_token, { email }); }
  finally { await closeSession(config, signal, data.access_token, 'local'); }
}

export async function redeemSupabaseCode(config: SupabaseAuthConfig, signal: AbortSignal, action: 'confirm' | 'reset', email: string, token: unknown, password?: unknown, afterChange?: (identity: SupabaseIdentity) => Promise<void>) {
  if (typeof token !== 'string' || !/^\d{6}$/.test(token)) throw new ToolError('Enter the six-digit code from your email.');
  const newPassword = action === 'reset' ? authPassword(password) : undefined;
  const { status, data } = await authApi(config, signal, '/verify', { method: 'POST', body: { email, token, type: action === 'reset' ? 'recovery' : 'signup' } });
  checkService(status);
  if (!success(status) || !validAccess(data.access_token)) throw new ToolError('That code isn’t valid or expired. Request a new one.', 401);
  try {
    const identity = await verifiedIdentity(config, signal, data.access_token, { email });
    if (newPassword) {
      const changed = await authApi(config, signal, '/user', { method: 'PUT', body: { password: newPassword }, bearer: data.access_token });
      if (!success(changed.status)) throw new ToolError('Could not change the password. Request a fresh code and try a different password.', 409);
      await afterChange?.(identity);
    }
    return identity;
  } finally { await closeSession(config, signal, data.access_token, action === 'reset' ? 'global' : 'local'); }
}

export async function removeSupabaseUser(config: SupabaseAuthConfig | undefined, subject: string, signal: AbortSignal) {
  if (!config || !isAccountId(subject)) throw new ToolError('Supabase account deletion is unavailable. Try again shortly.', 503);
  const { status } = await authApi(config, signal, `/admin/users/${subject}`, { method: 'DELETE', admin: true });
  if (!success(status) && status !== 404) throw serviceError();
}
