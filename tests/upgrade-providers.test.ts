import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { accountConfig, handleAccount, hostedModelsFor } from '../server/account.ts';
import { handleChat } from '../server/chat.ts';
import { generateHosted, hostedConfigFrom, modelRouter } from '../server/hosted-models.ts';
import { researchWeb, WIBY_SEARCH_URL, WIKI_EXTRACT_URL, WIKI_SEARCH_URL } from '../server/web-search.ts';
import { parseFlowchart } from '../shared/flowchart.ts';
import type { ChatMessage } from '../shared/models.ts';
import { readChatEvents } from '../src/lib/stream.ts';
import { CookieJar, platformFixture, platformOrigin as origin, platformPost } from './platform-fixture.ts';

const env = { XYVORA_ACCOUNT_ORIGIN: origin, XYVORA_AUTH_SECRET: 'fixture-only-auth-secret-not-live'.repeat(2) };
const input: ChatMessage[] = [{ role: 'user', content: 'Explain a waterfall.' }];
const accountPath = '/api/account';
const response = (...events: (object | '[DONE]')[]) => new Response(events.map((event) => `data: ${event === '[DONE]' ? event : JSON.stringify(event)}\r\n\r\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
const modelsEnv = { ...env, XYVORA_ENABLE_HOSTED_MODELS: '1', XYVORA_OPENAI_KEY: 'fixture-openai-secret', XYVORA_OPENAI_MODEL: 'gpt-4.1-mini',
  XYVORA_ANTHROPIC_KEY: 'fixture-x-api-key', XYVORA_ANTHROPIC_MODEL: 'claude-test-model', XYVORA_GEMINI_KEY: 'fixture-goog-key', XYVORA_GEMINI_MODEL: 'gemini-test-model',
  XYVORA_COMPATIBLE_KEY: 'fixture-service-key', XYVORA_COMPATIBLE_MODEL: 'qwen/open-text', XYVORA_COMPATIBLE_URL: 'https://models.example.org/v1/chat/completions', XYVORA_HOSTED_PER_ACCOUNT: '2', XYVORA_HOSTED_PER_SITE: '2' };

test('hosted adapters serialize real provider protocols, bound SSE, and exclude transport failures from output', async () => {
  const config = hostedConfigFrom(modelsEnv)!;
  assert.equal(config.models.length, 4);
  assert.equal(hostedConfigFrom({ ...modelsEnv, XYVORA_ENABLE_HOSTED_MODELS: '0' }), undefined);
  assert.equal(hostedConfigFrom({ ...modelsEnv, XYVORA_COMPATIBLE_URL: 'https://127.0.0.1/chat/completions' })?.models.length, 3);
  assert.equal(hostedConfigFrom({ ...modelsEnv, XYVORA_COMPATIBLE_URL: 'https://models.example.org/chat/completions?token=bad' })?.models.length, 3);
  const signal = new AbortController().signal;
  for (const model of config.models) {
    let text = '';
    await generateHosted(model, input, signal, (delta) => { text += delta; }, { mode: 'pro', project: '\nProject context', sources: [{ title: 'Known evidence', url: 'https://example.org/', excerpt: 'Verified fixture.' }] }, async (url, init) => {
      assert.equal(url, model.url);
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.method, 'POST');
      const headers = new Headers(init?.headers), body = JSON.parse(String(init?.body));
      assert.match(JSON.stringify(body), /Project context/);
      assert.match(JSON.stringify(body), /Verified fixture/);
      assert.doesNotMatch(String(init?.body), /fixture-.*?-key/);
      switch (model.provider) {
        case 'anthropic':
          assert.equal(headers.get('x-api-key'), model.key); assert.equal(headers.get('anthropic-version'), '2023-06-01'); assert.equal(body.messages[0].role, 'user');
          return response({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Water' } }, { type: 'message_stop' });
        case 'gemini':
          assert.equal(headers.get('x-goog-api-key'), model.key); assert.equal(body.contents[0].role, 'user'); assert.equal(new URL(String(url)).searchParams.has('key'), false);
          return response({ candidates: [{ content: { parts: [{ text: 'not displayed', thought: true }, { text: 'Water' }] }, finishReason: 'STOP' }] });
        case 'compatible':
          assert.equal(body.max_tokens, 1_400); assert.equal(headers.get('authorization'), `Bearer ${model.key}`);
          return response({ choices: [{ delta: { content: 'Water' } }] }, { choices: [{ finish_reason: 'stop' }] });
        default:
          assert.equal(body.max_completion_tokens, 1_400); assert.equal(body.messages[0].role, 'system');
          return response({ choices: [{ delta: { content: 'Water' } }] }, '[DONE]');
      }
    });
    assert.equal(text, 'Water');
  }
  await assert.rejects(generateHosted(config.models[0], input, signal, () => {}, {}, async () => response({ choices: [{ delta: { content: 'Truncated' } }] })), /ended before/);
  await assert.rejects(generateHosted(config.models[0], input, signal, () => {}, {}, async () => new Response('private upstream headers', { status: 403 })), (error: unknown) => error instanceof Error && !error.message.includes('private upstream'));
});

test('Auto does not route an emitted answer, or private context, to another hosted provider after a failure', async (t) => {
  const config = hostedConfigFrom(modelsEnv)!;
  const attempts: string[] = [];
  let responseBody = new Response('', { status: 503 });
  t.mock.method(globalThis, 'fetch', async (url: string) => { attempts.push(url); return responseBody; });
  let fallback = 0;
  const route = modelRouter(config, 'auto', async () => true, async (_messages, _signal, write) => { fallback++; write('Local fallback.'); })!;
  let text = '', label: unknown;
  await route(input, new AbortController().signal, (delta) => { text += delta; }, { mode: 'creative' }, (value) => { label = value; });
  assert.equal(attempts.length, 1);
  assert.match(attempts[0], /anthropic/);
  assert.equal(fallback, 1);
  assert.equal(label, undefined);
  assert.match(text, /Local fallback/);
  responseBody = response({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Text sent.' } }, { type: 'error', error: { message: 'secret' } });
  await assert.rejects(route(input, new AbortController().signal, () => {}, { mode: 'creative' }, (value) => { label = value; }), /selected model couldn’t/);
  assert.equal(attempts.length, 2);
  assert.equal(fallback, 1);
  assert.equal((label as unknown as { provider: string }).provider, 'anthropic');
});

const supabaseRef = 'abcdefghijklmnopqrst', supabaseOrigin = `https://${supabaseRef}.supabase.co`;
const identityEnv = { ...modelsEnv, XYVORA_ENABLE_SUPABASE_AUTH: '1', XYVORA_SUPABASE_AUTH_URL: supabaseOrigin,
  XYVORA_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture_ABCDEFGHIJKLMNOP', XYVORA_SUPABASE_ADMIN_KEY: 'sb_secret_fixture_ABCDEFGHIJKLMNOP',
  XYVORA_SUPABASE_AUTH_PROVIDERS: 'google,github,invalid', XYVORA_SUPABASE_EMAIL_AUTH: '1' };

test('Supabase email and PKCE sessions, issuance, scoped deletion, and hosted budgets use verified private accounts', async (t) => {
  const db = await platformFixture(t);
  const config = accountConfig(identityEnv, db)!;
  const subject = randomUUID(), email = 'verified@example.invalid', pass = 'fixture-original-password';
  const legacy = randomUUID();
  await db.query(`insert into xyvora_accounts (id,provider,subject,name,email,created_ms) values ($1,'password',$2,'Existing',$2,0)`, [legacy, email]);
  let pw = pass, upstream = 0, deleteCalls = 0, pkceCode = '';
  const callbackCalls: string[] = [];
  const token = 'fixture-only-token-without-secrets';
  const profile = { id: subject, email, email_confirmed_at: '2026-01-05T00:00:00Z', user_metadata: { full_name: 'Fixture user' }, identities: [{ provider: 'google' }] };
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const url = new URL(input), headers = new Headers(init.headers), body = init.body ? JSON.parse(String(init.body)) : {};
    assert.equal(init.redirect, 'error');
    if (url.host === 'api.openai.com') {
      upstream++;
      assert.equal(headers.get('authorization'), 'Bearer fixture-openai-secret');
      return response({ choices: [{ delta: { content: 'Water moves downhill.' } }] }, '[DONE]');
    }
    assert.equal(url.origin, supabaseOrigin);
    const route = url.pathname.replace('/auth/v1', '');
    callbackCalls.push(route);
    if (route === `/admin/users/${subject}`) { deleteCalls++; assert.equal(init.method, 'DELETE'); assert.equal(headers.get('apikey'), identityEnv.XYVORA_SUPABASE_ADMIN_KEY); return new Response(null, { status: 204 }); }
    assert.equal(headers.get('apikey'), identityEnv.XYVORA_SUPABASE_PUBLISHABLE_KEY);
    if (route === '/signup') { assert.equal(body.email, email); assert.equal(body.password, pass); return Response.json({ id: subject }); }
    if (route === '/recover') { assert.equal(body.email, email); return Response.json({}); }
    if (route === '/verify') {
      if (body.email !== email || body.token !== '123456') return new Response('private validation', { status: 400 });
      assert.ok(['signup', 'recovery'].includes(body.type));
      return Response.json({ access_token: token });
    }
    if (route === '/token') {
      if (url.searchParams.get('grant_type') === 'pkce') { assert.equal(body.auth_code, pkceCode); assert.match(body.code_verifier, /^[\w-]{43}$/); return Response.json({ access_token: token }); }
      return body.email === email && body.password === pw ? Response.json({ access_token: token }) : new Response('private', { status: 400 });
    }
    assert.equal(headers.get('authorization'), `Bearer ${token}`);
    if (route === '/user' && init.method === 'PUT') { pw = body.password; return Response.json(profile); }
    if (route === '/user') return Response.json(profile);
    if (route === '/logout') { assert.ok(['local', 'global'].includes(url.searchParams.get('scope')!)); return new Response(null, { status: 204 }); }
    assert.fail(`Unexpected provider call ${route}`);
  });
  const handle = (request: Request) => handleAccount(request, config, { limit: false });
  const authPost = (operation: string, fields: object, headers: Record<string, string> = {}) => handle(platformPost(accountPath, { action: 'supabase-auth', operation, ...fields }, headers));
  const status = await (await handle(new Request(origin + accountPath))).json();
  assert.equal(status.user, null); assert.equal(status.hostedModels, undefined);
  assert.deepEqual(status.supabase, { origin: supabaseOrigin, providers: ['google', 'github'], passwords: true });
  assert.doesNotMatch(JSON.stringify(status), /sb_secret|fixture-only-auth/);
  assert.equal((await authPost('signup', { email, password: 'a'.repeat(73) })).status, 400);
  const signup = await authPost('signup', { email, password: pass });
  assert.equal(signup.status, 202); assert.equal(signup.headers.getSetCookie().length, 0);
  assert.equal((await authPost('confirm', { email, code: '999999' })).status, 401);
  const door = new CookieJar(), verified = await authPost('confirm', { email, code: '123456' });
  assert.equal(verified.status, 200);
  door.update(verified);
  const member = await (await handle(new Request(origin + accountPath, { headers: door.headers() }))).json();
  assert.notEqual(member.user.id, legacy, 'Matching verified addresses must not adopt prior private data');
  assert.deepEqual(member.hostedModels, hostedConfigFrom(modelsEnv)?.models.map(({ provider, model }) => ({ provider, model })));
  assert.doesNotMatch(JSON.stringify(member), /fixture-openai-secret/);
  const hosted = hostedModelsFor(config);
  const ask = (headers: Record<string, string>, model = 'openai') => handleChat(platformPost('/api/chat', { model, mode: 'pro', messages: input }, headers), { hosted });
  assert.equal((await ask({})).status, 401);
  assert.equal((await ask(door.headers(legacy))).status, 409);
  assert.equal((await ask({ ...door.headers(member.user.id), Origin: 'https://different.invalid' })).status, 403);
  for (let n = 0; n < 2; n++) {
    const streamed = await ask(door.headers(member.user.id));
    const labels: string[] = [], parts: string[] = [];
    await readChatEvents(streamed.body!, (part) => parts.push(part), true, undefined, ({ provider }) => labels.push(provider));
    assert.deepEqual(labels, ['openai']); assert.equal(parts.join(''), 'Water moves downhill.');
  }
  const limited = await ask(door.headers(member.user.id));
  await assert.rejects(readChatEvents(limited.body!, () => {}, true), /request budget/);
  assert.equal(upstream, 2);
  assert.equal((await authPost('recover', { email })).status, 202);
  assert.equal((await authPost('reset', { email, code: '123456', password: 'fixture-new-password' })).status, 200);
  assert.equal((await (await handle(new Request(origin + accountPath, { headers: door.headers() }))).json()).user, null);
  assert.equal((await authPost('login', { email, password: pass })).status, 401);
  const renewed = await authPost('login', { email, password: pw }); assert.equal(renewed.status, 200); door.update(renewed);
  const oauth = new CookieJar(), start = await authPost('start', { provider: 'google' }); oauth.update(start);
  const consent = new URL((await start.json()).url);
  assert.equal(consent.origin, supabaseOrigin); assert.equal(consent.pathname, '/auth/v1/authorize');
  assert.equal(consent.searchParams.get('redirect_to'), `${origin}/api/account?auth=supabase`);
  assert.match(consent.searchParams.get('code_challenge') ?? '', /^[A-Za-z0-9_-]{43}$/);
  pkceCode = 'fixture-pkce-code-1234';
  const redirect = (headers: Record<string, string>) => handle(new Request(`${origin}/api/account?auth=supabase&code=${pkceCode}`, { headers }));
  assert.equal((await redirect({})).headers.get('location'), '/?account=failed');
  const done = await redirect(oauth.headers()); assert.equal(done.headers.get('location'), '/?account=signed-in');
  assert.equal((await redirect(oauth.headers())).headers.get('location'), '/?account=failed', 'PKCE attempt is one-time');
  oauth.update(done);
  const deletion = await handle(platformPost(accountPath, { action: 'delete-account', confirm: 'DELETE', id: legacy }, oauth.headers(member.user.id)));
  assert.equal(deletion.status, 200); assert.equal(deleteCalls, 1);
  assert.equal((await db.query(`select id from xyvora_accounts where id=$1`, [legacy])).length, 1);
  assert.ok(callbackCalls.includes('/logout'));
});

test('a research brief uses genuine publisher extracts when present, not external result URL fetches', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const base = url.origin + url.pathname; calls.push(base);
    assert.equal(init?.redirect, 'error');
    if (base === WIKI_SEARCH_URL) return Response.json({ pages: [{ title: 'Waterfall', key: 'Waterfall', excerpt: 'Publisher index snippet.' }] });
    if (base === WIBY_SEARCH_URL) return Response.json([{ Title: 'Waterfall guide', URL: 'https://example.org/not-read', Snippet: 'A waterfall guide with waterfalls.' }]);
    assert.equal(base, WIKI_EXTRACT_URL);
    assert.equal(url.searchParams.get('titles'), 'Waterfall');
    return Response.json({ query: { pages: [ { title: 'A different page', extract: 'Do not attribute an extract if the article title does not match.'.repeat(3) },
      { title: 'Waterfall', extract: 'Waterfalls are formed where flowing water passes over a vertical drop or a series of steep drops.' } ] } });
  };
  const research = (query: string, signal: AbortSignal) => researchWeb(query, signal, fetcher);
  const req = platformPost('/api/chat', { messages: [{ role: 'user', content: '/research waterfall' }] });
  const res = await handleChat(req, { research, generate: async (_messages, _signal, write, evidence) => {
    assert.equal(evidence.report, true);
    assert.equal(evidence.sources?.[0].evidence, 'retrieved');
    assert.match(evidence.sources?.[0].excerpt ?? '', /vertical drop/);
    assert.equal(evidence.sources?.[1].evidence, undefined);
    write('Water can descend a vertical drop. [1]');
  } });
  assert.equal(res.status, 200);
  const bytes = await res.text();
  assert.match(bytes, /"evidence":"retrieved"/);
  assert.equal(calls.length, 3);
  assert.doesNotMatch(bytes, /Do not attribute/);
});

test('small flowcharts calculate ranks and unsupported Mermaid is not interpreted', () => {
  const graph = parseFlowchart('flowchart LR\nA[Start] --> B[Finish]\nA --> C[Pause]');
  assert.equal(graph?.direction, 'horizontal');
  assert.deepEqual(graph?.nodes.map(({ label, rank, slot }) => [label, rank, slot]), [['Start', 0, 0], ['Finish', 1, 0], ['Pause', 1, 1]]);
  assert.equal(parseFlowchart('graph TD\nA --> B\nB --> A'), undefined);
  assert.equal(parseFlowchart('graph TD\nA[Click]\nclick A "https://example.org"'), undefined);
});
