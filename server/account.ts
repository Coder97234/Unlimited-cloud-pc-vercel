import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { ACCOUNT_AUTH_PATHS, guestAccount, isAccountId, isAccountProvider } from '../shared/account.ts';
import type { AccountProvider, AccountStatus, PublicAccount } from '../shared/account.ts';
import { emptyMemory, parseMemory } from '../shared/memory.ts';
import { XYVORA_URL } from '../shared/site.ts';
import { productionDb } from './database.ts';
import type { PlatformDb } from './database.ts';
import { asObject, boundedJson, providerJson, shortText, ToolError } from './workspace-http.ts';

type Env = Record<string, string | undefined>;
const routes = {
  google: { token: 'https://oauth2.googleapis.com/token', profile: 'https://openidconnect.googleapis.com/v1/userinfo', scope: 'openid profile email', pkce: true },
  github: { token: 'https://github.com/login/oauth/access_token', profile: 'https://api.github.com/user', scope: 'read:user', pkce: true },
  discord: { token: 'https://discord.com/api/oauth2/token', profile: 'https://discord.com/api/users/@me', scope: 'identify', pkce: false },
} as const;
export type AccountConfig = { origin: string; db: PlatformDb; clients: Partial<Record<AccountProvider, { id: string; secret: string }>>; passwords: boolean; background: boolean };
const day = 86_400_000;
const random = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const tokenPattern = /^[\w-]{43}$/;

export function accountConfig(env: Env, db = productionDb(env), previewOrigin?: string): AccountConfig | undefined {
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
  return { origin, db, clients, passwords: env.XYVORA_ENABLE_PASSWORDS === '1', background: env.XYVORA_ENABLE_BACKGROUND === '1' };
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
  const [user] = await config.db.query<PublicAccount>(`select a.id, a.name, a.email from xyvora_sessions s join xyvora_accounts a on a.id = s.account_id where s.digest = $1 and s.expires_ms > $2`, [digest(session), Date.now()]);
  return user ?? null;
}
async function createSession(headers: Headers, request: Request, config: AccountConfig, account: PublicAccount) {
  const session = random();
  await config.db.query('delete from xyvora_sessions where expires_ms <= $1', [Date.now()]);
  const old = readCookie(request, config, 'session');
  await config.db.query(`with revoked as (delete from xyvora_sessions where digest = $4)
    insert into xyvora_sessions (digest, account_id, expires_ms) values ($1, $2, $3)`, [digest(session), account.id, Date.now() + 30 * day, old ? digest(old) : null]);
  writeCookie(headers, config, 'session', session, 30 * 86_400);
}

let resetAt = 0;
let runningHashes = 0;
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

async function passwordDigest(password: string, salt: string) {
  if (runningHashes >= 3) throw new ToolError('Sign-in is busy. Try again in a moment.', 429);
  runningHashes++;
  try { return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key))); }
  finally { runningHashes--; }
}
async function localLogin(config: AccountConfig, input: Record<string, unknown>, register: boolean) {
  if (!config.passwords) throw new ToolError('Xyvora password accounts are disabled on this deployment.', 503);
  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  const password = input.password;
  if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(username) || typeof password !== 'string' || password.length < 12 || password.length > 128) throw new ToolError('Use a 3–24 character username and a password between 12 and 128 characters.');
  if (register) {
    const salt = randomBytes(18).toString('hex');
    const key = await passwordDigest(password, salt);
    const [created] = await config.db.query<PublicAccount>(`insert into xyvora_accounts (id, provider, subject, name, password_hash, created_ms)
      values ($1, 'password', $2, $2, $3, $4) on conflict (provider, subject) do nothing returning id, name, email`, [randomUUID(), username, `${salt}:${key.toString('hex')}`, Date.now()]);
    if (!created) throw new ToolError('That username is unavailable.', 409);
    return created;
  }
  const [row] = await config.db.query<PublicAccount & { password_hash: string }>(`select id, name, email, password_hash from xyvora_accounts where provider = 'password' and subject = $1`, [username]);
  const [salt, saved] = row?.password_hash?.split(':') ?? ['0'.repeat(36), '0'.repeat(128)];
  const key = await passwordDigest(password, salt);
  const expected = Buffer.from(saved ?? '', 'hex');
  if (!row || expected.length !== key.length || !timingSafeEqual(key, expected)) throw new ToolError('Username or password was incorrect.', 401);
  return { id: row.id, name: row.name, email: row.email };
}

async function beginOauth(config: AccountConfig, headers: Headers, provider: AccountProvider) {
  const client = config.clients[provider];
  if (!client) throw new ToolError('That sign-in option is not configured.', 503);
  const state = random(), verifier = random();
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

export async function handleAccount(request: Request, config: AccountConfig | undefined, { limit = true } = {}) {
  const url = new URL(request.url);
  const headers = new Headers({ 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
  const json = (data: object, status = 200) => Response.json(data, { status, headers });
  const callback = request.method === 'GET' && ['code', 'error', 'state'].some((name) => url.searchParams.has(name));
  const toHome = (success: boolean) => { headers.set('Location', `/?account=${success ? 'signed-in' : 'failed'}`); return new Response(null, { status: 303, headers }); };
  const memory = url.searchParams.get('section') === 'memory';
  try {
    if (request.method !== 'GET' && request.method !== 'POST') { headers.set('Allow', 'GET, POST'); throw new ToolError('Method not allowed.', 405); }
    if (!config || url.origin !== config.origin) {
      if (callback) return toHome(false);
      if (request.method === 'GET' && !memory) return json(guestAccount());
      throw new ToolError('Sign-in is not configured on this site.', 503);
    }
    if (callback) { if (limit) limitAuth(request, 'login'); return toHome(await finishOauth(request, headers, config)); }
    let input: Record<string, unknown> | undefined;
    if (request.method === 'POST') {
      sameOriginJson(request, config.origin);
      try { input = asObject(await boundedJson(request, 6_000)); }
      catch (error) { throw error instanceof ToolError ? error : new ToolError('Send a valid account request.'); }
      if (limit) limitAuth(request, ['register', 'login', 'start'].includes(String(input.action)) ? 'login' : 'account');
      if (input.action === 'start' && isAccountProvider(input.provider)) return json({ url: await beginOauth(config, headers, input.provider) });
      if (input.action === 'register' || input.action === 'login') {
        const user = await localLogin(config, input, input.action === 'register');
        await createSession(headers, request, config, user);
        return json({ signedIn: true });
      }
    } else if (limit && readCookie(request, config, 'session')) limitAuth(request, 'account');
    const user = await verifiedAccount(request, config);
    if (request.method === 'GET' && !memory) return json({ providers: Object.keys(config.clients).filter(isAccountProvider), passwords: config.passwords, background: config.background, user } satisfies AccountStatus);
    if (input?.action === 'sign-out' && !memory) {
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
    if (!memory && input?.action === 'delete-account' && input.confirm === 'DELETE') {
      await config.db.query('delete from xyvora_accounts where id = $1', [user.id]);
      writeCookie(headers, config, 'session', '', 0);
      writeCookie(headers, config, 'oauth', '', 0);
      return json({ deleted: true });
    }
    if (request.method === 'GET' && memory) {
      const [row] = await config.db.query<{ profile: unknown }>('select profile from xyvora_memory where account_id = $1', [user.id]);
      return json({ profile: row ? parseMemory(row.profile) ?? emptyMemory() : emptyMemory() });
    }
    if (!memory || input?.action !== 'save-memory') throw new ToolError('Unknown account action.');
    const profile = parseMemory(input.profile);
    if (!profile) throw new ToolError('Check the size and number of your memory notes.');
    if (!profile.enabled && !profile.notes.length) await config.db.query('delete from xyvora_memory where account_id = $1', [user.id]);
    else await config.db.query('insert into xyvora_memory (account_id, profile) values ($1,$2::jsonb) on conflict (account_id) do update set profile = excluded.profile', [user.id, JSON.stringify(profile)]);
    return json({ profile });
  } catch (error) {
    if (callback) return toHome(false);
    const status = error instanceof ToolError ? error.status : 503;
    if (status === 429) headers.set('Retry-After', '60');
    return json({ error: error instanceof ToolError ? error.message : 'The account service is unavailable.' }, status);
  }
}
