import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkUpdateLock, makeUpdateKey, makeUpdateVerifier, updateKeyConfigured, updateLocked } from '../server/update-lock.ts';
import { UPDATE_NOTICE } from '../server/update-page.ts';

const origin = 'https://preview.example.invalid';
const password = 'Orbit$Fixture42'; // Fixture only; never use as a shared password.
const key = makeUpdateKey(password);
const now = Date.UTC(2026, 10, 18);
const signIn = (pass = password, { source = origin, target = origin, raw, secFetchSite }: { source?: string; target?: string; raw?: string; secFetchSite?: string } = {}) => new Request(`${target}/_xyvora/unlock`, {
  method: 'POST', headers: { Origin: source, 'Content-Type': 'application/x-www-form-urlencoded', ...(secFetchSite && { 'Sec-Fetch-Site': secFetchSite }) },
  body: raw ?? new URLSearchParams({ password: pass }),
});
const options = { now, limit: false, deployed: true };
const cookieOnly = (response: Response | undefined) => response?.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
const hasPrivateHeaders = (response: Response | undefined) => {
  assert.match(response?.headers.get('cache-control') ?? '', /private.*no-store/);
  assert.equal(response?.headers.get('vercel-cdn-cache-control'), 'no-store');
  assert.equal(response?.headers.get('cdn-cache-control'), 'no-store');
  assert.match(response?.headers.get('vary') ?? '', /cookie/i);
};

test('deployed maintenance is fail-closed; reopening needs an explicit switch and no key', async () => {
  assert.equal(updateLocked({}), false);
  assert.equal(updateLocked({}, true), true);
  assert.equal(updateLocked({ XYVORA_UPDATE_LOCK: '0' }, true), false);
  assert.equal(updateLocked({ XYVORA_UPDATE_LOCK: '0', XYVORA_UPDATE_KEY: 'broken' }, true), true);
  for (const env of [{}, { XYVORA_UPDATE_KEY: 'broken' }]) {
    const response = await checkUpdateLock(signIn(), env, options);
    assert.equal(response?.status, 503);
    assert.equal(cookieOnly(response), '');
    hasPrivateHeaders(response);
    assert.equal((await checkUpdateLock(new Request(origin + '/api/chat'), env, options))?.status, 423);
  }
});

test('locked visitors see the form; API, static, range, and HEAD requests do not get content', async () => {
  const env = { XYVORA_UPDATE_KEY: await key };
  for (const path of ['/', '/about', '/privacy.html?utm_source=test', '/made-up-path']) {
    const response = await checkUpdateLock(new Request(origin + path, { headers: { Accept: 'text/html,application/xhtml+xml' } }), env, options);
    assert.equal(response?.status, 200);
    const html = await response?.text() ?? '';
    assert.ok(html.includes(UPDATE_NOTICE) && html.includes('name="password"') && html.includes('action="/_xyvora/unlock"'));
    assert.ok(!html.includes(env.XYVORA_UPDATE_KEY) && !html.includes(password));
    assert.doesNotMatch(html, /<script\b|Message Xyvora|rel="modulepreload"/i);
    hasPrivateHeaders(response);
  }
  for (const path of ['/theme.js', '/assets/index-bundle.js', '/brand/xyvora-icon.png', '/openapi.json', '/sitemap.xml', '/api/chat', '/api/account?section=library', '/api/analytics', '/api/workspace']) {
    const response = await checkUpdateLock(new Request(origin + path, { headers: { Range: 'bytes=0-127' } }), env, options);
    assert.equal(response?.status, 423, path);
    assert.deepEqual(await response?.json(), { error: UPDATE_NOTICE, code: 'UPDATE_LOCKED' });
    hasPrivateHeaders(response);
  }
  const apiPost = await checkUpdateLock(new Request(origin + '/api/chat', { method: 'POST', body: '{"fixture":true}' }), env, options);
  assert.equal(apiPost?.status, 423);
  const assetHead = await checkUpdateLock(new Request(origin + '/brand/xyvora-icon.png', { method: 'HEAD' }), env, options);
  assert.equal(assetHead?.status, 423);
  assert.equal(await assetHead?.text(), '');
  assert.equal((await checkUpdateLock(new Request(origin + '/robots.txt'), env, options))?.status, 200);
  assert.equal(await (await checkUpdateLock(new Request(origin + '/robots.txt'), env, options))?.text(), 'User-agent: *\nDisallow: /\n');
});

test('unlock is same-origin POST only and verifies the exact password', async () => {
  const env = { XYVORA_UPDATE_KEY: await key };
  const get = await checkUpdateLock(new Request(origin + '/_xyvora/unlock?password=test'), env, options);
  assert.equal(get?.status, 405);
  assert.equal(get?.headers.get('allow'), 'POST');
  for (const request of [signIn(password, { source: 'https://unrelated.example.invalid' }), signIn(password, { source: 'null' }), signIn(password, { secFetchSite: 'cross-site' }), signIn(password, { source: 'http://preview.example.invalid', target: 'http://preview.example.invalid' })]) {
    const response = await checkUpdateLock(request, env, options);
    assert.equal(response?.status, 403);
    assert.equal(cookieOnly(response), '');
  }
  for (const raw of ['', 'password=a&password=b', 'password='.padEnd(2_000, 'a')]) {
    assert.equal((await checkUpdateLock(signIn(password, { raw }), env, options))?.status, 400);
  }
  for (const wrong of [password.toLowerCase(), password.replace('$', ''), password + ' ']) {
    const response = await checkUpdateLock(signIn(wrong), env, options);
    assert.equal(response?.status, 401);
    assert.equal(cookieOnly(response), '');
    assert.doesNotMatch(await response?.text() ?? '', /Orbit\$Fixture42/);
  }
  const accepted = await checkUpdateLock(signIn(), env, options);
  assert.equal(accepted?.status, 303);
  assert.equal(accepted?.headers.get('location'), '/');
  assert.match(accepted?.headers.get('set-cookie') ?? '', /^__Host-xyvora-early=\d{10}\.[a-f0-9]{32}\.[a-f0-9]{64}; Path=\/; Max-Age=28800; HttpOnly; SameSite=Lax; Secure$/);
  hasPrivateHeaders(accepted);
});

test('signature, expiry, rotation and origin isolate access; relock clears only the early cookie', async () => {
  const env = { XYVORA_UPDATE_KEY: await key };
  const pass = cookieOnly(await checkUpdateLock(signIn(), env, options));
  const visit = (cookie: string, address = origin + '/api/chat') => new Request(address, { headers: { Cookie: cookie } });
  assert.equal(await checkUpdateLock(visit(pass), env, options), undefined);
  for (const cookie of ['__Host-xyvora-early=true', pass.slice(0, -1) + (pass.endsWith('a') ? 'b' : 'a'), `${pass}; ${pass}`, pass.replace('__Host-', '')]) {
    assert.equal((await checkUpdateLock(visit(cookie), env, options))?.status, 423);
  }
  assert.equal((await checkUpdateLock(visit(pass, 'https://other.example.invalid/api/chat'), env, options))?.status, 423);
  assert.equal((await checkUpdateLock(visit(pass), env, { ...options, now: now + 28_800_000 }))?.status, 423);
  assert.equal((await checkUpdateLock(visit(pass), { XYVORA_UPDATE_KEY: await makeUpdateKey(password) }, options))?.status, 423);
  const again = await checkUpdateLock(new Request(origin + '/_xyvora/relock', { method: 'POST', headers: { Origin: origin, Cookie: `${pass}; account=fixture` } }), env, options);
  assert.equal(again?.status, 303);
  assert.deepEqual(again?.headers.getSetCookie(), ['__Host-xyvora-early=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure']);
});

test('password guesses are bounded by a short per-client window in a warm instance', async () => {
  const env = { XYVORA_UPDATE_KEY: await key };
  const client = { now, ip: '192.0.2.72', deployed: true };
  for (let i = 0; i < 7; i++) assert.equal((await checkUpdateLock(signIn('', { raw: 'other=input' }), env, client))?.status, 400);
  const capped = await checkUpdateLock(signIn(), env, client);
  assert.equal(capped?.status, 429);
  assert.equal(capped?.headers.get('retry-after'), '300');
  assert.equal(cookieOnly(capped), '');
  assert.equal((await checkUpdateLock(signIn(), env, { ...client, ip: '192.0.2.73' }))?.status, 303);
  assert.equal((await checkUpdateLock(signIn(), env, { ...client, now: now + 300_000 }))?.status, 303);
});

test('two named passwords work alongside the primary and only revoke their own sessions', async () => {
  const tester = 'Separate tester fixture!';
  const dev = 'Different developer fixture!';
  const [testerVerifier, devVerifier] = await Promise.all([makeUpdateVerifier(tester), makeUpdateVerifier(dev)]);
  assert.match(testerVerifier, /^v2\.[a-f0-9]{32}\.[a-f0-9]{64}$/);
  const primary = { XYVORA_UPDATE_KEY: await key };
  const env = { ...primary, XYVORA_UPDATE_KEY_TESTER: testerVerifier, XYVORA_UPDATE_KEY_DEV: devVerifier };
  assert.equal(updateKeyConfigured(env), true);
  const visit = (cookie?: string) => new Request(origin + '/api/chat', { headers: cookie ? { Cookie: cookie } : undefined });
  const oldCookie = cookieOnly(await checkUpdateLock(signIn(), primary, options));
  assert.equal(await checkUpdateLock(visit(oldCookie), env, options), undefined);
  assert.equal((await checkUpdateLock(visit(), env, options))?.status, 423);
  for (const wrong of [tester.toLowerCase(), dev + ' ']) {
    const result = await checkUpdateLock(signIn(wrong), env, options);
    assert.equal(result?.status, 401);
    assert.equal(cookieOnly(result), '');
    const html = await result?.text() ?? '';
    for (const secret of [tester, dev, testerVerifier, devVerifier]) assert.ok(!html.includes(secret));
  }
  const cookies: string[] = [];
  for (const passphrase of [tester, dev]) {
    const result = await checkUpdateLock(signIn(passphrase), env, options);
    assert.equal(result?.status, 303);
    assert.match(result?.headers.get('set-cookie') ?? '', /; HttpOnly; SameSite=Lax; Secure$/);
    const cookie = cookieOnly(result);
    cookies.push(cookie);
    assert.equal(await checkUpdateLock(visit(cookie), env, options), undefined);
  }
  const [testerCookie, devCookie] = cookies;
  const revoked = { ...primary, XYVORA_UPDATE_KEY_DEV: devVerifier };
  assert.equal((await checkUpdateLock(visit(testerCookie), revoked, options))?.status, 423);
  assert.equal((await checkUpdateLock(signIn(tester), revoked, options))?.status, 401);
  assert.equal(await checkUpdateLock(visit(devCookie), revoked, options), undefined);
  assert.equal(await checkUpdateLock(visit(oldCookie), revoked, options), undefined);
  const rotated = { ...env, XYVORA_UPDATE_KEY_TESTER: await makeUpdateVerifier(tester) };
  assert.equal((await checkUpdateLock(visit(testerCookie), rotated, options))?.status, 423);
  assert.equal(await checkUpdateLock(visit(devCookie), rotated, options), undefined);
  const newPrimary = { ...env, XYVORA_UPDATE_KEY: await makeUpdateKey(password) };
  for (const cookie of [oldCookie, ...cookies]) assert.equal((await checkUpdateLock(visit(cookie), newPrimary, options))?.status, 423);
  assert.equal((await checkUpdateLock(signIn(dev), newPrimary, options))?.status, 303);
});

test('misconfigured or excessive named verifiers fail closed even if public mode was selected', async () => {
  const primary = { XYVORA_UPDATE_KEY: await key };
  const verifier = await makeUpdateVerifier('Named credential fixture');
  for (const env of [
    { XYVORA_UPDATE_KEY_TESTER: verifier },
    { ...primary, XYVORA_UPDATE_KEY_TESTER: 'malformed' },
    { ...primary, XYVORA_UPDATE_KEY_TESTER: primary.XYVORA_UPDATE_KEY },
    { ...primary, 'XYVORA_UPDATE_KEY_1TESTER': verifier },
    { ...primary, XYVORA_UPDATE_KEY_A: verifier, XYVORA_UPDATE_KEY_B: verifier },
    { ...primary, XYVORA_UPDATE_KEY_A: verifier, XYVORA_UPDATE_KEY_B: verifier, XYVORA_UPDATE_KEY_C: verifier, XYVORA_UPDATE_KEY_D: verifier },
  ]) {
    const config = { XYVORA_UPDATE_LOCK: '0', ...env };
    assert.equal(updateLocked(config), true);
    assert.equal(updateKeyConfigured(config), false);
    assert.equal((await checkUpdateLock(signIn(), config, options))?.status, 503);
    assert.equal((await checkUpdateLock(new Request(origin + '/api/chat'), config, options))?.status, 423);
  }
});
