import assert from 'node:assert/strict';
import { test } from 'node:test';
import vercelChat from '../server/vercel-chat.ts';
import { handleChat, parseChat } from '../server/chat.ts';
import { InferenceError } from '../server/inference-stream.ts';
import { buildMessages, loadThreads } from '../src/lib/history.ts';
import type { Turn } from '../src/lib/history.ts';
import { readChatEvents } from '../src/lib/stream.ts';

const url = 'https://xyvora.invalid/api/chat';
const message = { role: 'user', content: 'What is recursion?' };
function request(body: unknown = { model: 'qwen-lite', messages: [message] }) {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('only accepts allowlisted server and Gateway models and alternating user/assistant messages', () => {
  assert.deepEqual(parseChat({ model: 'qwen-lite', messages: [message] }), { model: 'qwen-lite', messages: [message] });
  assert.equal(parseChat({ model: 'qwen', messages: [message] }).model, 'qwen');
  for (const model of ['local', 'toString', 'unknown', 'https://example.org']) {
    assert.throws(() => parseChat({ model, messages: [message] }), /supported model/);
  }
  assert.throws(() => parseChat({ model: 'qwen', messages: [{ role: 'system', content: 'hello' }] }), /roles/);
  assert.throws(() => parseChat({ model: 'qwen', messages: [message, message] }), /ending with a user/);
  assert.throws(() => parseChat({ model: 'qwen', messages: [{ role: 'user', content: 'a'.repeat(16_001) }] }), /too long/);
  assert.throws(() => parseChat({ model: 'smollm', messages: [{ role: 'user', content: 'a'.repeat(8_001) }] }), /too long/);
});

test('a missing backend never looks like successful inference', async () => {
  const status = await handleChat(new Request(url));
  assert.equal((await status.json()).availability, 'unavailable');
  const reply = await handleChat(request());
  assert.equal(reply.status, 503);
  assert.equal((await reply.json()).code, 'MODEL_UNAVAILABLE');
});

test('Vercel defaults to its own server models and opts into Gateway with request-scoped OIDC', async (t) => {
  const { VERCEL, AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN, XYVORA_ENABLE_GATEWAY } = process.env;
  t.after(() => {
    for (const [key, value] of Object.entries({ VERCEL, AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN, XYVORA_ENABLE_GATEWAY })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.VERCEL = '1';
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.XYVORA_ENABLE_GATEWAY;
  const statusRequest = () => new Request(url, { headers: { 'x-vercel-oidc-token': 'mock-runtime-token' } });
  const server = await (await vercelChat.fetch(statusRequest())).json();
  assert.deepEqual(server, { availability: 'server', models: ['qwen-lite', 'smollm'] });
  process.env.XYVORA_ENABLE_GATEWAY = '1';
  const withGateway = await (await vercelChat.fetch(statusRequest())).json();
  assert.deepEqual(withGateway.models, ['qwen-lite', 'smollm', 'qwen', 'gpt-oss', 'mistral']);
  assert.ok(!JSON.stringify(withGateway).includes('mock-runtime-token'));
});

test('development preview streams labeled sample responses', async () => {
  const reply = await handleChat(request(), { preview: true });
  assert.equal(reply.status, 200);
  assert.match(reply.headers.get('content-type') ?? '', /event-stream/);
  assert.equal(reply.headers.get('x-xyvora-source'), 'preview');
  let text = '';
  await readChatEvents(reply.body!, (delta) => { text += delta; });
  assert.match(text, /Sample response/);
  assert.match(text, /nesting dolls/);
});

test('server routes approved requests with the server token and returns the reply stream', async () => {
  const reply = await handleChat(request({ model: 'gpt-oss', messages: [message] }), {
    token: 'test-token',
    requestFetch: async (target, options) => {
      assert.equal(target, 'https://ai-gateway.vercel.sh/v1/chat/completions');
      assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer test-token');
      const data = JSON.parse(String(options?.body));
      assert.equal(data.model, 'openai/gpt-oss-20b');
      assert.equal(data.stream, true);
      assert.equal(data.max_tokens, 2_048);
      assert.equal(data.messages[0].role, 'system');
      assert.deepEqual(data.messages[1], message);
      return new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    },
  });
  let text = '';
  await readChatEvents(reply.body!, (delta) => { text += delta; });
  assert.equal(text, 'hello');
  assert.ok(!JSON.stringify([...reply.headers]).includes('test-token'));
});

test('blocks oversized bodies without invoking the model', async () => {
  const tooBig = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'a'.repeat(90_000) });
  assert.equal((await handleChat(tooBig)).status, 413);
});

test('stream parser handles split CRLF frames and multibyte text without forwarding reasoning', async () => {
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"not the answer","content":"héllo"}}]}\r\n\r\ndata: [DONE]\r\n\r\n');
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2));
    controller.close();
  } });
  let text = '';
  await readChatEvents(body, (delta) => { text += delta; });
  assert.equal(text, 'héllo');
});

test('comparison builds an independent context per model and skips failed replies', () => {
  const previous: Turn[] = [{
    id: 'turn-one', prompt: 'Hi', answers: [
      { model: 'qwen', content: 'left answer', source: 'hosted', state: 'finished' },
      { model: 'gpt-oss', content: 'right answer', source: 'hosted', state: 'finished' },
    ],
  }, {
    id: 'turn-two', prompt: 'Unanswered', answers: [{ model: 'qwen', content: '', source: 'hosted', state: 'error' }],
  }];
  const current = { prompt: 'Next question', attachment: { name: 'context.txt', text: 'Some context' } };
  const left = buildMessages(previous, current, 0, 'qwen');
  const right = buildMessages(previous, current, 1, 'gpt-oss');
  assert.equal(left[1]?.content, 'left answer');
  assert.equal(right[1]?.content, 'right answer');
  assert.equal(left.length, 3);
  assert.match(left.at(-1)!.content, /context\.txt/);
});

test('server inference streams partial text without a Gateway token', async () => {
  let finish!: () => void;
  const completion = new Promise<void>((resolve) => { finish = resolve; });
  const response = await handleChat(request(), { generate: async (id, messages, _signal, onText) => {
    assert.equal(id, 'qwen-lite');
    assert.deepEqual(messages, [message]);
    onText('First part.');
    await completion;
    onText(' Then more.');
  } });
  assert.equal(response.headers.get('x-xyvora-source'), 'server');
  let text = '';
  await readChatEvents(response.body!, (delta) => {
    text += delta;
    finish();
  });
  assert.equal(text, 'First part. Then more.');
});

test('server inference errors and empty outputs are not completed replies', async () => {
  for (const generate of [
    async () => { throw new InferenceError('The server is warming up.'); },
    async () => { throw new Error('internal details'); },
    async () => {},
  ]) {
    const response = await handleChat(request(), { generate });
    const [parsed, raw] = response.body!.tee();
    const [data] = await Promise.all([
      new Response(raw).text(),
      assert.rejects(readChatEvents(parsed, () => {}, true), /server|empty reply/),
    ]);
    assert.ok(!data.includes('[DONE]'));
    assert.ok(!data.includes('internal details'));
  }
});

test('canceling the stream aborts inference', async () => {
  let observed = false;
  const response = await handleChat(request(), { generate: async (_id, _messages, signal) => {
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => { observed = true; resolve(); }, { once: true }));
  } });
  await response.body!.cancel();
  assert.ok(observed);
});

test('Gateway refusal is not silently replaced by a sample or different model', async () => {
  const response = await handleChat(request({ model: 'qwen', messages: [message] }), {
    token: 'test-token',
    generate: async () => assert.fail('should not switch models without the user choosing'),
    requestFetch: async () => new Response('{"error":"customer_verification_required"}', { status: 403 }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'GATEWAY_UNAVAILABLE');
});

test('preserves legacy browser-generated chat history without sending it to the server', (t) => {
  const raw = [{ id: 'legacy', title: 'Old chat', mode: 'chat', turns: [
    { id: '1', prompt: 'A formerly private message', answers: [{ model: 'local', source: 'on-device', state: 'finished', content: 'A retained reply' }] },
    { id: '2', prompt: 'Retry this', answers: [{ model: 'local', source: 'on-device', state: 'error', content: '', error: 'An outdated GPU error' }] },
  ] }];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => JSON.stringify(raw) } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); });
  const [thread] = loadThreads();
  assert.equal(thread.turns[0].answers[0].content, 'A retained reply');
  assert.equal(thread.turns[0].answers[0].model, 'qwen-lite');
  assert.equal(thread.turns[0].answers[0].source, 'legacy');
  assert.match(thread.turns[1].answers[0].error ?? '', /Retry.*server/);
  assert.deepEqual(buildMessages(thread.turns, { prompt: 'Next question' }, 0, 'qwen-lite'), [{ role: 'user', content: 'Next question' }]);
});
