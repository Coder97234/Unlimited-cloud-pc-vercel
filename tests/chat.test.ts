import { MODE_IDS } from '../shared/modes.ts';
import assert from 'node:assert/strict';
import { ASSISTANT_PROFILE, DEFAULT_MODEL } from '../shared/models.ts';
import { SKILL_IDS } from '../shared/skill-catalog.ts';
import { test } from 'node:test';
import vercelChat from '../server/vercel-chat.ts';
import { checkUpdateLock, makeUpdateKey } from '../server/update-lock.ts';
import { handleChat, parseChat } from '../server/chat.ts';
import { InferenceError } from '../server/inference-stream.ts';
import { WIBY_SEARCH_URL, WIKI_SEARCH_URL, searchWeb } from '../server/web-search.ts';
import { buildMessages, loadThreads } from '../src/lib/history.ts';
import { readChatEvents } from '../src/lib/stream.ts';
import type { WebSource } from '../shared/search.ts';

const url = 'https://xyvora.invalid/api/chat';
const message = { role: 'user', content: 'What is recursion?' };
const body = { model: DEFAULT_MODEL, messages: [message] };
const source: WebSource = { title: 'Artemis', url: 'https://www.nasa.gov/humans-in-space/artemis/', excerpt: 'NASA’s Moon exploration program.' };
function request(input: unknown = body) {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}
async function collect(response: Response) {
  let text = '';
  const sources: WebSource[] = [];
  await readChatEvents(response.body!, (delta) => { text += delta; }, true, (found) => sources.push(...found));
  return { text, sources };
}

test('accepts the workspace model with bounded alternating user and assistant messages', () => {
  assert.deepEqual(parseChat(body), { messages: [message], timeZone: 'UTC', query: undefined, mode: 'normal' });
  for (const model of ['local', 'qwen', 'smollm', 'gpt-oss', 'mistral', 'toString', 'https://example.org']) {
    assert.throws(() => parseChat({ ...body, model }), /supported Xyvora model/);
  }
  assert.throws(() => parseChat({ ...body, messages: [{ role: 'system', content: 'hello' }] }), /roles/);
  assert.throws(() => parseChat({ ...body, messages: [message, message] }), /ending with a user/);
  assert.throws(() => parseChat({ ...body, messages: [{ role: 'user', content: 'a'.repeat(8_001) }] }), /too long/);
  assert.throws(() => parseChat({ ...body, timeZone: 'Planet/Mars' }), /IANA/);
  assert.throws(() => parseChat({ ...body, searchQuery: 'a'.repeat(351) }), /web search query/);
});

test('a missing backend never looks like successful inference', async () => {
  assert.equal((await (await handleChat(new Request(url))).json()).availability, 'unavailable');
  const reply = await handleChat(request());
  assert.equal(reply.status, 503);
  assert.equal((await reply.json()).code, 'MODEL_UNAVAILABLE');
});

test('Unlocked Vercel chat advertises only Xyvora identity, modes, and built-in tools, regardless of old Gateway headers', async (t) => {
  const previous = process.env.XYVORA_UPDATE_KEY;
  t.after(() => { if (previous === undefined) delete process.env.XYVORA_UPDATE_KEY; else process.env.XYVORA_UPDATE_KEY = previous; });
  const password = 'in-process-chat-fixture';
  process.env.XYVORA_UPDATE_KEY = await makeUpdateKey(password);
  const origin = new URL(url).origin;
  const pass = await checkUpdateLock(new Request(`${origin}/_xyvora/unlock`, {
    method: 'POST', headers: { Origin: origin }, body: new URLSearchParams({ password }),
  }), process.env, { deployed: true, limit: false });
  assert.equal(pass?.status, 303);
  const cookie = pass?.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  const reply = await vercelChat.fetch(new Request(url, { headers: { Cookie: cookie, 'x-vercel-oidc-token': 'mock-runtime-token' } }));
  assert.deepEqual(await reply.json(), { assistant: ASSISTANT_PROFILE, availability: 'server', models: [DEFAULT_MODEL], webSearch: true, modes: MODE_IDS, skills: SKILL_IDS });
  const invalid = request({ ...body, model: 'smollm' });
  invalid.headers.set('Cookie', cookie);
  assert.equal((await vercelChat.fetch(invalid)).status, 400);
});

test('development preview streams labeled samples and rejects live search', async () => {
  const reply = await handleChat(request(), { preview: true });
  assert.match(reply.headers.get('content-type') ?? '', /event-stream/);
  assert.equal(reply.headers.get('x-xyvora-source'), 'preview');
  assert.match((await collect(reply)).text, /Sample response.*nesting dolls/s);
  const search = await handleChat(request({ ...body, searchQuery: 'NASA' }), { preview: true });
  assert.equal(search.status, 503);
  assert.equal((await search.json()).code, 'SEARCH_UNAVAILABLE');
});

test('blocks oversized bodies before inference or search', async () => {
  const tooBig = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'a'.repeat(90_000) });
  assert.equal((await handleChat(tooBig)).status, 413);
});

test('stream parser handles split CRLF and multibyte frames, validating source metadata', async () => {
  const sources = JSON.stringify({ sources: [source, { title: 'Bad link', url: 'javascript:alert(1)' }] });
  const bytes = new TextEncoder().encode(`data: ${sources}\r\n\r\ndata: {"choices":[{"delta":{"reasoning_content":"not the answer","content":"héllo"}}]}\r\n\r\ndata: [DONE]\r\n\r\n`);
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2));
    controller.close();
  } });
  assert.deepEqual(await collect(new Response(stream)), { text: 'héllo', sources: [source] });
});

test('streams native reply text immediately and does not search on normal prompts', async () => {
  let finish!: () => void;
  const completion = new Promise<void>((resolve) => { finish = resolve; });
  const response = await handleChat(request(), {
    search: async () => assert.fail('an ordinary prompt must not be sent to the web'),
    generate: async (messages, _signal, onText, evidence) => {
      assert.deepEqual(messages, [message]);
      assert.equal(evidence.sources, undefined);
      onText('First part.');
      await completion;
      onText(' Then more.');
    },
  });
  assert.equal(response.headers.get('x-xyvora-source'), 'server');
  let text = '';
  await readChatEvents(response.body!, (delta) => { text += delta; finish(); });
  assert.equal(text, 'First part. Then more.');
});

test('answers time, dates and named zones without inference or web search', async () => {
  const now = () => new Date('2026-11-18T23:35:00Z');
  for (const [content, expected] of [
    ['What time is it?', /5:35 PM CST.*America\/Chicago/],
    ['/time Tokyo', /8:35 AM GMT\+9.*Asia\/Tokyo/],
    ['What time is it in Tokyo right now?', /8:35 AM GMT\+9.*Thursday, November 19, 2026.*Asia\/Tokyo/],
    ['What’s today’s date?', /Wednesday, November 18, 2026/],
    ['What is my time zone?', /America\/Chicago/],
    ['whats the time rn?', /5:35 PM CST/],
    ['Tell me today’s date, please.', /Wednesday, November 18, 2026/],
    ['What year is it?', /2026.*America\/Chicago/],
    ['What time is it in Atlantis?', /couldn’t match.*time zone/],
  ] as const) {
    const response = await handleChat(request({ ...body, timeZone: 'America/Chicago', messages: [{ role: 'user', content }] }), {
      now, search: async () => assert.fail('clock does not use search'), generate: async () => assert.fail('clock does not use token generation'),
    });
    assert.equal(response.headers.get('x-xyvora-source'), 'clock');
    assert.match((await collect(response)).text, expected);
  }
});

test('search uses just the explicit latest query; it emits numbered sources before generation', async () => {
  const messages = [message, { role: 'assistant', content: 'Private history' }, { role: 'user', content: '/search NASA Artemis\n\nAttached text file (private.txt):\nprivate attachment' }];
  let received = false;
  let release!: () => void;
  const sent = new Promise<void>((resolve) => { release = resolve; });
  const response = await handleChat(request({ ...body, messages }), {
    search: async (query) => { assert.equal(query, 'NASA Artemis'); return [source]; },
    generate: async (receivedMessages, _signal, onText, evidence) => {
      assert.deepEqual(evidence.sources, [source]);
      assert.deepEqual(receivedMessages, messages);
      await sent;
      onText('Artemis explores the Moon [1].');
    },
  });
  let text = '';
  await readChatEvents(response.body!, (delta) => { assert.ok(received); text += delta; }, true, (sources) => {
    assert.deepEqual(sources, [{ title: source.title, url: source.url }]); received = true; release();
  });
  assert.match(text, /Moon \[1\]/);
});

test('empty or failed web search never passes unsupported facts to the model', async () => {
  const input = { ...body, searchQuery: 'No such results' };
  const generate = async () => assert.fail('no evidence supplied');
  const none = await handleChat(request(input), { generate, search: async () => [] });
  assert.match((await collect(none)).text, /couldn’t find relevant web results/);
  const failed = await handleChat(request(input), { generate, search: async () => { throw new InferenceError('Web search is unavailable.'); } });
  await assert.rejects(collect(failed), /Web search is unavailable/);
});

test('live search providers receive only query keywords and return validated source records', async () => {
  const called: string[] = [];
  const result = await searchWeb('What is NASA’s Artemis program?', new AbortController().signal, async (input, init) => {
    assert.ok(input instanceof URL);
    assert.equal(init?.redirect, 'error');
    assert.equal(input.searchParams.get('q'), 'nasa artemis program');
    assert.ok(new Headers(init?.headers).get('User-Agent')?.startsWith('Xyvora/'));
    const base = input.origin + input.pathname;
    called.push(base);
    if (base === WIKI_SEARCH_URL) {
      assert.equal(input.searchParams.get('limit'), '3');
      return Response.json({ pages: [{ title: '<mark>Artemis</mark>', key: 'Artemis_program', excerpt: source.excerpt }] });
    }
    assert.equal(base, WIBY_SEARCH_URL);
    return Response.json([
      { Title: 'Unrelated', URL: 'https://example.org/unrelated', Snippet: 'Something else' },
      { Title: source.title, URL: source.url, Snippet: 'NASA’s Artemis program will explore the Moon' },
      { Title: 'duplicate', URL: `${source.url}#duplicate`, Snippet: 'NASA Artemis' },
      { Title: 'invalid', URL: 'data:text/html,abc', Snippet: 'NASA Artemis' },
    ]);
  });
  assert.deepEqual(called.sort(), [WIBY_SEARCH_URL, WIKI_SEARCH_URL].sort());
  assert.deepEqual(result, [
    { title: 'Artemis', url: 'https://en.wikipedia.org/wiki/Artemis_program', excerpt: source.excerpt, provider: 'wikipedia' },
    { ...source, excerpt: 'NASA’s Artemis program will explore the Moon', provider: 'wiby' },
  ]);
});

test('handles partial provider failure, and rejects an oversized streamed provider result', async () => {
  const signal = new AbortController().signal;
  const partial = await searchWeb('NASA Artemis', signal, async (url) => String(url).startsWith(WIBY_SEARCH_URL)
    ? new Response('Bad JSON')
    : Response.json({ pages: [{ title: 'Artemis', key: 'Artemis_program', excerpt: source.excerpt }] }));
  assert.equal(partial[0]?.provider, 'wikipedia');
  await assert.rejects(searchWeb('NASA', signal, async () => new Response(' '.repeat(65_000) + '[]')), /search is unavailable/);
});

test('inference errors and empty streams do not claim successful completion', async () => {
  for (const generate of [
    async () => { throw new InferenceError('The server is warming up.'); },
    async () => { throw new Error('internal details'); },
    async () => {},
  ]) {
    const response = await handleChat(request(), { generate });
    const [parsed, raw] = response.body!.tee();
    const [data] = await Promise.all([new Response(raw).text(), assert.rejects(collect(new Response(parsed)), /server|empty reply/)]);
    assert.ok(!data.includes('[DONE]'));
    assert.ok(!data.includes('internal details'));
  }
});

test('canceling a stream aborts generation and external lookup', async () => {
  for (const useSearch of [false, true]) {
    let observed = false;
    const wait = (signal: AbortSignal) => new Promise<void>((resolve) => signal.addEventListener('abort', () => { observed = true; resolve(); }, { once: true }));
    const response = await handleChat(request({ ...body, searchQuery: useSearch ? 'NASA' : undefined }), {
      generate: async (_messages, signal) => { if (useSearch) assert.fail('search was canceled'); else await wait(signal); },
      search: async (_query, signal) => { await wait(signal); signal.throwIfAborted(); return []; },
    });
    await response.body!.cancel();
    assert.ok(observed);
  }
});

test('retains older replies but sends only completed chat context to new requests', (t) => {
  const previous = [
    { id: 'q', prompt: 'Hello', answers: [{ model: 'qwen-lite', source: 'server', state: 'finished', content: 'Hi there!' }] },
    { id: 's', prompt: 'Earlier question', answers: [{ model: 'smollm', source: 'legacy', state: 'finished', content: 'An archived reply' }] },
  ];
  const raw = [{ id: 'legacy', title: 'Old chat', mode: 'compare', turns: [...previous, { id: '1', prompt: 'Previously private', answers: [{ model: 'local', source: 'on-device', state: 'finished', content: 'A retained reply' }] }] }];
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => JSON.stringify(raw) } });
  t.after(() => { if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else Reflect.deleteProperty(globalThis, 'localStorage'); });
  const [thread] = loadThreads();
  assert.equal(thread.mode, 'compare');
  assert.equal(thread.turns[1].answers[0].model, 'smollm');
  assert.equal(thread.turns[2].answers[0].source, 'legacy');
  assert.deepEqual(buildMessages(thread.turns, { prompt: 'Next question' }), [
    { role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi there!' }, { role: 'user', content: 'Next question' },
  ]);
});


test('a finish reason without the completion sentinel does not confirm a stream', async () => {
  const body = new Response('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"stop"}]}\n\n').body!;
  await assert.rejects(readChatEvents(body, () => {}), /before the reply finished/);
});
