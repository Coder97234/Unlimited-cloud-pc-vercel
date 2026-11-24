import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_EFFORT, EFFORT_IDS, EFFORTS, rankedModels } from '../shared/experience.ts';
import type { Effort } from '../shared/experience.ts';
import { parsePreferences } from '../shared/preferences.ts';
import { automaticSearchQuery } from '../shared/search.ts';
import { handleChat, parseChat } from '../server/chat.ts';
import { generateHosted, hostedConfigFrom, modelRouter } from '../server/hosted-models.ts';
import type { ModelRequest } from '../server/hosted-models.ts';
import { searxngSearch } from '../server/searxng.ts';
import { readChatEvents } from '../src/lib/stream.ts';
import { matchingVoices, speechChunks } from '../src/lib/use-voice.ts';

const signal = new AbortController().signal;
const messages = [{ role: 'user' as const, content: 'Explain tides.' }];
const post = (text: string, fields: object = {}) => new Request('https://xyvora.example.com/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: text }], ...fields }),
});
const sse = (...data: (object | string)[]) => new Response(data.map((row) => `data: ${typeof row === 'string' ? row : JSON.stringify(row)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });

async function textOf(response: Response) {
  let output = '';
  await readChatEvents(response.body!, (text) => output += text, true);
  return output;
}

test('exactly five ranked model slots, no fake selectable backend or coupling to Effort', () => {
  const guest = rankedModels(['xyvora']);
  assert.deepEqual(guest.map(({ tier, choice, available }) => [tier, choice, available]), [
    ['advanced', 'helio-5', false], ['apex', 'helio-4', false], ['studio', 'helio-3', false], ['core', 'helio-2', false], ['quick', 'xyvora', true],
  ]);
  const names = rankedModels(['xyvora', 'helio-2', 'helio-3', 'helio-4', 'helio-5']);
  assert.deepEqual(names.map(({ name }) => name), ['Helio 5', 'Helio 4', 'Helio 3', 'Helio 2', 'Helio 1']);
  assert.ok(names.every(({ available }) => available));
  assert.deepEqual(EFFORT_IDS.map((id) => EFFORTS[id].label), ['Low', 'Medium', 'High', 'Extra', 'Max']);
  assert.equal(EFFORTS.low.thinking, 0);
  for (const field of ['native', 'hosted', 'timeout', 'thinking'] as const) {
    assert.ok(EFFORT_IDS.every((id, i) => !i || EFFORTS[id][field] > EFFORTS[EFFORT_IDS[i - 1]][field]));
  }
  assert.equal(DEFAULT_EFFORT, 'medium');
  const existing = { accent: 'iris', mode: 'creative', effort: 'max', language: 'es', replyLanguage: 'interface', autoSearch: false, nickname: '  Cami  ' };
  assert.deepEqual(parsePreferences(existing), { ...existing, accent: 'orange', nickname: 'Cami' });
  assert.equal(parsePreferences({ language: 'na' }), undefined);
  assert.equal(parsePreferences({ autoSearch: 'false' }), undefined);
  assert.throws(() => parseChat({ messages, effort: 'instant' }), /effort level/);
  assert.throws(() => parseChat({ messages, language: '{}' }), /reply language/);
  assert.throws(() => parseChat({ messages, autoSearch: 'yes' }), /automatic search/);
});

test('provider effort sets real token/reasoning budgets without emitting hidden work', async () => {
  const openai: ModelRequest = { provider: 'openai', model: 'fixture-gpt', key: 'fixture-key', url: 'https://api.openai.com/v1/chat/completions', reasoning: 'openai-none' };
  const observed: unknown[] = [];
  for (const effort of EFFORT_IDS) {
    const fetcher: typeof fetch = async (url, init) => {
      const payload = JSON.parse(String(init?.body));
      observed.push(payload.reasoning_effort);
      assert.equal(url, openai.url);
      assert.equal(payload.max_completion_tokens, EFFORTS[effort].hosted + EFFORTS[effort].thinking);
      assert.equal(init?.redirect, 'error');
      assert.match(payload.messages[0].content, /Español/);
      assert.match(payload.messages[0].content, /Brainstorm/);
      return sse({ choices: [{ delta: { reasoning_content: 'private computation', content: 'Respuesta de prueba.' } }] }, '[DONE]');
    };
    let actual = '';
    await generateHosted(openai, messages, signal, (text) => actual += text, { effort, mode: 'creative', language: 'es' }, fetcher);
    assert.equal(actual, 'Respuesta de prueba.');
  }
  assert.deepEqual(observed, ['none', 'low', 'medium', 'high', 'xhigh']);
  const providers = [
    { provider: 'anthropic', model: 'fixture', key: 'fixture-key', url: 'https://api.anthropic.com/v1/messages', reasoning: 'anthropic-adaptive' },
    { provider: 'gemini', model: 'gemini-2.5-flash', key: 'fixture-key', url: 'https://generativelanguage.googleapis.com/', reasoning: 'gemini-flash-budget' },
  ] as const satisfies readonly ModelRequest[];
  for (const provider of providers) for (const effort of ['low', 'max'] satisfies Effort[]) {
    let transcript = '';
    await generateHosted(provider, messages, signal, (text) => transcript += text, { effort }, async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      if (provider.provider === 'anthropic') {
        assert.equal(payload.thinking.type, effort === 'low' ? 'disabled' : 'adaptive');
        assert.equal(payload.output_config?.effort, effort === 'low' ? undefined : 'max');
        assert.equal(payload.max_tokens, EFFORTS[effort].hosted + EFFORTS[effort].thinking);
        return sse({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'never emit' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Tides are real.' } }, { type: 'message_stop' });
      }
      assert.equal(payload.generationConfig.thinkingConfig.thinkingBudget, EFFORTS[effort].thinking);
      assert.equal(payload.generationConfig.thinkingConfig.includeThoughts, false);
      return sse({ candidates: [{ content: { parts: [{ thought: true, text: 'never emit' }, { text: 'Tides are real.' }] }, finishReason: 'STOP' }] });
    });
    assert.equal(transcript, 'Tides are real.');
  }
  await generateHosted({ ...openai, reasoning: undefined }, messages, signal, () => {}, { effort: 'high' }, async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.reasoning_effort, undefined);
    assert.equal(payload.max_completion_tokens, EFFORTS.high.hosted);
    return sse({ choices: [{ delta: { content: 'OK.' } }] }, '[DONE]');
  });
});

test('SearXNG only receives a bounded fresh query and emits checked snippets before text', async () => {
  const query = 'Quelles sont les dernières nouvelles de la NASA ?';
  const source = { title: 'NASA', url: 'https://www.nasa.gov/news/', excerpt: 'A NASA fixture announcement.', provider: 'searxng' };
  let calls = 0;
  const search = searxngSearch({ XYVORA_SEARXNG_URL: 'https://search.example.com/gateway/', XYVORA_SEARXNG_KEY: 'fixture-search-key' }, async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://search.example.com/gateway/search');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-search-key');
    assert.ok(init?.body instanceof URLSearchParams);
    assert.deepEqual(Object.fromEntries(init.body), { q: query, safesearch: '1', format: 'json', categories: 'general', pageno: '1', language: 'fr-FR' });
    return Response.json({ results: [
      { title: '<b>NASA</b>', url: source.url, content: '<mark>A NASA fixture announcement.</mark>' },
      { title: 'duplicate', url: source.url + '#part', content: 'alternate snippet' },
      { title: 'Unsafe result', url: 'javascript:alert(1)', content: 'do not follow' },
    ] });
  });
  assert.ok(search);
  const response = await handleChat(post(query, {
    messages: [{ role: 'user', content: 'private earlier request' }, { role: 'assistant', content: 'private earlier reply' }, ...[{ role: 'user', content: query }]],
    autoSearch: true, language: 'fr', effort: 'extra', memory: ['private note'],
  }), { search, generate: async (_messages, _signal, onText, evidence) => {
    assert.deepEqual(evidence.sources, [source]);
    assert.equal(evidence.language, 'fr'); assert.equal(evidence.effort, 'extra');
    onText('Voici une annonce de la NASA [1].');
  } });
  const events: string[] = [];
  await readChatEvents(response.body!, (delta) => events.push(delta), true, (sources) => {
    assert.deepEqual(sources, [{ title: 'NASA', url: source.url, provider: 'searxng' }]); events.push('sources');
  }, undefined, () => events.push('searching'));
  assert.equal(calls, 1);
  assert.deepEqual(events.slice(0, 2), ['searching', 'sources']);
  assert.match(events.slice(2).join(''), /NASA \[1\]/);
});

test('no accidental automatic lookup from old context, attachments, private prompts, or an opt-out', async () => {
  for (const text of ['The latest news about my private project', 'What’s the current status of jane@example.com?', 'Write a story about the latest headline.',
    '/translate Spanish: what’s the latest news?', 'What is recursion?', 'Summarize this file\nlatest news', 'cite sources https://example.com/private']) assert.equal(automaticSearchQuery(text), undefined, text);
  for (const text of ['What’s the latest NASA Artemis news?', 'Verify whether this changed and cite sources.', 'Últimas noticias de la NASA', 'Wetter heute in Berlin']) assert.equal(automaticSearchQuery(text), text);
  const query = 'What’s the latest NASA Artemis news?';
  const noSearch = async () => assert.fail('must not search');
  for (const fields of [{ autoSearch: false }, { autoSearch: true, attachment: { name: 'notes.txt', text: 'private text' } }]) {
    const response = await handleChat(post(query, fields), { search: noSearch, generate: async (_messages, _signal, write, { sources }) => {
      assert.equal(sources, undefined); write('Check the publisher for updates.');
    } });
    assert.equal(await textOf(response), 'Check the publisher for updates.');
  }
  const offline = await handleChat(post(query, { autoSearch: true }), { generate: async () => assert.fail('not grounded') });
  assert.match(await textOf(offline), /search isn’t configured/);
  const empty = await handleChat(post(query, { autoSearch: true }), { search: async () => [], generate: async () => assert.fail('not grounded') });
  assert.match(await textOf(empty), /couldn’t find relevant web results/);
  const fixedClock = await handleChat(post('¿Qué hora es?', { language: 'es', autoSearch: true }), { now: () => new Date('2026-11-18T12:30:00Z'), search: noSearch });
  assert.equal(fixedClock.headers.get('x-xyvora-source'), 'clock');
  assert.match(await textOf(fixedClock), /12:30.*miércoles/s);
});

test('bad or unbounded SearXNG responses fail without spilling the endpoint or results', async () => {
  for (const url of ['http://search.example.com', 'https://127.0.0.1', 'https://search.internal', 'https://no:pass@search.example.com', 'https://search.example.com?key=x']) {
    assert.equal(searxngSearch({ XYVORA_SEARXNG_URL: url }), undefined);
  }
  for (const result of [() => new Response('secret error details', { status: 403 }), () => new Response('not json'),
    () => Response.json({ results: ['a'.repeat(321_000)] }), () => Response.json({ raw: 'invalid' })]) {
    const search = searxngSearch({ XYVORA_SEARXNG_URL: 'https://search.example.com/search' }, async (url) => {
      assert.equal(String(url), 'https://search.example.com/search'); return result();
    })!;
    await assert.rejects(search('latest tides', signal), { message: 'Web search is unavailable. Try again shortly.' });
  }
});

test('speech selects only local voices for the requested language and skips fences and citation markers', () => {
  const voices: SpeechSynthesisVoice[] = [
    { voiceURI: 'pt', localService: true, lang: 'pt-BR', name: 'Português', default: false },
    { voiceURI: 'es-us', localService: true, lang: 'es-US', name: 'Spanish US', default: true },
    { voiceURI: 'es-es', localService: true, lang: 'es-ES', name: 'Spanish Spain', default: false },
    { voiceURI: 'es-remote', localService: false, lang: 'es-ES', name: 'Remote Spanish', default: true },
  ];
  assert.deepEqual(matchingVoices(voices, 'es').map(({ voiceURI }) => voiceURI), ['es-es', 'es-us']);
  assert.deepEqual(matchingVoices(voices, 'fr'), []);
  const sample = speechChunks('## Hola [1]\n\n```js\nconsole.log("private");\nlet alsoPrivate = 42;\n```\n\n1. Abre [esta página](https://example.com/)\n2. Voilà.', 'es-ES').join(' ');
  assert.equal(sample, 'Hola Abre esta página Voilà.');
  assert.ok(speechChunks('música '.repeat(300), 'pt-BR').every((text) => text.length <= 220));
});

test('reasoning controls require an explicit matching capability, and deadlines cap work without a delay', async (t) => {
  const env = { XYVORA_AUTH_SECRET: 'test-configuration-not-live'.repeat(2), XYVORA_ENABLE_HOSTED_MODELS: '1', XYVORA_OPENAI_KEY: 'fixture-key', XYVORA_OPENAI_MODEL: 'test-text', XYVORA_OPENAI_REASONING: 'anthropic-adaptive',
    XYVORA_GEMINI_KEY: 'fixture-key', XYVORA_GEMINI_MODEL: 'gemini-2.5-pro', XYVORA_GEMINI_REASONING: 'gemini-flash-budget' };
  const defaults = hostedConfigFrom(env)!;
  assert.ok(defaults.models.every((model) => model.reasoning === undefined));
  const config = hostedConfigFrom({ ...env, XYVORA_OPENAI_REASONING: 'openai-none', XYVORA_GEMINI_MODEL: 'gemini-2.5-flash' })!;
  assert.deepEqual(config.models.map(({ reasoning }) => reasoning), ['openai-none', 'gemini-flash-budget']);
  const budgets: number[] = [];
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    budgets.push(ms); return new AbortController().signal;
  });
  t.mock.method(globalThis, 'fetch', async () => new Response('do not print', { status: 502 }));
  let fallbacks = 0;
  const local = async () => { fallbacks++; };
  const reserve = async () => true;
  await modelRouter(config, 'auto', reserve, local)!(messages, signal, () => {}, { mode: 'pro', effort: 'max' }, () => {});
  assert.equal(fallbacks, 1);
  const explicit = modelRouter(config, 'openai', reserve, local)!;
  for (const effort of ['low', 'max', undefined] as const) {
    await assert.rejects(explicit(messages, signal, () => {}, { mode: 'pro', effort }, () => {}), /selected model is unavailable/);
  }
  assert.deepEqual(budgets, [28_000, 22_000, 105_000, 80_000]);
  assert.equal(fallbacks, 1);
  const stop = new AbortController(); stop.abort();
  await assert.rejects(modelRouter(config, 'auto', reserve, local)!(messages, stop.signal, () => {}, { mode: 'pro', effort: 'max' }, () => {}), { name: 'AbortError' });
  assert.equal(fallbacks, 1);
});
