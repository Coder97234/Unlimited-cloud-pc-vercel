import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { accountConfig, digest, handleAccount } from '../server/account.ts';
import { workspaceConfig } from '../server/workspace-connections.ts';
import { handleWorkspace } from '../server/workspace.ts';
import { CookieJar, platformFixture, platformOrigin as origin, platformPost } from './platform-fixture.ts';
import type { Provider } from '../shared/workspace-tools.ts';

const path = '/api/workspace?feature=connections';
const env = {
  XYVORA_ACCOUNT_ORIGIN: origin, XYVORA_WORKSPACE_ORIGIN: origin, XYVORA_ENABLE_APP_CONNECTIONS: '1', XYVORA_CONNECT_SECRET: 'fixture-only-encryption-key-not-live'.repeat(2),
  XYVORA_GMAIL_PLUGIN_ENABLED: '1', XYVORA_GMAIL_CLIENT_ID: 'test-gmail-app', XYVORA_GMAIL_CLIENT_SECRET: 'test-gmail-secret',
  XYVORA_VERCEL_PLUGIN_ENABLED: '1', XYVORA_VERCEL_CLIENT_ID: 'test-vercel-app', XYVORA_VERCEL_CLIENT_SECRET: 'test-vercel-secret',
};
const metadata = 'https://www.googleapis.com/auth/gmail.metadata';

test('opt-in app route binds single-use consent and read approvals to the verified session', async (t) => {
  const db = await platformFixture(t);
  const config = workspaceConfig(env);
  const accounts = accountConfig(env, db)!;
  const handle = (request: Request) => handleWorkspace(request, config, { accounts, limit: false });
  assert.equal(workspaceConfig({ ...env, XYVORA_ENABLE_APP_CONNECTIONS: '0' }).appConnections, false);
  assert.equal(workspaceConfig({ ...env, XYVORA_WORKSPACE_ORIGIN: 'http://wrong.invalid' }).appConnections, undefined);
  async function member(jar: CookieJar, owner = randomUUID()) {
    const token = randomBytes(32).toString('base64url');
    await db.query(`insert into xyvora_accounts (id,provider,subject,name,created_ms) values($1,'google',$2,'Fixture',0) on conflict do nothing`, [owner, owner]);
    await db.query('insert into xyvora_sessions (digest,account_id,expires_ms) values($1,$2,$3)', [digest(token), owner, Date.now() + 60_000]);
    jar.values.set('__Host-xyvora-session', token);
    return owner;
  }
  const jar = new CookieJar(), other = new CookieJar(), sameAccount = new CookieJar();
  const owner = await member(jar), unrelated = await member(other);
  await member(sameAccount, owner);
  const get = (headers = jar.headers(owner)) => handle(new Request(origin + path, { headers }));
  const call = (body: object, headers = jar.headers(owner)) => handle(platformPost(path, body, headers));
  const pending = new Map<Provider, URL>();
  let exchanges = 0, reads = 0, revoked = 0;
  const providerFetch = t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const url = new URL(input), headers = new Headers(init.headers);
    assert.equal(init.redirect, 'error');
    if (url.pathname === '/token' || url.pathname === '/login/oauth/token') {
      exchanges++;
      const provider = url.host === 'oauth2.googleapis.com' ? 'gmail' : 'vercel';
      assert.ok(init.body instanceof URLSearchParams);
      assert.equal(init.body.get('redirect_uri'), `${origin}/api/workspace`);
      assert.equal(init.body.get('code'), `code-${provider}`);
      assert.equal(init.body.get('client_id'), `test-${provider}-app`);
      assert.equal(init.body.get('client_secret'), `test-${provider}-secret`);
      assert.equal(createHash('sha256').update(init.body.get('code_verifier')!).digest('base64url'), pending.get(provider)!.searchParams.get('code_challenge'));
      return Response.json({ access_token: `${provider}-fixture-token`, expires_in: 3600, ...(provider === 'gmail' && { scope: metadata }), refresh_token: 'do not keep' });
    }
    if (url.pathname === '/revoke' || url.pathname === '/login/oauth/token/revoke') {
      revoked++;
      assert.ok(init.body instanceof URLSearchParams);
      assert.match(init.body.get('token')!, /^(gmail|vercel)-fixture-token$/);
      return new Response(null, { status: 200 });
    }
    reads++;
    if (url.host === 'gmail.googleapis.com') {
      assert.equal(headers.get('authorization'), 'Bearer gmail-fixture-token');
      if (url.pathname.endsWith('/messages')) {
        assert.deepEqual(Object.fromEntries(url.searchParams), { maxResults: '5', labelIds: 'INBOX', fields: 'messages(id)' });
        return Response.json({ messages: [{ id: 'message123' }], debug: 'private' });
      }
      assert.equal(url.pathname, '/gmail/v1/users/me/messages/message123');
      assert.equal(url.searchParams.get('format'), 'metadata');
      assert.deepEqual(url.searchParams.getAll('metadataHeaders'), ['Subject', 'From', 'Date']);
      return Response.json({ payload: { body: { data: 'private body' }, headers: [{ name: 'Subject', value: 'Fixture note' }, { name: 'From', value: 'fixture@example.invalid' }] } });
    }
    assert.equal(url.host, 'api.vercel.com');
    assert.equal(headers.get('authorization'), 'Bearer vercel-fixture-token');
    if (url.pathname.endsWith('/userinfo')) return Response.json({ name: 'Fixture account', preferred_username: 'fixture', email: 'private email' });
    assert.equal(url.pathname, '/v10/projects');
    assert.equal(url.searchParams.get('limit'), '8');
    if (url.searchParams.get('slug') !== 'fixture-team') return Response.json({ error: 'private provider error' }, { status: 403 });
    return Response.json({ projects: [{ name: 'fixture-site', framework: 'vite', env: 'private configuration' }] });
  });
  assert.equal((await get({})).status, 401);
  assert.equal((await get(jar.headers())).status, 409, 'The account header is mandatory outside the callback');
  assert.equal((await get(other.headers(owner))).status, 409);
  assert.equal((await call({ action: 'connect', provider: 'gmail' }, { ...jar.headers(owner), Origin: 'https://elsewhere.invalid' })).status, 403);
  assert.equal((await call({ action: 'connect', provider: 'gmail', approved: false })).status, 403);
  assert.equal((await call({ action: 'image', provider: 'gmail', approved: true })).status, 400);
  assert.equal((await handle(platformPost('/api/workspace', { action: 'repository', approved: true }, jar.headers(owner)))).status, 404);
  assert.deepEqual(await (await get()).json(), { connections: { gmail: 'disconnected', vercel: 'disconnected' } });
  assert.equal(providerFetch.mock.callCount(), 0);

  for (const provider of ['gmail', 'vercel'] as const) {
    const start = await call({ action: 'connect', provider, approved: true });
    assert.equal(start.status, 200);
    assert.match(start.headers.getSetCookie()[0], /HttpOnly; Secure; SameSite=Lax/);
    jar.update(start);
    const consent = new URL((await start.json()).url);
    pending.set(provider, consent);
    assert.equal(consent.origin, provider === 'gmail' ? 'https://accounts.google.com' : 'https://vercel.com');
    assert.equal(consent.searchParams.get('scope'), provider === 'gmail' ? metadata : 'openid profile');
    const url = `${origin}/api/workspace?state=${consent.searchParams.get('state')}&code=code-${provider}`;
    const state = new Map(jar.values);
    const callback = (headers: HeadersInit) => handle(new Request(url, { headers }));
    const switched = { Cookie: jar.headers().Cookie.replace(/__Host-xyvora-session=[^;]+/, `__Host-xyvora-session=${other.values.get('__Host-xyvora-session')}`) };
    assert.equal((await callback(switched)).status, 400);
    assert.equal(exchanges, provider === 'gmail' ? 0 : 1);
    const replies = await Promise.all([callback(jar.headers()), callback(jar.headers())]);
    assert.deepEqual(replies.map(({ status }) => status).sort(), [303, 409]);
    const done = replies.find(({ status }) => status === 303)!;
    assert.equal(done.headers.get('location'), `${origin}/?connection=${provider}-connected`);
    assert.doesNotMatch(JSON.stringify(done.headers.getSetCookie()), /fixture-token|do not keep/);
    jar.update(done);
    assert.equal(await (await get()).json().then(({ connections }) => connections[provider]), 'connected');
    const replay = new CookieJar(); replay.values = state;
    assert.equal((await callback(replay.headers())).status, 409, 'The OAuth attempt is consumed before exchange');
    for (const [foreign, account] of [[other, unrelated], [sameAccount, owner]] as const) {
      foreign.values.set(`__Host-xyvora-${provider}`, jar.values.get(`__Host-xyvora-${provider}`)!);
      const res = await get(foreign.headers(account));
      assert.equal(res.status, 200);
      assert.equal((await res.json()).connections[provider], 'disconnected');
      assert.equal((await call({ action: 'account', operation: provider === 'gmail' ? 'inbox' : 'profile', provider, approved: true }, foreign.headers(account))).status, 401);
    }
  }
  assert.equal(exchanges, 2);
  assert.equal(reads, 0, 'Status and consent do not read external account data');
  assert.equal((await call({ action: 'account', provider: 'gmail', operation: 'inbox' })).status, 403);
  assert.equal((await call({ action: 'account', provider: 'gmail', operation: 'send', approved: true })).status, 400);
  const inbox = await call({ action: 'account', provider: 'gmail', operation: 'inbox', approved: true });
  assert.match(inbox.headers.get('cache-control') ?? '', /private, no-store/);
  assert.deepEqual(await inbox.json(), { messages: [{ subject: 'Fixture note', from: 'fixture@example.invalid', date: '' }] });
  assert.deepEqual(await (await call({ action: 'account', provider: 'vercel', operation: 'profile', approved: true })).json(), { name: 'Fixture account', username: 'fixture' });
  const projects = (teamSlug?: string) => call({ action: 'account', provider: 'vercel', operation: 'projects', approved: true, teamSlug });
  assert.equal((await projects('https://not-a-slug.example.com')).status, 400);
  const denied = await projects();
  assert.equal(denied.status, 403);
  assert.match((await denied.json()).error, /Projects read access/);
  assert.deepEqual(await (await projects('fixture-team')).json(), { projects: [{ name: 'fixture-site', framework: 'vite' }] });
  assert.equal(reads, 5);
  const disconnect = await call({ action: 'disconnect', provider: 'gmail', approved: true });
  assert.deepEqual(await disconnect.json(), { disconnected: true, revoked: true });
  jar.update(disconnect);
  assert.equal(jar.values.has('__Host-xyvora-gmail'), false);
  assert.equal(revoked, 1);
  const signedOut = await handleAccount(platformPost('/api/account', { action: 'sign-out' }, jar.headers(owner)), accounts, { limit: false });
  assert.match(signedOut.headers.getSetCookie().join('; '), /__Host-xyvora-vercel=;.*Max-Age=0/);
  assert.equal((await get()).status, 401, 'Old provider cookie cannot outlive the account session');
  assert.equal((await db.query('select digest from xyvora_auth_attempts')).length, 0);
});
