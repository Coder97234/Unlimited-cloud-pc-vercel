import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { XYVORA_URL } from '../shared/models.ts';
import type { ConnectionStatus, Provider } from '../shared/workspace-tools.ts';
import { asObject, providerJson, shortText, ToolError } from './workspace-http.ts';

const gmailScope = 'https://www.googleapis.com/auth/gmail.metadata';
const providers = {
  gmail: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: gmailScope },
  vercel: { authorize: 'https://vercel.com/oauth/authorize', token: 'https://api.vercel.com/login/oauth/token', scope: 'openid profile' },
} as const;
const authSeconds = 600;
const sessionSeconds = 3_600;

type OAuthClient = { id: string; secret: string };
export type WorkspaceConfig = {
  origin: string;
  sessionKey?: Buffer;
  clients: Partial<Record<Provider, OAuthClient>>;
  image?: { key: string; accessCode: string };
};

type Env = Record<string, string | undefined>;
export function workspaceConfig(env: Env): WorkspaceConfig {
  let origin = XYVORA_URL;
  if (env.XYVORA_WORKSPACE_ORIGIN) {
    const parsed = new URL(env.XYVORA_WORKSPACE_ORIGIN);
    if (parsed.protocol !== 'https:' || parsed.origin !== env.XYVORA_WORKSPACE_ORIGIN) throw new Error('XYVORA_WORKSPACE_ORIGIN must be an HTTPS origin without a path.');
    origin = parsed.origin;
  }
  const secret = env.XYVORA_CONNECT_SECRET;
  const sessionKey = secret && secret.length >= 32 ? createHash('sha256').update(secret).digest() : undefined;
  const clients: WorkspaceConfig['clients'] = {};
  for (const provider of ['gmail', 'vercel'] as const) {
    const prefix = `XYVORA_${provider.toUpperCase()}`;
    const id = env[`${prefix}_CLIENT_ID`], clientSecret = env[`${prefix}_CLIENT_SECRET`];
    if (sessionKey && id && clientSecret) clients[provider] = { id, secret: clientSecret };
  }
  const accessCode = env.XYVORA_IMAGE_ACCESS_CODE, key = env.XYVORA_IMAGE_API_KEY;
  const image = key && accessCode && accessCode.length >= 24 ? { key, accessCode } : undefined;
  return { origin, sessionKey, clients, image };
}

export function equalSecret(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
const authCookie = (provider: Provider) => `__Host-xyvora-${provider}-oauth`;
const connectionCookie = (provider: Provider) => `__Host-xyvora-${provider}`;
const cookie = (name: string, value: string, age: number) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
function readCookie(request: Request, name: string) {
  const prefix = `${name}=`;
  return request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
}

function seal(config: WorkspaceConfig, name: string, payload: object) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.sessionKey!, iv);
  cipher.setAAD(Buffer.from(`${config.origin}:${name}`));
  const value = Buffer.concat([iv, cipher.update(JSON.stringify(payload)), cipher.final(), cipher.getAuthTag()]).toString('base64url');
  if (value.length > 3_700) throw new ToolError('The provider session is too large.');
  return value;
}

function unseal(request: Request, config: WorkspaceConfig, name: string) {
  const value = readCookie(request, name);
  if (!config.sessionKey || !value || value.length > 3_700 || !/^[\w-]+$/.test(value)) return;
  try {
    const raw = Buffer.from(value, 'base64url');
    if (raw.length < 29) return;
    const decipher = createDecipheriv('aes-256-gcm', config.sessionKey, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${config.origin}:${name}`));
    decipher.setAuthTag(raw.subarray(-16));
    const data = asObject(JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, -16)), decipher.final()]).toString('utf8')));
    if (typeof data.expires === 'number' && data.expires > Date.now()) return data;
  } catch { /* Invalid, expired, or forged cookies are not sessions. */ }
}

const callback = (config: WorkspaceConfig) => `${config.origin}/api/workspace`;
const onConfiguredOrigin = (request: Request, config: WorkspaceConfig) => new URL(request.url).origin === config.origin;
function sessionToken(request: Request, config: WorkspaceConfig, provider: Provider) {
  if (!onConfiguredOrigin(request, config) || !config.clients[provider]) return;
  const token = unseal(request, config, connectionCookie(provider))?.token;
  if (typeof token === 'string') return token;
}

export function connectionStatus(request: Request, config: WorkspaceConfig, provider: Provider): ConnectionStatus {
  if (!onConfiguredOrigin(request, config) || !config.clients[provider]) return 'unconfigured';
  return sessionToken(request, config, provider) ? 'connected' : 'disconnected';
}

export function startConnection(request: Request, config: WorkspaceConfig, provider: Provider, headers: Headers) {
  const client = config.clients[provider];
  if (!onConfiguredOrigin(request, config) || !client) throw new ToolError('This account connection is not configured for this site.', 503);
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const name = authCookie(provider);
  headers.append('set-cookie', cookie(name, seal(config, name, { state, verifier, expires: Date.now() + authSeconds * 1_000 }), authSeconds));
  const auth = new URL(providers[provider].authorize);
  auth.search = new URLSearchParams({
    client_id: client.id, redirect_uri: callback(config), response_type: 'code', state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    scope: providers[provider].scope,
    ...(provider === 'gmail' ? { access_type: 'online', include_granted_scopes: 'false', prompt: 'consent select_account' } : { prompt: 'consent' }),
  }).toString();
  return auth.href;
}

export async function finishConnection(request: Request, config: WorkspaceConfig, headers: Headers) {
  if (!onConfiguredOrigin(request, config)) throw new ToolError('Use the configured Xyvora origin.', 403);
  const params = new URL(request.url).searchParams;
  const state = params.get('state'), code = params.get('code');
  if (!state || !/^[\w-]{43}$/.test(state) || params.getAll('state').length !== 1 || params.getAll('code').length > 1) throw new ToolError('No matching account connection. Start again in Xyvora.');
  // State is authenticated and bound to its provider cookie, not to a provider
  // name (or token URL) supplied by the callback URL or the browser.
  const provider = (['gmail', 'vercel'] as const).find((id) => {
    const pending = unseal(request, config, authCookie(id));
    return config.clients[id] && typeof pending?.state === 'string' && equalSecret(state, pending.state);
  });
  if (!provider) throw new ToolError('No matching account connection. Start again in Xyvora.');
  const client = config.clients[provider]!;
  const pending = unseal(request, config, authCookie(provider));
  let result: 'connected' | 'failed' = 'failed';
  headers.append('set-cookie', cookie(authCookie(provider), '', 0));
  if (!params.has('error') && code && code.length < 1_600 && /^\S+$/.test(code) && typeof pending?.verifier === 'string') {
    try {
      const data = await providerJson(providers[provider].token, request.signal, {
        method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: pending.verifier,
          redirect_uri: callback(config), client_id: client.id, client_secret: client.secret }),
      }, { limit: 16_000 });
      const token = data.access_token;
      const expires = typeof data.expires_in === 'number' ? Math.floor(data.expires_in) : 0;
      const age = Math.min(expires, sessionSeconds);
      if (typeof token !== 'string' || token.length > 2_500 || !/^[\x21-\x7e]+$/.test(token) || age < 1 || !Number.isFinite(age)) throw new ToolError('Invalid provider session.');
      if (provider === 'gmail' && typeof data.scope === 'string' && data.scope.trim() !== gmailScope) throw new ToolError('Unexpected Gmail permissions.');
      const name = connectionCookie(provider);
      headers.append('set-cookie', cookie(name, seal(config, name, { token, expires: Date.now() + age * 1_000 }), age));
      result = 'connected';
    } catch { /* A failed grant never becomes a connection. */ }
  }
  headers.set('location', `${config.origin}/?connection=${provider}-${result}`);
  return new Response(null, { status: 303, headers });
}

export async function disconnect(request: Request, config: WorkspaceConfig, provider: Provider, headers: Headers) {
  const token = sessionToken(request, config, provider);
  headers.append('set-cookie', cookie(connectionCookie(provider), '', 0));
  headers.append('set-cookie', cookie(authCookie(provider), '', 0));
  const client = config.clients[provider];
  if (!token || !client) return false;
  const url = provider === 'gmail' ? 'https://oauth2.googleapis.com/revoke' : 'https://api.vercel.com/login/oauth/token/revoke';
  const credentials = provider === 'vercel' ? { Authorization: `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString('base64')}` } : undefined;
  try {
    const response = await fetch(url, { method: 'POST', headers: credentials, body: new URLSearchParams({ token }), redirect: 'error', signal: AbortSignal.timeout(3_000) });
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch { return false; } // Clear the local session even when provider revocation fails.
}

export async function readConnection(request: Request, config: WorkspaceConfig, provider: Provider, operation: string) {
  const token = sessionToken(request, config, provider);
  if (!token) throw new ToolError('Connect this account first. The connection may have expired.', 401);
  const options = { headers: { Authorization: `Bearer ${token}` } };
  if (provider === 'gmail' && operation === 'inbox') {
    const base = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
    const list = await providerJson(`${base}?maxResults=5&labelIds=INBOX&fields=messages(id)`, request.signal, options);
    const ids = (Array.isArray(list.messages) ? list.messages : []).slice(0, 5).map((item) => asObject(item).id)
      .filter((id): id is string => typeof id === 'string' && /^[\da-z_-]{1,80}$/i.test(id));
    const results = await Promise.all(ids.map(async (id) => {
      const params = new URLSearchParams({ format: 'metadata', fields: 'payload(headers)' });
      for (const name of ['Subject', 'From', 'Date']) params.append('metadataHeaders', name);
      const message = await providerJson(`${base}/${id}?${params}`, request.signal, options, { limit: 24_000 });
      const { headers } = asObject(message.payload);
      const lookup = (name: string) => shortText(asObject((Array.isArray(headers) ? headers : []).find((header) => shortText(asObject(header).name).toLowerCase() === name)).value);
      return { subject: lookup('subject') || '(no subject)', from: lookup('from'), date: lookup('date') };
    }));
    return { messages: results };
  }
  if (provider === 'vercel' && operation === 'profile') {
    const profile = await providerJson('https://api.vercel.com/login/oauth/userinfo', request.signal, { ...options, method: 'POST' });
    return { name: shortText(profile.name), username: shortText(profile.preferred_username ?? profile.username) };
  }
  if (provider === 'vercel' && operation === 'projects') {
    const data = await providerJson('https://api.vercel.com/v9/projects?limit=8', request.signal, options, { limit: 320_000 });
    return { projects: (Array.isArray(data.projects) ? data.projects : []).slice(0, 8).map((item) => {
      const project = asObject(item);
      return { name: shortText(project.name), framework: shortText(project.framework), updatedAt: typeof project.updatedAt === 'number' ? project.updatedAt : undefined };
    }) };
  }
  throw new ToolError('This account action is not supported.');
}
