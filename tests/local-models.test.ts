import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { handleChat } from '../server/chat.ts';
import { localModelsFrom } from '../server/local-models.ts';
import { parseCloudThreads, restoreThreads, savedModelSelection } from '../shared/history.ts';
import type { LocalModel } from '../shared/local-models.ts';
import { conversationMarkdown } from '../src/lib/export-chat.ts';
import { buildMessages } from '../src/lib/history.ts';
import { readChatEvents } from '../src/lib/stream.ts';

const url = 'https://xyvora.test/api/chat';
const messages = [{ role: 'user', content: 'Tell a short story about a paper kite.' }];
const req = (model: unknown, fields: Record<string, unknown> = {}, signal?: AbortSignal) => new Request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, ...fields }), signal,
});
const streaming = (...events: (object | '[DONE]')[]) => new Response(events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\r\n\r\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
const replyText = async (response: Response, models: LocalModel[] = []) => {
  let text = '';
  await readChatEvents(response.body!, (part) => { text += part; }, true, undefined, undefined, undefined, (model) => models.push(model));
  return text;
};
const sseReply = () => streaming({ choices: [{ delta: { reasoning_content: 'Not part of the reply' } }] }, { choices: [{ delta: { content: 'An answer from the local runner.' } }] }, '[DONE]');
const cloudOff = () => Response.json({ cloud: { disabled: true } });
const ollama = { XYVORA_LOCAL_RUNNER: 'ollama' };
const llama = { XYVORA_LOCAL_RUNNER: 'llama.cpp' };

const file = (id: string, params: number, fields: object = {}) => ({
  id, source: 'models_dir', status: { value: 'unloaded' }, meta: { n_params: params }, path: '/srv/private/weights/model.gguf',
  architecture: { input_modalities: ['text'], output_modalities: ['text'] }, ...fields,
});

test('Branded choices reach exact configured Ollama pools without auth, arbitrary model IDs, or paid fallback', async () => {
  const attempts: string[] = [];
  const cloudAlias = 'vendor/remote-alias:latest';
  const normal = ['small-lab:latest', 'new-family:2b', 'studio:3b', 'strong-chat:7b'];
  const local = localModelsFrom({ ...ollama, XYVORA_LOCAL_PORT: '11438', XYVORA_LOCAL_MAX_MODEL_BYTES: '5000', XYVORA_LOCAL_TIERS: JSON.stringify({
    'helio-2': normal.slice(0, 2), 'helio-3': [normal[2]], 'helio-4': [normal[3], cloudAlias, 'not-installed:latest', 'huge:latest', 'embed:latest', 'vendor:cloud'],
  }) }, async (input, init) => {
    const endpoint = new URL(String(input));
    assert.equal(endpoint.origin, 'http://127.0.0.1:11438');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    if (endpoint.pathname === '/api/status') return cloudOff();
    if (endpoint.pathname === '/api/tags') return Response.json({ models: [...normal, cloudAlias, 'huge:latest', 'embed:latest', 'vendor:cloud'].map((model) => ({ model, size: model === 'huge:latest' ? 5_001 : 4_000 })) });
    const data = JSON.parse(String(init?.body));
    if (endpoint.pathname === '/api/show') {
      assert.equal(init?.method, 'POST');
      assert.notEqual(data.model, 'vendor:cloud');
      assert.notEqual(data.model, 'huge:latest');
      return Response.json(data.model === cloudAlias ? { remote_host: 'https://secret.invalid', capabilities: ['completion'] }
        : { capabilities: data.model === 'embed:latest' ? ['embedding'] : ['completion'] });
    }
    assert.equal(endpoint.pathname, '/v1/chat/completions');
    attempts.push(data.model);
    assert.equal(data.stream, true);
    assert.equal(data.max_tokens, 1_450);
    assert.match(data.messages[0].content, /Reply style:.*\nReply guidance:.*Español/s);
    assert.match(data.messages.at(-1).content, /kite.*A named fixture/s);
    assert.equal(data.tools, undefined);
    return data.model === normal[3] ? new Response('raw private failure', { status: 503 }) : sseReply();
  })!;
  const options = { localModels: local, hosted: async () => assert.fail('must not enter hosted routing'),
    generate: async (_: unknown, _signal: AbortSignal, write: (s: string) => void) => write('Bundled engine only.') };
  const status = await (await handleChat(new Request(url), options)).json();
  assert.deepEqual(status.models, ['xyvora', 'helio-2', 'helio-3', 'helio-4']);
  assert.doesNotMatch(JSON.stringify(status), /small-lab|secret|llama|https:\/\/secret/);
  assert.equal(await replyText(await handleChat(req('xyvora'), options)), 'Bundled engine only.');
  for (const choice of ['helio-2', 'helio-2', 'helio-3'] as const) {
    const models: LocalModel[] = [];
    const response = await handleChat(req(choice, { effort: 'high', mode: 'creative', language: 'es', memory: ['A named fixture'], modelUrl: 'https://other.invalid' }), options);
    assert.equal(response.headers.get('x-xyvora-source'), 'server');
    assert.equal(await replyText(response, models), 'An answer from the local runner.');
    assert.deepEqual(models, [{ runner: 'ollama', id: attempts.at(-1) }]);
  }
  const failure = await handleChat(req('helio-4', { effort: 'high', mode: 'creative', language: 'es', memory: ['A named fixture'] }), options);
  await assert.rejects(replyText(failure), { message: /selected local model is unavailable/i });
  assert.deepEqual(attempts, normal, 'only one local backend per request; a failed request does not try another');
  for (const bad of ['variant:retired', normal[0], 'https://other.invalid/', { variant: 'retired' }, 'helio-6']) {
    assert.equal((await handleChat(req(bad), options)).status, 400);
  }
  const unavailable = await handleChat(req('helio-5'), options);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, 'MODEL_UNAVAILABLE');
  const tool = await handleChat(req('helio-3', { messages: [{ role: 'user', content: '/calc 4 * 7' }] }), options);
  assert.equal(tool.headers.get('x-xyvora-source'), 'skill');
  assert.match(await replyText(tool), /28/);
  assert.deepEqual(attempts, normal);
});

test('Automatic discovery covers new families, deduplicates aliases by digest, refreshes once, and fails closed when unavailable', async () => {
  let checkTime = 100_000, inventoryReads = 0, cloudDisabled = true, reachable = true;
  const tag = (id: string, parameters: string, fields: object = {}) => ({ model: id, size: 1000, details: { parameter_size: parameters }, capabilities: ['completion'], ...fields });
  let tags = [tag('a:tiny', '135M', { digest: 'a'.repeat(64) }), tag('a:copy', '135M', { digest: 'a'.repeat(64) }), tag('mid:3b', '3B'), tag('new-local:9b', '9B'), tag('newer:11b', '11B'),
    tag('embeddings:latest', '90M', { capabilities: ['embedding'] }), tag('alias:latest', '2B', { remote_model: 'cloud-model' }), tag('tag-cloud:latest', '7B'), tag('no-weights', '2B', { size: 0 })];
  const called: string[] = [];
  const local = localModelsFrom(ollama, async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/status') return reachable ? Response.json({ cloud: { disabled: cloudDisabled } }) : new Response('Stopped', { status: 502 });
    if (path === '/api/tags') { inventoryReads++; return Response.json({ models: tags }); }
    assert.equal(path, '/v1/chat/completions');
    called.push(JSON.parse(String(init?.body)).model);
    return sseReply();
  }, () => checkTime)!;
  const options = { localModels: local, preview: true, hosted: async () => assert.fail('Unexpected hosted dispatch') };
  const status = () => handleChat(new Request(url), options).then((res) => res.json());
  const [first, second] = await Promise.all([status(), status()]);
  assert.deepEqual(first, second);
  assert.equal(first.availability, 'server');
  assert.deepEqual(first.sampleModels, ['xyvora']);
  assert.equal(inventoryReads, 1);
  for (const model of ['helio-2', 'helio-2', 'helio-3', 'helio-4']) await replyText(await handleChat(req(model), options));
  assert.deepEqual(called, ['a:copy', 'mid:3b', 'new-local:9b', 'newer:11b']);
  cloudDisabled = false;
  await assert.rejects(replyText(await handleChat(req('helio-2'), options)), /cloud mode is enabled/);
  assert.equal(called.length, 4);
  const preview = await status();
  assert.equal(preview.availability, 'preview');
  assert.deepEqual(preview.models, ['xyvora']);
  cloudDisabled = true;
  checkTime += 10_001;
  tags = [tag('new-family:0.6b', '0.6B')];
  assert.deepEqual((await status()).models, ['xyvora', 'helio-2']);
  const missing = await handleChat(req('helio-4'), options);
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).code, 'MODEL_UNAVAILABLE');
  await replyText(await handleChat(req('helio-2'), options));
  assert.equal(called.at(-1), 'new-family:0.6b');
  reachable = false;
  checkTime += 10_001;
  assert.deepEqual((await status()).models, ['xyvora']);
  assert.equal((await handleChat(req('helio-2'), options)).status, 503);
  assert.equal(inventoryReads, 2);
});

test('llama.cpp uses complete offline models, and a configured TLS gateway is authenticated server-side', async () => {
  const token = 'fixture-token-not-a-real-key-whatsoever';
  const origin = 'https://runner.example.org';
  for (const fields of [
    { VERCEL: '1' }, { VERCEL_ENV: 'preview' }, { XYVORA_LOCAL_PORT: '0' }, { XYVORA_LOCAL_PORT: '65536' },
    { VERCEL: '1', XYVORA_LOCAL_GATEWAY_URL: origin }, { XYVORA_LOCAL_GATEWAY_URL: 'https://127.0.0.1', XYVORA_LOCAL_KEY: token },
    { XYVORA_LOCAL_GATEWAY_URL: origin + '/api', XYVORA_LOCAL_KEY: token }, { XYVORA_LOCAL_GATEWAY_URL: `http://${new URL(origin).host}`, XYVORA_LOCAL_KEY: token },
    { XYVORA_LOCAL_GATEWAY_URL: origin + '/?id=1', XYVORA_LOCAL_KEY: token }, { XYVORA_LOCAL_RUNNER: 'openai' },
    { XYVORA_LOCAL_TIERS: '{"helio-2":["a"],"helio-3":["a"]}' }, { XYVORA_LOCAL_TIERS: '{"xyvora":["a"]}' }, { XYVORA_LOCAL_TIERS: '{"helio-5":["tiny"]}' }, { XYVORA_LOCAL_MAX_TOKENS: '3601' }, { XYVORA_LOCAL_TIERS: '{"helio-2":["/absolute/file"]}' },
  ]) assert.equal(localModelsFrom({ ...llama, ...fields }), undefined, JSON.stringify(fields));
  const local = localModelsFrom({ ...llama, VERCEL: '1', XYVORA_LOCAL_GATEWAY_URL: origin, XYVORA_LOCAL_KEY: token }, async (input, init) => {
    const address = new URL(String(input));
    assert.equal(address.origin, origin);
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${token}`);
    assert.equal(init?.redirect, 'error');
    if (address.pathname === '/models') return Response.json({ data: [file('installed-750M', 750e6),
      file('invalid-preset', 4e9, { source: 'preset' }), file('we-are-still-downloading', 32e9, { source: 'cache', status: { value: 'incomplete' } }),
      file('failed-4B', 4e9, { status: { value: 'unloaded', failed: true } }), file('model-embeddings', 32e6, { status: { value: 'loaded', args: ['--embeddings'] } }),
      file('audio-only', 4e9, { architecture: { input_modalities: ['text'], output_modalities: ['audio'] } }), file('/srv/private/model', 1e9),
    ] });
    assert.equal(address.pathname, '/v1/chat/completions');
    assert.equal(JSON.parse(String(init?.body)).model, 'installed-750M');
    assert.doesNotMatch(String(init?.body), /fixture-token|\/srv\/private/);
    return sseReply();
  })!;
  const status = await (await handleChat(new Request(url), { localModels: local, search: async () => [] })).json();
  assert.deepEqual(status.models, ['helio-2']);
  assert.equal(status.availability, 'server');
  assert.equal(status.webSearch, true);
  assert.doesNotMatch(JSON.stringify(status), /runner.example.org|private|installed-750M/);
  assert.equal((await handleChat(req('xyvora'), { localModels: local })).status, 503);
  const actual: LocalModel[] = [];
  assert.equal(await replyText(await handleChat(req('helio-2'), { localModels: local }), actual), 'An answer from the local runner.');
  assert.deepEqual(actual, [{ runner: 'llama.cpp', id: 'installed-750M' }]);
});

test('aborting a local stream closes the HTTP generation, and frees the single generation slot', { timeout: 8_000 }, async (t) => {
  let attempts = 0;
  let finished!: () => void, ready!: () => void;
  const closed = new Promise<void>((resolve) => { finished = resolve; });
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const server = createServer((request, response) => {
    if (request.url === '/models') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ data: [file('local-chat', 1e9)] })); return; }
    assert.equal(request.url, '/v1/chat/completions');
    request.resume();
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: {"choices":[{"delta":{"content":"The answer is streaming. More soon. "}}]}\n\n');
    if (++attempts === 1) { response.on('close', finished); ready(); }
    else response.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const localModels = localModelsFrom({ ...llama, XYVORA_LOCAL_PORT: String(address.port) })!;
  const stop = new AbortController();
  const response = await handleChat(req('helio-2', {}, stop.signal), { localModels });
  await started;
  const busy = await handleChat(req('helio-2'), { localModels });
  await assert.rejects(replyText(busy), /local models are busy/);
  let beforeStop = '';
  await assert.rejects(readChatEvents(response.body!, (delta) => { beforeStop += delta; stop.abort(); }, true), /ended before/);
  assert.match(beforeStop, /streaming/);
  await closed;
  assert.match(await replyText(await handleChat(req('helio-2'), { localModels })), /streaming/);
  assert.equal(attempts, 2);
});

test('legacy selection remains readable but requires a new pick; new Helio IDs and actual local engines survive storage', () => {
  const [old, current] = restoreThreads([
    { id: 'old', title: 'Saved catalog reply', mode: 'chat', turns: [{ id: 'old-turn', prompt: 'Earlier prompt', answers: [
      { model: 'xyvora', modelVariant: { id: 'retired', version: '4.12', label: 'Earlier hosted model' }, hostedModel: { provider: 'openai', model: 'previous-api' }, content: 'Earlier answer', state: 'finished', source: 'server' },
    ] }] },
    { id: 'current', title: 'Local reply', mode: 'chat', turns: [{ id: 'new-turn', prompt: 'Explain tides.', answers: [
      { model: 'helio-3', tier: 'core', localModel: { runner: 'llama.cpp', id: 'instruct-chat-4B', origin: 'private' }, content: 'The Moon pulls on the oceans.', state: 'finished', source: 'server', effort: 'high' },
    ] }, { id: 'advanced-turn', prompt: 'Why are there two tides?', answers: [
      { model: 'helio-5', localModel: { runner: 'ollama', id: 'reasoning-27b:latest' }, content: 'The tidal force is differential.', state: 'finished', source: 'server', effort: 'max' },
    ] }] },
  ]);
  assert.deepEqual(savedModelSelection(old.turns[0].answers[0]), { tier: 'apex', needsChoice: true });
  const answer = current.turns[0].answers[0];
  assert.deepEqual(savedModelSelection(answer), { tier: 'studio', needsChoice: false });
  assert.deepEqual(answer.localModel, { runner: 'llama.cpp', id: 'instruct-chat-4B' });
  assert.deepEqual(savedModelSelection(current.turns[1].answers[0]), { tier: 'advanced', needsChoice: false });
  assert.deepEqual(parseCloudThreads([old, current]), [old, current]);
  assert.match(conversationMarkdown(old), /Model choice: Helio 4\.12 · Earlier hosted model.*Model: OpenAI · previous-api/s);
  assert.match(conversationMarkdown(current), /Model choice: Helio 3.*Local engine: llama\.cpp · instruct-chat-4B/s);
  assert.match(conversationMarkdown(current), /Model choice: Helio 5.*Local engine: Ollama · reasoning-27b:latest/is);
  assert.equal(buildMessages(current.turns, { prompt: 'And the Sun?' }).length, 5);
  assert.deepEqual(savedModelSelection({ ...answer, model: 'xyvora', tier: 'studio', localModel: undefined }), { tier: 'studio', needsChoice: true });
});

const advancedOrigin = 'https://reasoning.example.org';
const advancedKey = 'different-advanced-key-for-test-only';
const advancedId = 'reasoning-27b:latest';
const advancedDigest = 'd'.repeat(64);
const advancedEnv = { VERCEL: '1', XYVORA_HELIO5_MODEL: advancedId, XYVORA_HELIO5_DIGEST: advancedDigest,
  XYVORA_HELIO5_GATEWAY_URL: advancedOrigin, XYVORA_HELIO5_KEY: advancedKey };
const advancedTag = { model: advancedId, digest: advancedDigest, size: 17_000_000_000, capabilities: ['completion', 'thinking'] };
const advancedMeta = { capabilities: ['completion', 'thinking'], model_info: { 'general.parameter_count': 27_000_000_000 },
  thinking: { values: [false, true, 'low', 'medium', 'high', 'max'] } };

test('Helio 5 requires a pinned, installed, thinking-capable model; metadata from a filename or cloud alias cannot qualify', async () => {
  for (const fields of [
    { XYVORA_HELIO5_MODEL: undefined }, { XYVORA_HELIO5_MODEL: '/weights/model' }, { XYVORA_HELIO5_DIGEST: '' },
    { XYVORA_HELIO5_GATEWAY_URL: undefined }, { XYVORA_HELIO5_GATEWAY_URL: 'http://reasoning.example.org' },
    { XYVORA_HELIO5_GATEWAY_URL: `${advancedOrigin}/v1` }, { XYVORA_HELIO5_KEY: 'short' }, { XYVORA_HELIO5_PORT: '11435' },
  ]) assert.equal(localModelsFrom({ ...advancedEnv, ...fields }), undefined);
  for (const [tag, details, status = cloudOff()] of [
    [{ ...advancedTag, digest: 'a'.repeat(64) }, advancedMeta],
    [{ ...advancedTag, model: 'unselected-70b:latest' }, advancedMeta],
    [{ ...advancedTag, remote_host: 'https://service.example.org' }, advancedMeta],
    [advancedTag, { ...advancedMeta, remote_model: 'remote' }],
    [advancedTag, { ...advancedMeta, capabilities: ['completion'] }],
    [advancedTag, { ...advancedMeta, thinking: { values: [false] } }],
    [advancedTag, { ...advancedMeta, model_info: {} }],
    [advancedTag, { ...advancedMeta, model_info: { 'general.parameter_count': 4_000_000_000 } }],
    [advancedTag, advancedMeta, Response.json({ cloud: { disabled: false } })],
  ] as const) {
    const localModels = localModelsFrom(advancedEnv, async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/status') return status.clone();
      if (path === '/api/tags') return Response.json({ models: [tag] });
      if (path === '/api/show') return Response.json(details);
      return assert.fail('No generation should be attempted');
    })!;
    const options = { localModels, preview: true,
      hosted: async () => assert.fail('No provider fallback'), generate: async () => assert.fail('No Helio 1 fallback') };
    assert.deepEqual((await (await handleChat(new Request(url), options)).json()).models, ['xyvora']);
    const rejected = await handleChat(req('helio-5'), options);
    assert.equal(rejected.status, 503);
    assert.equal((await rejected.json()).code, 'MODEL_UNAVAILABLE');
  }
});

test('Helio 5 streams only from its dedicated gateway, scales true thinking when supported, and rechecks the pin before sending chat', async () => {
  const standardOrigin = 'https://standard.example.org';
  const standardKey = 'standard-fixture-authorization-secret';
  const calls: { origin: string; model: string; max_tokens: number; reasoning_effort?: string }[] = [];
  let currentDigest = advancedDigest;
  const localModels = localModelsFrom({ ...advancedEnv, XYVORA_LOCAL_RUNNER: 'ollama', XYVORA_LOCAL_GATEWAY_URL: standardOrigin,
    XYVORA_LOCAL_KEY: standardKey, XYVORA_LOCAL_MAX_TOKENS: '160' }, async (url, init) => {
    const { origin, pathname } = new URL(String(url));
    assert.ok(origin === advancedOrigin || origin === standardOrigin);
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${origin === advancedOrigin ? advancedKey : standardKey}`);
    assert.equal(init?.redirect, 'error');
    if (pathname === '/api/status') return cloudOff();
    if (pathname === '/api/tags') return Response.json({ models: origin === advancedOrigin ? [{ ...advancedTag, digest: currentDigest }]
      : [{ ...advancedTag, model: 'same-weights:27b' }, { model: 'standard-chat:latest', size: 1000, capabilities: ['completion'] }] });
    const data = JSON.parse(String(init?.body));
    if (pathname === '/api/show') {
      assert.equal(origin, advancedOrigin);
      assert.deepEqual(data, { model: advancedId, verbose: false });
      return Response.json(advancedMeta);
    }
    assert.equal(pathname, '/v1/chat/completions');
    assert.equal(data.tools, undefined);
    calls.push({ origin, model: data.model, max_tokens: data.max_tokens, reasoning_effort: data.reasoning_effort });
    return sseReply();
  })!;
  const options = { localModels, hosted: async () => assert.fail('No provider fallback') };
  const status = await (await handleChat(new Request(url), options)).json();
  assert.deepEqual(status.models, ['helio-2', 'helio-5']);
  assert.doesNotMatch(JSON.stringify(status), /example.org|27b|fixture-authorization/);
  for (const effort of ['low', 'high', 'max'] as const) {
    const models: LocalModel[] = [];
    const response = await handleChat(req('helio-5', { effort, reasoning_effort: 'user-input-is-ignored', modelUrl: standardOrigin }), options);
    assert.equal(response.headers.get('x-xyvora-source'), 'server');
    assert.equal(await replyText(response, models), 'An answer from the local runner.');
    assert.deepEqual(models, [{ runner: 'ollama', id: advancedId }]);
  }
  currentDigest = 'a'.repeat(64);
  await assert.rejects(replyText(await handleChat(req('helio-5'), options)), /pinned Helio 5 model is unavailable/);
  assert.equal((await handleChat(req('helio-5'), options)).status, 503);
  assert.equal(await replyText(await handleChat(req('helio-2', { effort: 'low' }), options)), 'An answer from the local runner.');
  assert.equal(await replyText(await handleChat(req('helio-2', { effort: 'max' }), options)), 'An answer from the local runner.');
  assert.deepEqual(calls, [
    { origin: advancedOrigin, model: advancedId, max_tokens: 260, reasoning_effort: 'none' },
    { origin: advancedOrigin, model: advancedId, max_tokens: 1_834, reasoning_effort: 'high' },
    { origin: advancedOrigin, model: advancedId, max_tokens: 5_648, reasoning_effort: 'max' },
    { origin: standardOrigin, model: 'standard-chat:latest', max_tokens: 64, reasoning_effort: undefined },
    { origin: standardOrigin, model: 'standard-chat:latest', max_tokens: 160, reasoning_effort: undefined },
  ]);
});
