import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { accountConfig, handleAccount } from '../server/account.ts';
import { handleChat, parseChat } from '../server/chat.ts';
import { emptyMemory, MAX_MEMORY_NOTE, memoryForSend, parseMemory, preferencesContext } from '../shared/memory.ts';
import { loadGuestMemory, saveMemory } from '../src/lib/account.ts';
import { loadThreads, storeThreads } from '../src/lib/history.ts';
import { readChatEvents } from '../src/lib/stream.ts';
import type { MemoryProfile } from '../shared/memory.ts';
import type { Thread } from '../src/lib/history.ts';

import { guestAccount } from '../shared/account.ts';
import { CookieJar, platformFixture, platformOrigin as origin, platformPost } from './platform-fixture.ts';

const accountPath = '/api/account';
const endpoint = origin + accountPath;
const memoryPath = `${accountPath}?section=memory`;
const ada = { id: '11111111-1111-4111-8111-111111111111', email: 'ada@example.invalid' };
const ben = { id: '22222222-2222-4222-8222-222222222222', email: 'ben@example.invalid' };
const noDb = { async query(sql: string): Promise<never[]> {
  assert.equal(sql, 'select 1 from xyvora_cloud_history limit 0', 'only the schema check is expected');
  return [];
} };

test('account storage is optional and requires an exact production HTTPS origin', async () => {
  assert.equal(accountConfig({}), undefined);
  for (const value of ['http://example.invalid', `${origin}/chat`, `${origin}/`, 'https://user@owner.invalid']) assert.equal(accountConfig({ XYVORA_ACCOUNT_ORIGIN: value }, noDb), undefined);
  const env = { XYVORA_ACCOUNT_ORIGIN: origin, XYVORA_LOGIN_GOOGLE_ID: 'fixture-id', XYVORA_LOGIN_GOOGLE_SECRET: 'fixture-secret', XYVORA_LOGIN_GITHUB_ID: 'missing-secret' };
  const config = accountConfig(env, noDb)!;
  const status = await handleAccount(new Request(endpoint), config);
  assert.match(status.headers.get('cache-control') ?? '', /private, no-store/);
  assert.deepEqual(await status.json(), { ...guestAccount(), providers: ['google'] });
  assert.deepEqual(await (await handleAccount(new Request(endpoint), undefined)).json(), guestAccount());
  assert.deepEqual(await (await handleAccount(new Request('https://alias.invalid/api/account'), config)).json(), guestAccount());
  const issue = (request: Request) => handleAccount(request, config, { limit: false });
  assert.equal((await issue(new Request(origin + memoryPath))).status, 401);
  assert.equal((await issue(platformPost(accountPath, { action: 'start', provider: 'google' }, { Origin: 'https://outside.invalid' }))).status, 403);
  assert.equal((await issue(platformPost(accountPath, { action: 'start', provider: 'google' }, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await issue(platformPost(accountPath, { action: 'request-signup', email: 'test@example.invalid' }))).status, 503);
  assert.equal((await issue(platformPost(accountPath, { action: 'start', provider: 'google', extra: 'x'.repeat(6_000) }))).status, 413);
  const missing = await issue(new Request(`${endpoint}?code=missing-state&next=https://outside.invalid`));
  assert.equal(missing.status, 303);
  assert.equal(missing.headers.get('location'), '/?account=failed');
  assert.equal(missing.headers.get('referrer-policy'), 'no-referrer');
  assert.deepEqual(accountConfig(env, noDb, 'https://host.e2b.app')?.clients, config.clients);
  assert.deepEqual(accountConfig({ ...env, XYVORA_ACCOUNT_ORIGIN: undefined }, noDb, 'https://host.e2b.app')?.clients, {});
});

test('Google and GitHub fixture sign-in verifies PKCE, consumes state, and isolates accounts and memory', async (t) => {
  const db = await platformFixture(t);
  const config = accountConfig({ XYVORA_ACCOUNT_ORIGIN: origin,
    XYVORA_LOGIN_GOOGLE_ID: 'google-fixture', XYVORA_LOGIN_GOOGLE_SECRET: 'google-secret',
    XYVORA_LOGIN_GITHUB_ID: 'github-fixture', XYVORA_LOGIN_GITHUB_SECRET: 'github-secret' }, db)!;
  const issue = (request: Request) => handleAccount(request, config, { limit: false });
  const challenges = new Map<string, string>();
  let exchanges = 0;
  t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    assert.equal(init?.redirect, 'error');
    const req = new Request(input, init);
    if (req.method === 'POST') {
      const isGoogle = input === 'https://oauth2.googleapis.com/token';
      assert.ok(isGoogle || input === 'https://github.com/login/oauth/access_token');
      const provider = isGoogle ? 'google' : 'github';
      const form = await req.formData();
      assert.equal(form.get('client_id'), `${provider}-fixture`);
      assert.equal(form.get('client_secret'), `${provider}-secret`);
      assert.equal(form.get('redirect_uri'), endpoint);
      const code = String(form.get('code'));
      assert.equal(createHash('sha256').update(String(form.get('code_verifier'))).digest('base64url'), challenges.get(code));
      exchanges++;
      return Response.json({ access_token: `only-use-once-${provider}`, refresh_token: 'never-store-me' });
    }
    if (input === 'https://openidconnect.googleapis.com/v1/userinfo') {
      assert.equal(req.headers.get('authorization'), 'Bearer only-use-once-google');
      return Response.json({ sub: 'shared-id', name: 'Ada Fixture', email: 'verified@example.invalid', email_verified: true });
    }
    assert.equal(input, 'https://api.github.com/user');
    assert.equal(req.headers.get('authorization'), 'Bearer only-use-once-github');
    return Response.json({ id: 'shared-id', login: 'BenFixture', email: 'unverified@example.invalid' });
  });
  async function begin(provider: 'google' | 'github', jar: CookieJar, code: string) {
    const start = await issue(platformPost(accountPath, { action: 'start', provider, redirectTo: 'https://outside.invalid' }, jar.headers()));
    assert.equal(start.status, 200);
    const target = new URL((await start.json()).url);
    assert.equal(target.origin, provider === 'google' ? 'https://accounts.google.com' : 'https://github.com');
    assert.equal(target.searchParams.get('redirect_uri'), endpoint);
    assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
    challenges.set(code, target.searchParams.get('code_challenge')!);
    assert.match(start.headers.getSetCookie().join(''), /^__Host-xyvora-oauth=[\w-]{43}; Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    jar.update(start);
    return `${endpoint}?code=${code}&state=${target.searchParams.get('state')}`;
  }
  async function finish(callback: string, jar: CookieJar) {
    const tried = new Request(callback, { headers: jar.headers() });
    const success = await issue(tried.clone());
    assert.equal(success.headers.get('location'), '/?account=signed-in');
    jar.update(success);
    assert.equal(jar.values.has('__Host-xyvora-oauth'), false);
    assert.match(jar.values.get('__Host-xyvora-session') ?? '', /^[\w-]{43}$/);
    assert.match(success.headers.getSetCookie().at(-1) ?? '', /Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    assert.equal((await issue(tried)).headers.get('location'), '/?account=failed');
  }
  const a = new CookieJar(), b = new CookieJar();
  const stale = await begin('github', a, 'old-github');
  const current = await begin('google', a, 'current-google');
  assert.equal((await issue(new Request(stale, { headers: a.headers() }))).headers.get('location'), '/?account=failed');
  assert.equal(exchanges, 0);
  await finish(current, a);
  await finish(await begin('github', b, 'current-github'), b);
  assert.equal(exchanges, 2);
  const status = async (jar: CookieJar) => (await (await issue(new Request(endpoint, { headers: jar.headers() }))).json()).user;
  const signedInA = await status(a), signedInB = await status(b);
  assert.equal(signedInA.email, 'verified@example.invalid');
  assert.equal(signedInB.email, '');
  assert.notEqual(signedInA.id, signedInB.id);
  const [savedSession] = await db.query('select digest from xyvora_sessions where account_id=$1', [signedInA.id]);
  assert.equal(savedSession.digest, createHash('sha256').update(a.values.get('__Host-xyvora-session')!).digest('hex'));
  assert.doesNotMatch(JSON.stringify(await db.query('select * from xyvora_accounts')), /never-store-me|only-use-once-/);
  const read = (jar: CookieJar, id: string) => issue(new Request(origin + memoryPath, { headers: jar.headers(id) }));
  const save = (jar: CookieJar, id: string, profile: MemoryProfile) => issue(platformPost(memoryPath, { action: 'save-memory', profile, user_id: signedInB.id }, jar.headers(id)));
  assert.deepEqual(await (await read(a, signedInA.id)).json(), { profile: emptyMemory() });
  const notes = { enabled: true, notes: ['Prefer examples from Ada’s workshop.'] };
  assert.equal((await save(a, signedInA.id, notes)).status, 200);
  assert.equal((await read(b, signedInA.id)).status, 409);
  assert.equal((await save(b, signedInA.id, emptyMemory())).status, 409);
  assert.deepEqual(await (await read(b, signedInB.id)).json(), { profile: emptyMemory() });
  assert.deepEqual(await (await read(a, signedInA.id)).json(), { profile: notes });
  assert.equal((await save(a, signedInA.id, { enabled: false, notes: ['x'.repeat(MAX_MEMORY_NOTE + 1)] })).status, 400);
  assert.equal((await save(a, signedInA.id, { enabled: false, notes: ['edited'] })).status, 200);
  assert.deepEqual(await (await read(a, signedInA.id)).json(), { profile: { enabled: false, notes: ['edited'] } });
  assert.equal((await issue(platformPost(accountPath, { action: 'sign-out' }, a.headers(signedInB.id)))).status, 409);
  const oldHeaders = a.headers(signedInA.id);
  const logout = await issue(platformPost(accountPath, { action: 'sign-out' }, oldHeaders));
  assert.deepEqual(await logout.json(), { signedOut: true });
  a.update(logout);
  assert.equal(a.values.size, 0);
  assert.equal((await issue(new Request(origin + memoryPath, { headers: oldHeaders }))).status, 401);
  await finish(await begin('google', a, 'returning-google'), a);
  assert.equal((await status(a)).id, signedInA.id);
  assert.deepEqual(await (await read(a, signedInA.id)).json(), { profile: { enabled: false, notes: ['edited'] } });
  assert.equal((await issue(platformPost(accountPath, { action: 'delete-account', confirm: 'DELETE' }, a.headers(signedInA.id)))).status, 200);
  assert.deepEqual(await db.query('select * from xyvora_memory where account_id=$1', [signedInA.id]), []);
  assert.equal((await status(b)).id, signedInB.id);
  await db.query('update xyvora_sessions set expires_ms=0 where account_id=$1', [signedInB.id]);
  assert.equal(await status(b), null);
});

test('verified email signup, password sign-in and reset use single-use links and revoke old sessions', async (t) => {
  const db = await platformFixture(t);
  const mail: { to: string; subject: string; text: string }[] = [];
  const config = accountConfig({ XYVORA_ACCOUNT_ORIGIN: origin, XYVORA_ENABLE_PASSWORDS: '1', XYVORA_AUTH_SECRET: 'fixture'.repeat(6) }, db, undefined, async (message) => { mail.push(message); })!;
  const jar = new CookieJar(), other = new CookieJar();
  const password = 'fixture-starting-password', replacement = 'fixture-replacement-password';
  const email = 'fixture@example.invalid';
  const issue = (request: Request) => handleAccount(request, config, { limit: false });
  const post = (action: string, fields: object = {}, cookies = jar) => issue(platformPost(accountPath, { action, ...fields }, cookies.headers()));
  const status = async (cookies = jar) => (await (await issue(new Request(endpoint, { headers: cookies.headers() }))).json());
  const sent = async (action: string, email: string) => {
    const response = await post(action, { email });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: true });
  };
  const link = (index: number, purpose: string) => {
    assert.equal(mail[index].to, email);
    return mail[index].text.match(new RegExp(`/\\#${purpose}=([\\w-]{43})`))![1];
  };
  assert.equal((await status()).passwords, true);
  await sent('request-reset', email);
  assert.deepEqual(mail, []);
  await sent('request-signup', 'Fixture@example.invalid');
  const verify = link(0, 'signup');
  assert.equal((await db.query('select * from xyvora_accounts')).length, 0);
  assert.doesNotMatch(JSON.stringify(await db.query('select * from xyvora_email_links')), new RegExp(verify));
  assert.equal((await post('verify-email', { token: verify, password: 'short' })).status, 400);
  assert.equal((await post('reset-password', { token: verify, password })).status, 400);
  const created = await post('verify-email', { token: verify, password });
  assert.equal(created.status, 200);
  assert.deepEqual(await created.json(), { signedIn: true });
  jar.update(created);
  assert.equal((await status()).user.email, email);
  assert.equal((await post('verify-email', { token: verify, password })).status, 400);
  await sent('request-signup', email);
  assert.equal(mail.length, 1);
  assert.equal((await post('login', { email, password: 'incorrect-password' })).status, 401);
  const login = await post('login', { email, password }, other);
  assert.equal(login.status, 200);
  other.update(login);
  assert.equal((await status(other)).user.id, (await status()).user.id);
  const [row] = await db.query('select * from xyvora_accounts');
  assert.match(String(row.password_hash), /^[0-9a-f]{36}:[0-9a-f]{128}$/);
  assert.doesNotMatch(JSON.stringify(row), /fixture-starting-password/);
  await sent('request-reset', email);
  const stale = link(1, 'reset');
  await db.query("update xyvora_email_links set expires_ms=0 where purpose='reset'");
  assert.equal((await post('reset-password', { token: stale, password: replacement })).status, 400);
  await sent('request-reset', email);
  const reset = link(2, 'reset');
  const attempts = await Promise.all([post('reset-password', { token: reset, password: replacement }), post('reset-password', { token: reset, password: replacement })]);
  assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 400]);
  assert.equal((await status()).user, null);
  assert.equal((await status(other)).user, null);
  assert.equal((await post('login', { email, password })).status, 401);
  assert.equal((await post('login', { email, password: replacement })).status, 200);
});

test('guest notes are opt-in, editable, disabled/cleared locally and never merged with account chat storage', async (t) => {
  const values = new Map<string, string>();
  const local = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  t.after(() => original ? Object.defineProperty(globalThis, 'localStorage', original) : Reflect.deleteProperty(globalThis, 'localStorage'));
  t.mock.method(globalThis, 'fetch', async () => assert.fail('guest memory must not reach an account provider'));
  const signal = new AbortController().signal;
  assert.deepEqual(loadGuestMemory(), emptyMemory());
  const profile = { enabled: true, notes: ['Use metric units.'] };
  await saveMemory(profile, undefined, signal);
  assert.deepEqual(loadGuestMemory(), profile);
  assert.deepEqual(memoryForSend(profile, false, false), profile.notes);
  assert.equal(memoryForSend(profile, true, false), undefined);
  assert.equal(memoryForSend(profile, false, true), undefined);
  const edited = { enabled: false, notes: ['Use imperial measurements.'] };
  await saveMemory(edited, undefined, signal);
  assert.deepEqual(loadGuestMemory(), edited);
  assert.equal(memoryForSend(edited, false, false), undefined);
  await saveMemory(emptyMemory(), undefined, signal);
  assert.equal(values.size, 0);
  const thread = (id: string): Thread => ({ id, title: `Local chat ${id}`, mode: 'chat', updatedAt: 0, turns: [] });
  assert.ok(storeThreads([thread('guest')]));
  assert.ok(storeThreads([thread('a')], ada.id));
  assert.ok(storeThreads([thread('b')], ben.id));
  assert.equal(loadThreads()[0].id, 'guest');
  assert.equal(loadThreads(ada.id)[0].id, 'a');
  assert.equal(loadThreads(ben.id)[0].id, 'b');
});

test('validated preference context is optional and does not override tool routing, search or translation', async () => {
  const notes = ['Use concise sentences.'];
  const data = (prompt: string, options: object = {}) => ({ messages: [{ role: 'user', content: prompt }], memory: notes, ...options });
  const ask = (input: object) => new Request(`${origin}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.deepEqual(parseMemory({ enabled: true, notes: [' Note ', 'Note', ''] }), { enabled: true, notes: ['Note'] });
  assert.equal(parseMemory({ enabled: 'yes', notes }), undefined);
  assert.equal(parseMemory({ enabled: true, notes: ['a\nb'] }), undefined);
  assert.equal(preferencesContext(notes, 1), '');
  assert.throws(() => parseChat(data('Reply', { memory: new Array(9).fill('x') })), /bounded memory/);
  const prompt = 'Explain recursion';
  const response = await handleChat(ask(data(prompt, { searchQuery: 'recursion' })), {
    search: async (query) => { assert.equal(query, 'recursion'); return [{ title: 'Recursion', url: 'https://en.wikipedia.org/wiki/Recursion', provider: 'wikipedia' }]; },
    generate: async (messages, _signal, text, evidence) => {
      assert.equal(messages.at(-1)?.content, prompt);
      assert.match(evidence.preferences ?? '', /untrusted reference notes.*Use concise sentences\./);
      text('A concise reply.');
    },
  });
  let result = '';
  await readChatEvents(response.body!, (text) => { result += text; });
  assert.equal(result, 'A concise reply.');
  const translated = await handleChat(ask(data('/translate Spanish: Good morning')), { generate: async (_, __, text, evidence) => {
    assert.equal(evidence.preferences, undefined); text('Buenos días.');
  } });
  await readChatEvents(translated.body!, () => {});
  const computed = await handleChat(ask(data('What is 20 * 6?')), { generate: async () => assert.fail('memory does not make a local skill call the model') });
  assert.equal(computed.headers.get('x-xyvora-source'), 'skill');
});
