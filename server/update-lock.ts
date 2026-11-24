import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { UPDATE_NOTICE, updatePage } from './update-page.ts';

type Env = Record<string, string | undefined>;
const duration = 8 * 60 * 60;
const attemptWindow = 5 * 60 * 1_000;
const unlock = '/_xyvora/unlock', relock = '/_xyvora/relock';
const limits = new Map<string, number>();
let windowEnd = 0, total = 0, hashing = 0;

type KeyMaterial = { salt: Buffer; check: Buffer; key: Buffer };
const namedPrefix = 'XYVORA_UPDATE_KEY_';
const maxNamedKeys = 3;
const namedKeys = (env: Env) => Object.keys(env).filter((name) => name.startsWith(namedPrefix) && env[name]);

// A forced lock with absent/invalid secrets must stay locked. Production
// packaging also checks the entire configured key set before activation.
export const updateLocked = (env: Env, deployed = false) => env.XYVORA_UPDATE_LOCK === '1' || !!env.XYVORA_UPDATE_KEY ||
  (deployed && env.XYVORA_UPDATE_LOCK !== '0') || namedKeys(env).length > 0;
function keyParts(env: Env): KeyMaterial[] {
  const pieces = /^v1\.([a-f0-9]{32})\.([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(env.XYVORA_UPDATE_KEY?.trim() ?? '');
  if (!pieces) return [];
  const primary = { salt: Buffer.from(pieces[1], 'hex'), check: Buffer.from(pieces[2], 'hex'), key: Buffer.from(pieces[3], 'hex') };
  const names = namedKeys(env);
  if (names.length > maxNamedKeys) return [];
  const materials = [primary];
  const verifiers = new Set([`${pieces[1]}.${pieces[2]}`]);
  for (const name of names) {
    if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(name.slice(namedPrefix.length))) return [];
    const parts = /^v2\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(env[name]?.trim() ?? '');
    if (!parts || verifiers.has(`${parts[1]}.${parts[2]}`)) return [];
    verifiers.add(`${parts[1]}.${parts[2]}`);
    // Named values are verifiers only. Derive their signing keys inside the
    // server so adding or rotating one doesn't expose the session signer or
    // invalidate unrelated sessions. Rotating the primary revokes all of them.
    const key = createHmac('sha256', primary.key).update(`xyvora:early:signer:v2\0${name}\0${parts[1]}\0${parts[2]}`).digest();
    materials.push({ salt: Buffer.from(parts[1], 'hex'), check: Buffer.from(parts[2], 'hex'), key });
  }
  return materials;
}
export const updateKeyConfigured = (env: Env) => keyParts(env).length > 0;
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, hash) => error ? reject(error) : resolve(hash)));
async function saltedCheck(password: string) {
  if (!password || password.length > 128) throw new Error('Enter an early-access password of 1–128 characters.');
  const salt = randomBytes(16);
  const check = await derive(password, salt);
  return `${salt.toString('hex')}.${check.toString('hex')}`;
}
export async function makeUpdateKey(password: string) {
  return `v1.${await saltedCheck(password)}.${randomBytes(32).toString('hex')}`;
}
export async function makeUpdateVerifier(password: string) {
  return `v2.${await saltedCheck(password)}`;
}

function cookieName(url: URL) { return (url.protocol === 'https:' ? '__Host-' : '') + 'xyvora-early'; }
function cookie(url: URL, value: string, maxAge: number, deployed: boolean) {
  const embedded = !deployed && url.protocol === 'https:' && url.hostname.endsWith('.e2b.app');
  return `${cookieName(url)}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly${embedded ? '; SameSite=None; Secure; Partitioned' : '; SameSite=Lax' + (url.protocol === 'https:' ? '; Secure' : '')}`;
}
const local = (url: URL) => url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
const safeScheme = (url: URL, deployed: boolean) => url.protocol === 'https:' || (!deployed && local(url));
function proof(material: KeyMaterial, url: URL, payload: string) {
  return createHmac('sha256', material.key).update(`xyvora:early:v1\0${url.origin}\0${payload}\0`).update(material.check).digest();
}
function passCookie(request: Request, url: URL, materials: KeyMaterial[], now: number) {
  const name = cookieName(url) + '=';
  const values = (request.headers.get('cookie') ?? '').split(';').map((chunk) => chunk.trim()).filter((chunk) => chunk.startsWith(name));
  if (values.length !== 1) return false;
  const match = /^(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(values[0].slice(name.length));
  if (!match) return false;
  const expires = Number(match[1]);
  if (expires <= now || expires > now + duration) return false;
  const payload = `${match[1]}.${match[2]}`;
  const signature = Buffer.from(match[3], 'hex');
  return materials.some((material) => timingSafeEqual(proof(material, url, payload), signature));
}

export const updateCacheHeaders = { 'Cache-Control': 'private, no-store, max-age=0, no-transform', 'Vercel-CDN-Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', Vary: 'Cookie' };
const blockedCsp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'";
function gateHeaders() { return new Headers({ ...updateCacheHeaders, 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Xyvora-Update': 'locked' }); }
function gateBody(request: Request, url: URL, status?: number, error = '', extra?: [string, string]) {
  const headers = gateHeaders();
  if (extra) headers.set(...extra);
  if (status === undefined && url.pathname === '/robots.txt' && ['GET', 'HEAD'].includes(request.method)) {
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    return new Response(request.method === 'HEAD' ? null : 'User-agent: *\nDisallow: /\n', { headers });
  }
  const method = request.method === 'GET' || request.method === 'HEAD';
  const acceptsHtml = method && (url.pathname === '/' || url.pathname === '/_xyvora/update' || /text\/html/i.test(request.headers.get('accept') ?? ''));
  const api = /^\/(?:api)(?:\/|$)/i.test(url.pathname);
  if (status === undefined && (api || !acceptsHtml)) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({ error: UPDATE_NOTICE, code: 'UPDATE_LOCKED' }), { status: 423, headers });
  }
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Content-Security-Policy', blockedCsp + (url.hostname.endsWith('.e2b.app') || local(url) ? '' : "; frame-ancestors 'none'"));
  return new Response(request.method === 'HEAD' ? null : updatePage(error), { status: status ?? 200, headers });
}
function proceed(setCookie: string) {
  const headers = gateHeaders();
  headers.delete('X-Xyvora-Update');
  headers.set('Location', '/');
  headers.set('Set-Cookie', setCookie);
  return new Response(null, { status: 303, headers });
}
function sameOrigin(request: Request, url: URL) {
  return request.headers.get('origin') === url.origin && request.headers.get('sec-fetch-site') !== 'cross-site';
}
async function submittedPassword(request: Request) {
  if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get('content-type') ?? '') || Number(request.headers.get('content-length')) > 1600) return;
  const reader = request.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, form = '';
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]);
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1600) return;
      form += decoder.decode(value, { stream: true });
    }
    const values = new URLSearchParams(form + decoder.decode()).getAll('password');
    if (values.length === 1 && values[0] && values[0].length <= 128) return values[0];
  } catch { /* Invalid encoding or a canceled submission. */ }
  finally { signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
}

export async function checkUpdateLock(request: Request, env: Env, { deployed = false, ip, now = Date.now(), limit = true }: { deployed?: boolean; ip?: string; now?: number; limit?: boolean } = {}): Promise<Response | undefined> {
  if (!updateLocked(env, deployed)) return;
  const url = new URL(request.url);
  const materials = keyParts(env);
  const seconds = Math.floor(now / 1_000);
  if (url.pathname === unlock || url.pathname === relock) {
    if (request.method !== 'POST') return gateBody(request, url, 405, '', ['Allow', 'POST']);
    if (!safeScheme(url, deployed) || !sameOrigin(request, url)) return gateBody(request, url, 403, 'Open Xyvora in this browser before submitting the form.');
    if (url.pathname === relock) return proceed(cookie(url, '', 0, deployed));
    if (!materials.length) return gateBody(request, url, 503, 'Early access is temporarily unavailable. Try again shortly.');
    if (limit) {
      if (windowEnd <= now) { limits.clear(); total = 0; windowEnd = now + attemptWindow; }
      const visitor = ip && isIP(ip) ? ip : 'unknown';
      const used = limits.get(visitor) ?? 0;
      if (used >= 7 || total >= 120) return gateBody(request, url, 429, 'Too many attempts. Wait a few minutes before trying again.', ['Retry-After', String(Math.max(1, Math.ceil((windowEnd - now) / 1_000)))]);
      limits.set(visitor, used + 1); total++;
    }
    const password = await submittedPassword(request);
    if (!password) return gateBody(request, url, 400, 'Enter your early-access password and try again.');
    if (limit && hashing >= 3) return gateBody(request, url, 429, 'Too many attempts. Try again shortly.', ['Retry-After', '2']);
    hashing++;
    try {
      let matched: KeyMaterial | undefined;
      // Verify sequentially to retain the memory bound, and don't stop early
      // based on which named credential was used.
      for (const material of materials) {
        if (timingSafeEqual(await derive(password, material.salt), material.check)) matched ??= material;
      }
      if (!matched) return gateBody(request, url, 401, 'That password didn’t match. Please try again.');
      const payload = `${seconds + duration}.${randomBytes(16).toString('hex')}`;
      return proceed(cookie(url, `${payload}.${proof(matched, url, payload).toString('hex')}`, duration, deployed));
    } catch { return gateBody(request, url, 503, 'Early access is temporarily unavailable. Try again shortly.'); }
    finally { hashing--; }
  }
  if (materials.length && safeScheme(url, deployed) && passCookie(request, url, materials, seconds)) {
    if (url.pathname === '/_xyvora/update') return new Response(null, { status: 302, headers: { ...updateCacheHeaders, Location: '/' } });
    return;
  }
  return gateBody(request, url);
}
