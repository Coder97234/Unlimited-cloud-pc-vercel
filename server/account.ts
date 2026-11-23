import { hostedConfigFrom, modelRouter } from './hosted-models.ts';
import type { HostedConfig } from './hosted-models.ts';
import type { ModelChoice } from '../shared/hosted-models.ts';
import type { ServerGenerate } from './inference-stream.ts';
import { createHash, randomUUID } from 'node:crypto';
import { ACCOUNT_AUTH_PATHS, guestAccount, isAccountId, isAccountProvider } from '../shared/account.ts';
import type { AccountProvider, AccountStatus, PublicAccount } from '../shared/account.ts';
import { emptyMemory, parseMemory } from '../shared/memory.ts';
import { XYVORA_URL } from '../shared/site.ts';
import { MAX_CLOUD_HISTORY_BYTES } from '../shared/history.ts';
import { accountMailer, authBudget, hashToken, newToken, passwordLogin, redeemEmailChallenge, sendEmailChallenge, tokenPattern } from './account-email.ts';
import type { SendAccountMail } from './account-email.ts';
import { changeHistory, changePreferences, readHistory, readPreferences } from './account-storage.ts';
import { changeLibrary, readLibrary } from './conversation-library.ts';
import { authEmail, exchangeSupabaseOauth, redeemSupabaseCode, removeSupabaseUser, sendSupabaseCode, supabaseAuthFrom, supabasePasswordLogin } from './supabase-auth.ts';
import type { SupabaseAuthConfig } from './supabase-auth.ts';
import { changeProjects, loadProjectContext, readProjects } from './projects.ts';
import { workerIsOnline } from './worker-health.ts';
import { productionDb } from './database.ts';
import type { PlatformDb } from './database.ts';
import { asObject, boundedJson, providerJson, shortText, ToolError } from './workspace-http.ts';

type Env = Record<string, string | undefined>;
const routes = {
  google: { token: 'https://oauth2.googleapis.com/token', profile: 'https://openidconnect.googleapis.com/v1/userinfo', scope: 'openid profile email', pkce: true },
  github: { token: 'https://github.com/login/oauth/access_token', profile: 'https://api.github.com/user', scope: 'read:user', pkce: true },
  discord: { token: 'https://discord.com/api/oauth2/token', profile: 'https://discord.com/api/users/@me', scope: 'identify', pkce: false },
} as const;
export type AccountConfig = { origin: string; db: PlatformDb; clients: Partial<Record<AccountProvider, { id: string; secret: string }>>; passwords: boolean; background: boolean; mail?: SendAccountMail; emailVerification: 'link' | 'code'; authSecret: string; projects?: boolean; library?: boolean; hosted?: HostedConfig; supabase?: SupabaseAuthConfig; sessions?: boolean };
const day = 86_400_000;
export const digest = hashToken;

export function accountConfig(env: Env, db = productionDb(env), previewOrigin?: string, mail = accountMailer(env)): AccountConfig | undefined {
  if (!db) return;
  const origin = env.XYVORA_ACCOUNT_ORIGIN?.trim() || previewOrigin || XYVORA_URL;
  try {
    if (new URL(origin).origin !== origin || (!origin.startsWith('https://') && !(previewOrigin === origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)))) return;
  } catch { return; }
  const clients: AccountConfig['clients'] = {};
  // Never use dynamic preview addresses as OAuth redirect targets.
  if (!previewOrigin || env.XYVORA_ACCOUNT_ORIGIN) for (const provider of Object.keys(routes).filter(isAccountProvider)) {
    const prefix = `XYVORA_LOGIN_${provider.toUpperCase()}`;
    const id = env[`${prefix}_ID`]?.trim(), secret = env[`${prefix}_SECRET`]?.trim();
    if (id && secret && origin.startsWith('https://')) clients[provider] = { id, secret };
  }
  const authSecret = env.XYVORA_AUTH_SECRET?.trim() ?? '';
  const emailVerification = env.XYVORA_MAIL_PROVIDER?.trim() === 'bird' ? 'code' : 'link';
  return { origin, db, clients, mail, emailVerification, authSecret, passwords: env.XYVORA_ENABLE_PASSWORDS === '1' && !!mail && authSecret.length >= 32, background: env.XYVORA_ENABLE_BACKGROUND === '1', projects: env.XYVORA_ENABLE_PROJECTS === '1' && !!db.transaction, library: env.XYVORA_ENABLE_LIBRARY === '1' && !!db.transaction, hosted: hostedConfigFrom(env), sessions: env.XYVORA_ENABLE_SESSIONS === '1', supabase: origin.startsWith('https://') && !previewOrigin ? supabaseAuthFrom(env) : undefined };
}

const cookieName = (config: AccountConfig, name: 'session' | 'oauth') => `${config.origin.startsWith('https:') ? '__Host-' : ''}xyvora-${name}`;
function readCookie(request: Request, config: AccountConfig, name: 'session' | 'oauth') {
  const prefix = `${cookieName(config, name)}=`;
  const value = request.headers.get('Cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
  return value && tokenPattern.test(value) ? value : undefined;
}
function writeCookie(headers: Headers, config: AccountConfig, name: 'session' | 'oauth', value: string, age: number) {
  headers.append('Set-Cookie', `${cookieName(config, name)}=${value}; Max-Age=${age}; Path=/; HttpOnly${config.origin.startsWith('https:') ? '; Secure' : ''}; SameSite=Lax`);
}
export function sameOriginJson(request: Request, origin: string) {
  if (new URL(request.url).origin !== origin || request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new ToolError('Open Xyvora to perform this action.', 403);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw new ToolError('Send JSON data.', 415);
}
export async function verifiedAccount(request: Request, config: AccountConfig): Promise<PublicAccount | null> {
  if (new URL(request.url).origin !== config.origin) return null;
  const session = readCookie(request, config, 'session');
  if (!session) return null;
  const [user] = await config.db.query<PublicAccount>(`select a.id, a.name, a.email from xyvora_sessions s join xyvora_accounts a on a.id = s.account_id where s.digest = $1 and s.expires_ms > $2 and s.credential_version = a.credential_version`, [digest(session), Date.now()]);
  return user ?? null;
}
// This is the only bridge from chat generation to private project storage.
export function projectContextFor(config: AccountConfig | undefined) {
  if (!config?.projects) return;
  return async (request: Request, id: string, prompt: string, includeFiles: boolean) => {
    sameOriginJson(request, config.origin);
    const user = await verifiedAccount(request, config);
    if (!user) throw new ToolError('Sign in to use project context.', 401);
    if (request.headers.get('x-xyvora-account') !== user.id) throw new ToolError('Your account changed. Refresh and try again.', 409);
    request.signal.throwIfAborted();
    return loadProjectContext(config.db, user.id, id, prompt, includeFiles);
  };
}

export function hostedModelsFor(config: AccountConfig | undefined, local?: ServerGenerate) {
  const hosted = config?.hosted;
  if (!config || !hosted) return;
  return async (request: Request, choice: Exclude<ModelChoice, 'xyvora'>) => {
    sameOriginJson(request, config.origin);
    const user = await verifiedAccount(request, config);
    if (!user) throw new ToolError('Sign in to choose a hosted model.', 401);
    if (request.headers.get('x-xyvora-account') !== user.id) throw new ToolError('Your account changed. Refresh and try again.', 409);
    const model = modelRouter(hosted, choice, async () => {
      // Buckets roll over at UTC midnight. No credentials or prompt text in the counters.
      const now = Date.now(), day = Math.floor(now / 86_400_000), ttl = 86_400_000 - now % 86_400_000;
      if (!await authBudget(config.db, config.authSecret, 'hosted-model-user', `${day}:${user.id}`, hosted.userLimit, ttl)) return false;
      return authBudget(config.db, config.authSecret, 'hosted-model-site', String(day), hosted.siteLimit, ttl);
    }, local);
    if (!model) throw new ToolError('This model is not configured.', 503);
    return model;
  };
}

async function createSession(headers: Headers, request: Request, config: AccountConfig, account: PublicAccount, expectedVersion?: number) {
  const session = newToken();
  const now = Date.now();
  const old = readCookie(request, config, 'session');
  const created = await config.db.query(`with revoked as (delete from xyvora_sessions where digest=$4)
    insert into xyvora_sessions (digest,account_id,expires_ms,credential_version)
    select $1,id,$3,credential_version from xyvora_accounts where id=$2 and ($5::integer is null or credential_version=$5) returning digest`,
    [digest(session), account.id, now + 30 * day, old ? digest(old) : null, expectedVersion ?? null]);
  if (!created.length) throw new ToolError('Sign in again with your current credentials.', 401);
  writeCookie(headers, config, 'session', session, 30 * 86_400);
}

let resetAt = 0;
const hits = new Map<string, number>();
function limitAuth(request: Request, group: 'account' | 'login') {
  const now = Date.now();
  if (now >= resetAt) { resetAt = now + 60_000; hits.clear(); }
  const ip = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) || 'local';
  const key = `${group}:${ip}`, all = `all:${group}`;
  const n = hits.get(key) ?? 0, total = hits.get(all) ?? 0;
  if (n >= (group === 'login' ? 8 : 40) || total >= (group === 'login' ? 40 : 240)) throw new ToolError('Too many account requests. Try again in a minute.', 429);
  hits.set(key, n + 1); hits.set(all, total + 1);
}

async function beginOauth(config: AccountConfig, headers: Headers, provider: AccountProvider) {
  const client = config.clients[provider];
  if (!client) throw new ToolError('That sign-in method is unavailable.', 503);
  const state = newToken(), verifier = newToken();
  const now = Date.now();
  await config.db.query('delete from xyvora_auth_attempts where expires_ms <= $1', [now]);
  await config.db.query('insert into xyvora_auth_attempts (digest, provider, verifier, expires_ms) values ($1,$2,$3,$4)', [digest(state), provider, verifier, now + 600_000]);
  writeCookie(headers, config, 'oauth', state, 600);
  const url = new URL(ACCOUNT_AUTH_PATHS[provider]);
  url.search = new URLSearchParams({ client_id: client.id, response_type: 'code', redirect_uri: `${config.origin}/api/account`, scope: routes[provider].scope, state,
    ...(routes[provider].pkce && { code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }),
  }).toString();
  return url.href;
}
async function finishOauth(request: Request, headers: Headers, config: AccountConfig) {
  const params = new URL(request.url).searchParams;
  const state = params.get('state'), code = params.get('code');
  const cookie = readCookie(request, config, 'oauth');
  if (!state || !cookie || state !== cookie || params.getAll('state').length !== 1) return false;
  writeCookie(headers, config, 'oauth', '', 0);
  const [attempt] = await config.db.query<{ provider: unknown; verifier: string }>('delete from xyvora_auth_attempts where digest = $1 and expires_ms > $2 returning provider, verifier', [digest(state), Date.now()]);
  if (!attempt || !isAccountProvider(attempt.provider) || params.has('error') || params.getAll('code').length !== 1 || !code || !/^\S{1,1600}$/.test(code)) return false;
  const provider = attempt.provider, client = config.clients[provider];
  if (!client) return false;
  const spec = routes[provider];
  const data = await providerJson(spec.token, request.signal, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: client.id,
    client_secret: client.secret, redirect_uri: `${config.origin}/api/account`, ...(spec.pkce && { code_verifier: attempt.verifier }) }) });
  if (typeof data.access_token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(data.access_token)) return false;
  const profile = await providerJson(spec.profile, request.signal, { headers: { Authorization: `Bearer ${data.access_token}`, 'User-Agent': 'Xyvora-Account' } });
  const id = provider === 'google' ? profile.sub : profile.id;
  const subject = typeof id === 'number' && Number.isSafeInteger(id) ? `${id}` : typeof id === 'string' ? id : '';
  if (!/^[\w-]{1,128}$/.test(subject)) return false;
  const [user] = await config.db.query<PublicAccount>(`insert into xyvora_accounts (id, provider, subject, name, email, created_ms) values ($1,$2,$3,$4,$5,$6)
    on conflict (provider, subject) do update set name = excluded.name, email = excluded.email returning id, name, email`, [randomUUID(), provider, subject,
    shortText(profile.name ?? profile.global_name ?? profile.login ?? profile.username, 72) || 'Xyvora member', provider === 'google' && profile.email_verified === true ? shortText(profile.email, 254) : '', Date.now()]);
  if (!user) return false;
  // Provider tokens are used once for identity, not stored or used for tools.
  await createSession(headers, request, config, user);
  return true;
}

async function beginSupabaseOauth(config: AccountConfig, headers: Headers, provider: unknown) {
  if (!config.supabase || (provider !== 'google' && provider !== 'github') || !config.supabase.providers.includes(provider)) throw new ToolError('This provider is unavailable.', 503);
  const state = newToken(), verifier = newToken();
  const now = Date.now();
  await config.db.query('delete from xyvora_auth_attempts where expires_ms <= $1', [now]);
  await config.db.query('insert into xyvora_auth_attempts (digest,provider,verifier,expires_ms) values ($1,$2,$3,$4)', [digest(state), `supabase:${provider}`, verifier, now + 600_000]);
  writeCookie(headers, config, 'oauth', state, 600);
  const url = new URL(`${config.supabase.origin}/auth/v1/authorize`);
  url.search = new URLSearchParams({ provider, redirect_to: `${config.origin}/api/account?auth=supabase`, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 's256' }).toString();
  return url.href;
}

const supabaseIssuer = (auth: SupabaseAuthConfig) => `supabase:${new URL(auth.origin).hostname.split('.')[0]}`;

async function sessionForSupabase(headers: Headers, request: Request, config: AccountConfig, identity: { subject: string; name: string; email: string }, expected?: { id: string; credential_version: number } | null) {
  // Use the provider-verified UUID as the key. Never attach private data by
  // matching an email, display name, or any other changeable attribute.
  const [user] = await config.db.query<PublicAccount & { credential_version: number }>(`insert into xyvora_accounts (id,provider,subject,name,email,created_ms)
    values ($1,$2,$3,$4,$5,$6) on conflict (provider,subject) do update set name=excluded.name,email=excluded.email
    returning id,name,email,credential_version`, [randomUUID(), supabaseIssuer(config.supabase!), identity.subject, identity.name, identity.email, Date.now()]);
  if (expected && (expected.id !== user.id || expected.credential_version !== user.credential_version)) throw new ToolError('Sign in again with your current credentials.', 401);
  await createSession(headers, request, config, user, user.credential_version);
}

async function finishSupabaseOauth(request: Request, headers: Headers, config: AccountConfig) {
  const params = new URL(request.url).searchParams;
  const cookie = readCookie(request, config, 'oauth');
  if (!cookie || !config.supabase) return false;
  writeCookie(headers, config, 'oauth', '', 0);
  const [attempt] = await config.db.query<{ provider: string; verifier: string }>(`delete from xyvora_auth_attempts where digest=$1 and expires_ms > $2
    and provider in ('supabase:google','supabase:github') returning provider,verifier`, [digest(cookie), Date.now()]);
  const code = params.get('code');
  if (!attempt || params.has('error') || params.getAll('code').length !== 1 || !code || !/^[-A-Za-z0-9_]{8,200}$/.test(code)) return false;
  const provider = attempt.provider === 'supabase:google' ? 'google' : 'github';
  if (!config.supabase.providers.includes(provider)) return false;
  const identity = await exchangeSupabaseOauth(config.supabase, AbortSignal.any([request.signal, AbortSignal.timeout(24_000)]), code, attempt.verifier, provider);
  await sessionForSupabase(headers, request, config, identity);
  return true;
}

async function handleSupabaseSignIn(request: Request, headers: Headers, config: AccountConfig, input: Record<string, unknown>, limit: boolean): Promise<[object, number?]> {
  const auth = config.supabase;
  if (!auth) throw new ToolError('Supabase sign-in is unavailable.', 503);
  if (input.operation === 'start') return [{ url: await beginSupabaseOauth(config, headers, input.provider) }];
  if (!auth.passwords) throw new ToolError('Supabase email sign-in is unavailable.', 503);
  const email = authEmail(input.email);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(24_000)]);
  if (input.operation === 'signup' || input.operation === 'recover') {
    if (limit && !await authBudget(config.db, config.authSecret, 'supabase-mail', email, 1, 90_000)) return [{ accepted: true }, 202];
    await sendSupabaseCode(auth, signal, input.operation, email, input.password);
    return [{ accepted: true }, 202];
  }
  if (limit && !await authBudget(config.db, config.authSecret, 'supabase-proof', email, 12, 15 * 60_000)) throw new ToolError('Too many attempts. Try again later.', 429);
  if (input.operation === 'login') {
    const [snapshot] = await config.db.query<{ id: string; credential_version: number }>(`select id,credential_version from xyvora_accounts where provider=$1 and email=$2 limit 1`, [supabaseIssuer(auth), email]);
    await sessionForSupabase(headers, request, config, await supabasePasswordLogin(auth, signal, email, input.password), snapshot);
    return [{ signedIn: true }];
  }
  if (input.operation === 'confirm' || input.operation === 'reset') {
    const identity = await redeemSupabaseCode(auth, signal, input.operation, email, input.code, input.password, async ({ subject }) => {
      await config.db.query(`with changed as (update xyvora_accounts set credential_version=credential_version+1 where provider=$1 and subject=$2 returning id)
        delete from xyvora_sessions where account_id in (select id from changed)`, [supabaseIssuer(auth), subject]);
    });
    if (input.operation === 'confirm') {
      await sessionForSupabase(headers, request, config, identity);
      return [{ signedIn: true }];
    }
    return [{ reset: true }];
  }
  throw new ToolError('Unknown Supabase sign-in action.');
}

export async function handleAccount(request: Request, config: AccountConfig | undefined, { limit = true, schedule }: { limit?: boolean; schedule?: (work: Promise<void>) => void } = {}) {
  const url = new URL(request.url);
  const headers = new Headers({ 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
  const json = (data: object, status = 200) => Response.json(data, { status, headers });
  const section = url.searchParams.get('section');
  const callback = !section && request.method === 'GET' && ['code', 'error', 'state', 'auth'].some((name) => url.searchParams.has(name));
  const toHome = (success: boolean) => { headers.set('Location', `/?account=${success ? 'signed-in' : 'failed'}`); return new Response(null, { status: 303, headers }); };
  try {
    if (request.method !== 'GET' && request.method !== 'POST') { headers.set('Allow', 'GET, POST'); throw new ToolError('Method not allowed.', 405); }
    if (section && !['history', 'settings', 'memory', 'projects', 'library', 'sessions'].includes(section)) throw new ToolError('Account section not found.', 404);
    if (!config || url.origin !== config.origin) {
      if (callback) return toHome(false);
      if (request.method === 'GET' && !section) return json(guestAccount());
      throw new ToolError('Account services are unavailable.', 503);
    }
    if (section === 'projects' && !config.projects) throw new ToolError('Account projects are unavailable.', 503);
    if (section === 'library' && !config.library) throw new ToolError('The conversation library is unavailable.', 503);
    if (section === 'sessions' && !config.sessions) throw new ToolError('Session management is unavailable.', 503);
    if (callback) { if (limit) limitAuth(request, 'login'); return toHome(await (url.searchParams.get('auth') === 'supabase' ? finishSupabaseOauth : finishOauth)(request, headers, config)); }
    let user: PublicAccount | null | undefined;
    let input: Record<string, unknown> | undefined;
    if (request.method === 'POST') {
      sameOriginJson(request, config.origin);
      if (section) {
        if (limit) limitAuth(request, 'account');
        user = await verifiedAccount(request, config);
        if (!user) throw new ToolError('Sign in to use account storage.', 401);
        if (request.headers.get('x-xyvora-account') !== user.id) throw new ToolError('Your account changed. Refresh and try again.', 409);
      }
      const bytes = (section === 'history' || section === 'library') ? MAX_CLOUD_HISTORY_BYTES + 1_000 : section === 'memory' || section === 'projects' ? 65_536 : 6_000;
      try { input = asObject(await boundedJson(request, bytes)); }
      catch (error) { throw error instanceof ToolError ? error : new ToolError('Send a valid account request.'); }
      if (!section) {
        const action = input.action;
        const credentials = ['login', 'request-signup', 'request-reset', 'verify-email', 'reset-password'].includes(String(action));
        if (limit) limitAuth(request, credentials || action === 'start' || action === 'supabase-auth' ? 'login' : 'account');
        if (action === 'supabase-auth') { const [body, status] = await handleSupabaseSignIn(request, headers, config, input, limit); return json(body, status); }
        if (action === 'start' && isAccountProvider(input.provider)) return json({ url: await beginOauth(config, headers, input.provider) });
        if (credentials && (!config.passwords || !config.mail)) throw new ToolError('Email sign-in is unavailable.', 503);
        if (action === 'login') {
          const account = await passwordLogin(config.db, config.authSecret, input, limit);
          await createSession(headers, request, config, account, account.credential_version);
          return json({ signedIn: true });
        }
        if (action === 'request-signup' || action === 'request-reset') {
          await sendEmailChallenge(config, config.mail!, request, action === 'request-signup' ? 'signup' : 'reset', input.email, { limit, schedule });
          return json({ accepted: true }, 202);
        }
        if (action === 'verify-email' || action === 'reset-password') {
          const account = await redeemEmailChallenge(config, request, action === 'verify-email' ? 'signup' : 'reset', input, limit);
          if (account) {
            await createSession(headers, request, config, account, account.credential_version);
            return json({ signedIn: true });
          }
          // The reset invalidates only the target account’s sessions. A
          // cookie for an unrelated account must not be silently signed out.
          return json({ reset: true });
        }
      }
    } else if (limit && readCookie(request, config, 'session')) limitAuth(request, 'account');
    user ??= await verifiedAccount(request, config);
    if (request.method === 'GET' && !section) {
      const providers = Object.keys(config.clients).filter(isAccountProvider);
      // Do not advertise account forms before storage is reachable and the
      // launch migration has been installed.
      if (!user && (providers.length || config.passwords || config.supabase)) await config.db.query('select 1 from xyvora_cloud_history limit 0');
      const background = config.background && !!(user || providers.length || config.passwords || config.supabase) && await workerIsOnline(config.db).catch(() => false);
      return json({ providers, passwords: config.passwords, background, user,
        ...(config.supabase && (config.supabase.passwords || config.supabase.providers.length) && { supabase: { origin: config.supabase.origin, providers: config.supabase.providers, passwords: config.supabase.passwords } }),
        ...(config.passwords && config.emailVerification === 'code' && { emailVerification: 'code' as const }),
        ...(user && { settings: await readPreferences(config.db, user.id), ...(config.projects && { projects: true }), ...(config.library && { library: true }), ...(config.sessions && { sessions: true }), ...(config.hosted && { hostedModels: config.hosted.models.map(({ provider, model }) => ({ provider, model })) }) }) } satisfies AccountStatus);
    }
    if (input?.action === 'sign-out' && !section) {
      if (user && request.headers.get('x-xyvora-account') !== user.id) throw new ToolError('Your account changed. Refresh and try again.', 409);
      const session = readCookie(request, config, 'session'), attempt = readCookie(request, config, 'oauth');
      if (session) await config.db.query('delete from xyvora_sessions where digest = $1', [digest(session)]);
      if (attempt) await config.db.query('delete from xyvora_auth_attempts where digest = $1', [digest(attempt)]);
      writeCookie(headers, config, 'session', '', 0);
      writeCookie(headers, config, 'oauth', '', 0);
      return json({ signedOut: true });
    }
    if (!user || !isAccountId(user.id)) throw new ToolError('Sign in to use account storage.', 401);
    if (request.headers.get('x-xyvora-account') !== user.id) throw new ToolError('Your account changed. Refresh and try again.', 409);
    if (!section && input?.action === 'delete-account' && input.confirm === 'DELETE') {
      const [identity] = await config.db.query<{ subject: string; provider: string }>('select subject,provider from xyvora_accounts where id=$1', [user.id]);
      if (identity?.provider.startsWith('supabase:')) {
        if (!config.supabase || identity.provider !== supabaseIssuer(config.supabase)) throw new ToolError('The original Supabase Auth project is required to delete this account.', 503);
        await removeSupabaseUser(config.supabase, identity.subject, request.signal);
      }
      await config.db.query(`with removed as (delete from xyvora_accounts where id=$1 returning provider, subject)
        delete from xyvora_email_links l using removed r where r.provider='password' and l.email=r.subject`, [user.id]);
      writeCookie(headers, config, 'session', '', 0);
      writeCookie(headers, config, 'oauth', '', 0);
      return json({ deleted: true });
    }
    if (section === 'sessions') {
      const session = readCookie(request, config, 'session');
      if (!session) throw new ToolError('Sign in to manage sessions.', 401);
      const current = digest(session);
      if (request.method === 'GET') {
        const sessions = await config.db.query(`select session_id as id, created_ms::float8 as "createdAt", expires_ms::float8 as "expiresAt", digest=$2 as current
          from xyvora_sessions where account_id=$1 and expires_ms>$3 order by (digest=$2) desc, created_ms desc nulls last, session_id limit 40`, [user.id, current, Date.now()]);
        return json({ sessions });
      }
      if (input?.action === 'revoke-others' && input.confirm === 'REVOKE') {
        await config.db.query('delete from xyvora_sessions where account_id=$1 and digest<>$2', [user.id, current]);
        return json({ revoked: true });
      }
      if (input?.action === 'revoke' && isAccountId(input.id)) {
        const rows = await config.db.query('delete from xyvora_sessions where account_id=$1 and digest<>$2 and session_id=$3 returning session_id', [user.id, current, input.id]);
        if (!rows.length) throw new ToolError('No other session with that ID was found.', 404);
        return json({ revoked: true });
      }
      throw new ToolError('Choose another session to revoke, or sign out of this device.');
    }
    if (section === 'library') {
      if (request.method === 'GET') return json(await readLibrary(config.db, user.id, url));
      const result = await changeLibrary(config.db, user.id, input ?? {});
      return json(result, 'conflict' in result ? 409 : 200);
    }
    if (section === 'projects') {
      return json(request.method === 'GET' ? await readProjects(config.db, user.id, url) : await changeProjects(config.db, user.id, input ?? {}));
    }
    if (section === 'history') {
      if (request.method === 'GET') return json(await readHistory(config.db, user.id));
      if (input?.action === 'sync') {
        const result = await changeHistory(config.db, user.id, input.revision, input.chats);
        return json(result, 'conflict' in result ? 409 : 200);
      }
    }
    if (section === 'settings' && input?.action === 'save-settings') return json({ settings: await changePreferences(config.db, user.id, input.settings) });
    if (section === 'settings' && request.method === 'GET') return json({ settings: await readPreferences(config.db, user.id) });
    if (section === 'memory' && request.method === 'GET') {
      const [row] = await config.db.query<{ profile: unknown }>('select profile from xyvora_memory where account_id = $1', [user.id]);
      return json({ profile: row ? parseMemory(row.profile, true) ?? emptyMemory() : emptyMemory() });
    }
    if (section !== 'memory' || input?.action !== 'save-memory') throw new ToolError('Unknown account action.');
    const profile = parseMemory(input.profile, true);
    if (!profile) throw new ToolError('Check the size and number of your memory notes.');
    if (!profile.enabled && !profile.notes.length) await config.db.query('delete from xyvora_memory where account_id = $1', [user.id]);
    else await config.db.query('insert into xyvora_memory (account_id, profile) values ($1,$2::jsonb) on conflict (account_id) do update set profile = excluded.profile', [user.id, JSON.stringify(profile)]);
    return json({ profile });
  } catch (error) {
    if (callback) return toHome(false);
    const status = error instanceof ToolError ? error.status : 503;
    if (status === 429) headers.set('Retry-After', '60');
    return json({ error: error instanceof ToolError ? error.message : 'Account services are unavailable. Try again shortly.' }, status);
  }
}
