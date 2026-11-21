import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { DEFAULT_MODE, MODE_IDS } from '../shared/modes.ts';
import { DEFAULT_MODEL, MAX_ATTACHMENT, MAX_CONTEXT, withAttachment } from '../shared/models.ts';
import { publicApiTarget, PUBLIC_API_EXAMPLE, WORKSPACE_PLUGINS_ENABLED, workspaceIntent } from '../shared/workspace-tools.ts';
import { runInstantSkill } from '../shared/skills.ts';
import { handleChat, parseChat } from '../server/chat.ts';
import { RESPONSE_PROFILES } from '../server/mode-settings.ts';
import { handleWorkspace, handleWorkspaceTools } from '../server/workspace.ts';
import { workspaceConfig } from '../server/workspace-connections.ts';
import { executeScript } from '../src/lib/sandbox-engine.ts';
import { combineFiles, readLocalFile } from '../src/lib/files.ts';
import { readChatEvents } from '../src/lib/stream.ts';

const origin = 'https://test.xyvora.invalid';
const endpoint = `${origin}/api/workspace`;
const env = { XYVORA_WORKSPACE_ORIGIN: origin };
const connectedEnv = { ...env, XYVORA_CONNECT_SECRET: 'test-session-secret-for-workspace-testing-only',
  XYVORA_GMAIL_PLUGIN_ENABLED: '1', XYVORA_GMAIL_CLIENT_ID: 'gmail-fixture', XYVORA_GMAIL_CLIENT_SECRET: 'gmail-secret-fixture',
  XYVORA_VERCEL_PLUGIN_ENABLED: '1', XYVORA_VERCEL_CLIENT_ID: 'vercel-fixture', XYVORA_VERCEL_CLIENT_SECRET: 'vercel-secret-fixture' };
const post = (input: object, options: { headers?: Record<string, string>; url?: string } = {}) => new Request(options.url ?? endpoint, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...options.headers }, body: JSON.stringify(input),
});
const call = (input: object, opts?: Parameters<typeof post>[1]) => handleWorkspaceTools(post(input, opts), workspaceConfig(env), { limit: false });
const chat = (text: string, mode?: string, attachment?: object, model = DEFAULT_MODEL) => new Request(`${origin}/api/chat`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, mode, messages: [{ role: 'user', content: text }], attachment }),
});
async function textOf(response: Response) {
  let text = '';
  await readChatEvents(response.body!, (delta) => { text += delta; }, true);
  return text;
}

test('Normal is the default; modes select distinct generation profiles without releasing engine branding', async () => {
  const data = { messages: [{ role: 'user', content: 'Help me plan a study session' }] };
  assert.equal(parseChat(data).mode, DEFAULT_MODE);
  assert.equal(parseChat({ ...data, model: 'qwen-lite' }).mode, DEFAULT_MODE);
  assert.equal(new Set(Object.values(RESPONSE_PROFILES).map((profile) => profile.instruction)).size, MODE_IDS.length);
  for (const mode of MODE_IDS) {
    const response = await handleChat(chat('Write a polite note', mode), { generate: async (_, __, text, evidence) => {
      assert.equal(evidence.mode, mode);
      text('First word. Q'); text('w'); text('e'); text('n starts here.');
    } });
    assert.equal(await textOf(response), 'First word. the chat engine starts here.');
  }
  assert.equal((await handleChat(chat('Hello', '__proto__'))).status, 400);
  const reply = await handleChat(chat('What time is it in Tokyo?', 'pro'), { generate: async () => assert.fail('clock must not invoke text generation') });
  assert.equal(reply.headers.get('x-xyvora-source'), 'clock');
  assert.match(await textOf(reply), /Asia\/Tokyo/);
});

test('translation is an explicit task even in Creative and does not pull live clock context from the source text', async () => {
  const response = await handleChat(chat('/translate Spanish: That is today’s date.', 'creative'), { generate: async (messages, _, text, evidence) => {
    assert.equal(evidence.mode, 'creative');
    assert.equal(evidence.task, 'translate');
    assert.equal(evidence.clock, undefined);
    assert.match(messages.at(-1)!.content, /only the translation in Spanish.*today’s date/s);
    text('Esa es la fecha de hoy.');
  } });
  assert.equal(await textOf(response), 'Esa es la fecha de hoy.');
});

test('the released workspace route rejects all plugin traffic before reading credentials or contacting providers', { skip: WORKSPACE_PLUGINS_ENABLED }, async (t) => {
  const outbound = t.mock.method(globalThis, 'fetch', async () => assert.fail('paused plugins must not call providers'));
  const config = workspaceConfig({ ...connectedEnv, XYVORA_IMAGE_API_KEY: 'studio-fixture-key',
    XYVORA_IMAGE_ACCESS_CODE: 'fixture-only-approval-code', XYVORA_ENABLE_VISION: '1' });
  const requests = [
    new Request(endpoint),
    new Request(`${endpoint}?code=old-code&state=old-state`, { headers: { Cookie: 'legacy-connection=fixture' } }),
    post({ approved: true, action: 'connect', provider: 'gmail' }),
    post({ approved: true, action: 'account', provider: 'vercel', operation: 'projects' }),
    post({ approved: true, action: 'disconnect', provider: 'vercel' }),
    post({ approved: true, action: 'api', method: 'GET', target: PUBLIC_API_EXAMPLE }),
    post({ approved: true, action: 'repository', operation: 'overview', repo: 'octocat/Hello-World' }),
    post({ approved: true, action: 'image', prompt: 'A fixture image' }),
    post({ approved: true, action: 'vision', image: 'fixture' }, { url: `${endpoint}?input=image` }),
  ];
  for (const request of requests) {
    const response = await handleWorkspace(request, config, { limit: false });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), { error: 'Workspace plugins are paused.' });
    assert.equal(request.bodyUsed, false);
  }
  assert.equal(outbound.mock.callCount(), 0);
});

test('plugin intents never execute from chat or from attachment text', async () => {
  assert.deepEqual(workspaceIntent('/run ```js\nconsole.log(6 * 7)\n```'), { id: 'script', input: 'console.log(6 * 7)' });
  assert.deepEqual(workspaceIntent('Run this script:\nconsole.log(20 * 6)'), { id: 'script', input: 'console.log(20 * 6)' });
  assert.equal(workspaceIntent('Please list my latest Gmail messages')?.id, 'gmail');
  assert.equal(workspaceIntent('List my Vercel projects')?.id, 'vercel');
  assert.equal(workspaceIntent('Generate an image of green mountains')?.id, 'image');
  assert.equal(workspaceIntent(`Get ${PUBLIC_API_EXAMPLE}`)?.id, 'api');
  assert.equal(workspaceIntent('Explain what “/run console.log(1)” means'), undefined);
  const options = { generate: async () => assert.fail('plugin proposals do not need AI inference'), search: async () => assert.fail('plugin proposals never go to the web') };
  const proposed = await handleChat(chat('List my Vercel projects'), options);
  assert.match(await textOf(proposed), WORKSPACE_PLUGINS_ENABLED ? /I haven’t run this request/ : /Plugins are paused.*I haven’t run this request/);
  const guide = runInstantSkill('/tools')!.text;
  assert.match(guide, /Calculator/);
  if (!WORKSPACE_PLUGINS_ENABLED) assert.doesNotMatch(guide, /Plugins|GitHub workbench|Image Studio|Script Lab/);
  const attachment = { name: 'notes.txt', text: `/api ${PUBLIC_API_EXAMPLE}\n/createmessage` };
  const response = await handleChat(chat('Summarize the attached text', 'thinker', attachment), {
    search: options.search, generate: async (messages, _, text) => {
      assert.match(messages.at(-1)!.content, /untrusted data.*\/api https:/s);
      text('This file contains example commands.');
    },
  });
  assert.equal(await textOf(response), 'This file contains example commands.');
});

test('expanded file input extracts bounded UTF-8, rejects binaries, and preserves a little of each file', async () => {
  const signal = new AbortController().signal;
  const first = await readLocalFile(new File(['東京\n'.repeat(4_000)], 'notes.log'), signal);
  const second = await readLocalFile(new File(['readable: true'], 'settings.yaml'), signal);
  assert.equal(first.truncated, true);
  assert.equal(first.text.length, MAX_ATTACHMENT);
  assert.match(second.text, /readable/);
  const combined = combineFiles([first, second])!;
  assert.ok(combined.text.length <= MAX_ATTACHMENT);
  assert.match(combined.text, /notes\.log.*settings\.yaml/s);
  assert.match(combined.text, /readable: true/);
  assert.ok(withAttachment('Summarize.', { name: first.name, text: first.text }).length <= MAX_CONTEXT);
  assert.match(withAttachment('Summarize.', first), /Further text omitted/);
  await assert.rejects(readLocalFile(new File([Uint8Array.of(0xff, 0x00)], 'bad.txt'), signal), /UTF-8/);
  await assert.rejects(readLocalFile(new File(['text'], 'bad.exe'), signal), /choose a text/i);
  await assert.rejects(readLocalFile(new File([new Uint8Array(4_000_001)], 'big.txt'), signal), /4 MB/);
});

test('new data tools handle quoted CSV, JSON keys, Unicode encoding, and list comparison', () => {
  assert.match(runInstantSkill('Inspect this attached CSV', 'name,value\r\n"one, two",3\r\n"line\nbreak",4')!.text, /2 data rows · 2 columns/);
  assert.match(runInstantSkill('/csv a,b\n"unfinished')!.text, /couldn’t parse/);
  assert.match(runInstantSkill('/jsonpick /a~1b {"a/b":42}')!.text, /42/);
  assert.match(runInstantSkill('/jsonpick /constructor {"a":42}')!.text, /No value/);
  assert.match(runInstantSkill('/base64 decode 5p2x5Lqs')!.text, /東京/);
  assert.match(runInstantSkill('/url encode hello! world')!.text, /hello!%20world/);
  assert.match(runInstantSkill('/comparelists\na\nb\nb\n---\nb\nc')!.text, /Shared:\*\* 1.*Only first:\*\* 1.*Only second:\*\* 1/);
});

test('Script Lab has no host APIs, applies deadlines and receives only caller-supplied text', async () => {
  assert.deepEqual(await executeScript('console.log(JSON.parse(input).count * 2)', '{"count":21}'), { ok: true, output: '42' });
  assert.deepEqual(await executeScript('console.log(typeof fetch, typeof document, typeof localStorage, typeof process, typeof require, typeof postMessage)'),
    { ok: true, output: 'undefined undefined undefined undefined undefined undefined' });
  assert.match((await executeScript('while (true) {}')).output, /time limit/);
  assert.match((await executeScript('console.log("x".repeat(6500))')).output, /truncated/);
  assert.equal((await executeScript('a'.repeat(8_001))).ok, false);
});

test('API Explorer denies cross-origin calls, writes and unregistered targets before fetch', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('rejected requests must not touch a provider'));
  const api = { approved: true, action: 'api', method: 'GET', target: PUBLIC_API_EXAMPLE };
  for (const target of ['http://api.github.com/repos/org/name', 'https://api.github.com:443/repos/org/name', 'https://api.github.com@other.invalid/repos/org/name',
    'https://api.github.com/repos/org/..', 'https://api.github.com/repos/org/name/contents', 'https://api.github.com/repos/org/name?secret=abc', 'https://api.github.com/repos/org/%2e%2e',
    'https://127.0.0.1/api', 'https://api.github.com/repos/org/name#tip']) {
    assert.equal(publicApiTarget(target), undefined);
    assert.equal((await call({ ...api, target })).status, 400);
  }
  assert.equal((await call({ ...api, approved: false })).status, 403);
  assert.equal((await call({ ...api, method: 'POST' })).status, 400);
  assert.equal((await call(api, { headers: { Origin: 'https://different.invalid' } })).status, 403);
  assert.equal((await call(api, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await call({ ...api, target: 'x'.repeat(14_000) })).status, 413);
  assert.equal((await call({ approved: true, action: 'connect', provider: 'gmail' })).status, 503);
  assert.equal((await call({ approved: true, action: 'account', provider: 'vercel', operation: 'projects' })).status, 401);
  assert.equal((await call({ approved: true, action: 'image', prompt: 'A purple sky' })).status, 503);
});

test('API Explorer rebuilds the registered GET, selects public fields, and bounds the result', async (t) => {
  let mode: 'ok' | 'large' | 'redirect' = 'ok';
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, PUBLIC_API_EXAMPLE);
    assert.equal(options.redirect, 'error');
    assert.equal(new Headers(options.headers).has('Authorization'), false);
    if (mode === 'large') return Response.json({ extra: 'x'.repeat(130_000) });
    if (mode === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://different.invalid/' } });
    return Response.json({ full_name: 'octocat/Hello-World', stargazers_count: 8, description: 'Hello world', private_badge: 'not forwarded' });
  });
  const api = { approved: true, action: 'api', method: 'GET', target: PUBLIC_API_EXAMPLE, attachment: 'not forwarded' };
  const reply = await call(api);
  assert.equal(reply.headers.get('cache-control'), 'no-store');
  const result = await reply.json();
  assert.equal(result.data.name, 'octocat/Hello-World');
  assert.equal(result.data.stars, 8);
  assert.doesNotMatch(JSON.stringify(result), /not forwarded/);
  mode = 'large';
  assert.equal((await call(api)).status, 413);
  mode = 'redirect';
  assert.equal((await call(api)).status, 502);
  assert.equal(fetchMock.mock.callCount(), 3);
});

test('OAuth binds consent to provider state and PKCE, encrypts sessions, and reads only approved fields', async (t) => {
  const config = workspaceConfig(connectedEnv);
  const issue = (request: Request) => handleWorkspaceTools(request, config, { limit: false });
  let pkce = '', token = '';
  let projectsMode = 200;
  const calls = t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    const path = new URL(url);
    const headers = new Headers(options.headers);
    const body = options.body;
    assert.equal(options.redirect, 'error');
    if (url === 'https://oauth2.googleapis.com/token' || url === 'https://api.vercel.com/login/oauth/token') {
      assert.equal(options.method, 'POST');
      assert.ok(body instanceof URLSearchParams);
      assert.equal(body.get('redirect_uri'), endpoint);
      assert.equal(body.get('code'), 'fixture-code');
      assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), pkce);
      return Response.json({ access_token: token, expires_in: 86_400, refresh_token: 'discarded-refresh-fixture' });
    }
    if (path.pathname.endsWith('/messages')) {
      assert.equal(headers.get('Authorization'), `Bearer ${token}`);
      assert.equal(path.searchParams.get('labelIds'), 'INBOX');
      assert.equal(path.searchParams.get('maxResults'), '5');
      return Response.json({ messages: [{ id: 'abc' }, { id: 'deleted-in-the-meantime' }, { id: '../ignored' }] });
    }
    if (path.pathname.endsWith('/messages/deleted-in-the-meantime')) return Response.json({ error: 'gone' }, { status: 404 });
    if (path.pathname.endsWith('/messages/abc')) {
      assert.equal(path.searchParams.get('format'), 'metadata');
      return Response.json({ payload: { headers: [{ name: 'Subject', value: 'Fixture\nSubject' }, { name: 'From', value: 'example@example.invalid' }], body: { data: 'not forwarded' } } });
    }
    if (path.pathname === '/login/oauth/userinfo') {
      assert.equal(headers.get('Authorization'), `Bearer ${token}`);
      return Response.json({ name: 'Fixture user', preferred_username: 'fixture', email: 'not forwarded' });
    }
    if (path.pathname === '/v10/projects') {
      assert.equal(headers.get('Authorization'), `Bearer ${token}`);
      assert.equal(path.searchParams.get('limit'), '8');
      assert.equal(path.searchParams.get('slug'), 'test-team');
      if (projectsMode !== 200) return Response.json({ detail: 'not forwarded' }, { status: projectsMode });
      return Response.json({ projects: [{ name: 'fixture-project', framework: 'vite', env: 'not forwarded' }] });
    }
    if (path.pathname.endsWith('/revoke')) {
      assert.ok(body instanceof URLSearchParams);
      assert.equal(body.get('token'), token);
      return new Response(null, { status: 200 });
    }
    assert.fail('Unexpected provider call');
  });
  for (const provider of ['gmail', 'vercel'] as const) {
    token = `${provider}-access-token-fixture`;
    const approvals = { approved: true, provider };
    const start = await issue(post({ ...approvals, action: 'connect' }));
    const { url } = await start.json();
    assert.equal(start.status, 200);
    const authorize = new URL(url);
    assert.equal(authorize.origin, provider === 'gmail' ? 'https://accounts.google.com' : 'https://vercel.com');
    assert.equal(authorize.searchParams.get('scope'), provider === 'gmail' ? 'https://www.googleapis.com/auth/gmail.metadata' : 'openid profile');
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorize.searchParams.get('redirect_uri'), endpoint);
    pkce = authorize.searchParams.get('code_challenge')!;
    const cookie = start.headers.getSetCookie()[0];
    assert.match(cookie, /__Host-.*HttpOnly; Secure; SameSite=Lax; Max-Age=600/);
    const correctState = authorize.searchParams.get('state');
    const callback = (state = correctState, nextCookie = cookie.split(';')[0]) => new Request(`${endpoint}?state=${state}&code=fixture-code`, { headers: { Cookie: nextCookie } });
    const before = calls.mock.callCount();
    assert.equal((await issue(callback('x'.repeat(43)))).status, 400);
    assert.equal((await issue(callback(correctState, ''))).status, 400);
    assert.equal(calls.mock.callCount(), before);
    const finish = await issue(callback());
    assert.equal(finish.status, 303);
    assert.equal(finish.headers.get('location'), `${origin}/?connection=${provider}-connected`);
    const cookies = finish.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.doesNotMatch(cookies.join(' '), /access-token-fixture|refresh-fixture/);
    assert.match(cookies[1], /HttpOnly; Secure; SameSite=Lax; Max-Age=3600/);
    const session = cookies[1].split(';')[0];
    const headers = { Cookie: session };
    const status = async (cookie: string) => (await (await issue(new Request(endpoint, { headers: { Cookie: cookie } }))).json()).connections[provider];
    assert.equal(await status(''), 'disconnected');
    assert.equal(await status(session), 'connected');
    const [name, value] = session.split('=');
    assert.equal(await status(`${name}=${value[0] === 'x' ? 'y' : 'x'}${value.slice(1)}`), 'disconnected');
    const operation = provider === 'gmail' ? 'inbox' : 'profile';
    const noApproval = await issue(post({ action: 'account', provider, operation }, { headers }));
    assert.equal(noApproval.status, 403);
    const read = await issue(post({ ...approvals, action: 'account', operation }, { headers }));
    assert.equal(read.status, 200);
    const data = await read.text();
    assert.match(data, /Fixture (?:Subject|user)/);
    assert.doesNotMatch(data, /not forwarded/);
    if (provider === 'vercel') {
      const projects = (teamSlug: string) => issue(post({ ...approvals, action: 'account', operation: 'projects', teamSlug }, { headers }));
      const count = calls.mock.callCount();
      assert.equal((await projects('https://untrusted.invalid')).status, 400);
      assert.equal(calls.mock.callCount(), count);
      assert.deepEqual(await (await projects('test-team')).json(), { projects: [{ name: 'fixture-project', framework: 'vite' }] });
      projectsMode = 403;
      const denied = await projects('test-team');
      assert.equal(denied.status, 403);
      assert.match((await denied.json()).error, /read access/);
      projectsMode = 401;
      const expired = await projects('test-team');
      assert.equal(expired.status, 401);
      assert.match((await expired.json()).error, /expired or was revoked/);
      assert.match(expired.headers.getSetCookie()[0], /__Host-xyvora-vercel=;.*Max-Age=0/);
    }
    assert.equal((await issue(post({ ...approvals, action: 'account', operation: 'write' }, { headers }))).status, 400);
    const disconnected = await issue(post({ ...approvals, action: 'disconnect' }, { headers }));
    assert.deepEqual(await disconnected.json(), { disconnected: true, revoked: true });
    assert.ok(disconnected.headers.getSetCookie().every((value) => value.includes('Max-Age=0')));
  }
});

test('hosted images require separate configuration and an access code; only the approved prompt is sent', async (t) => {
  const accessCode = 'test-code-for-fixture-use-only';
  const config = workspaceConfig({ ...env, XYVORA_IMAGE_API_KEY: 'studio-fixture-key', XYVORA_IMAGE_ACCESS_CODE: accessCode });
  const provider = t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer studio-fixture-key');
    assert.equal(options.redirect, 'error');
    assert.equal(typeof options.body, 'string');
    const data = JSON.parse(options.body as string);
    assert.equal(data.prompt, 'A soft violet landscape');
    assert.equal(data.n, 1);
    assert.equal(Object.hasOwn(data, 'accessCode'), false);
    return Response.json({ data: [{ b64_json: '/9j/AAAAAAAAAAAAAA==' }] });
  });
  const payload = { action: 'image', approved: true, prompt: 'A soft violet landscape', attachment: 'not sent' };
  const issue = (body: object) => handleWorkspaceTools(post(body), config, { limit: false });
  assert.equal((await issue(payload)).status, 403);
  assert.equal((await issue({ ...payload, accessCode, approved: false })).status, 403);
  assert.equal(provider.mock.callCount(), 0);
  const result = await issue({ ...payload, accessCode });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { mime: 'image/jpeg', image: '/9j/AAAAAAAAAAAAAA==', size: '1024x1024' });
});


test('private plugins are off by default even if client credentials are present', () => {
  const base = workspaceConfig({ XYVORA_GMAIL_CLIENT_ID: 'fixture', XYVORA_GMAIL_CLIENT_SECRET: 'fixture', XYVORA_CONNECT_SECRET: 't'.repeat(40) });
  assert.deepEqual(base.clients, {});
  const on = workspaceConfig({ XYVORA_GMAIL_PLUGIN_ENABLED: '1', XYVORA_GMAIL_CLIENT_ID: 'fixture', XYVORA_GMAIL_CLIENT_SECRET: 'fixture', XYVORA_CONNECT_SECRET: 't'.repeat(40) });
  assert.ok(on.clients.gmail);
});


test('invalid provider origin disables only credentialed plugins', async () => {
  const config = workspaceConfig({ ...connectedEnv, XYVORA_WORKSPACE_ORIGIN: 'https://example.invalid/path',
    XYVORA_IMAGE_API_KEY: 'fixture', XYVORA_IMAGE_ACCESS_CODE: 's'.repeat(28) });
  assert.deepEqual(config.clients, {});
  assert.equal(config.image, undefined);
  const response = await handleWorkspaceTools(new Request(endpoint), config, { limit: false });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { connections: { gmail: 'unconfigured', vercel: 'unconfigured' }, hostedImages: false, hostedVision: false });
});
