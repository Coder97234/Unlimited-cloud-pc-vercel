import assert from 'node:assert/strict';
import { test } from 'node:test';
import vercelChat from '../api/chat.ts';
import { handleChat, parseChat } from '../server/chat.ts';
import { buildMessages } from '../src/lib/history.ts';
import type { Turn } from '../src/lib/history.ts';
import { readChatEvents } from '../src/lib/stream.ts';

const url = 'https://xyvora.invalid/api/chat';
const message = { role: 'user', content: 'What is recursion?' };
function request(body: unknown = { model: 'qwen', messages: [message] }) {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

test('only accepts allowlisted hosted models and alternating user/assistant messages', () => {
  assert.deepEqual(parseChat({ model: 'qwen', messages: [message] }), { model: 'qwen', messages: [message] });
  for (const model of ['local', 'toString', 'unknown', 'https://example.org']) {
    assert.throws(() => parseChat({ model, messages: [message] }), /supported hosted model/);
  }
  assert.throws(() => parseChat({ model: 'qwen', messages: [{ role: 'system', content: 'hello' }] }), /roles/);
  assert.throws(() => parseChat({ model: 'qwen', messages: [message, message] }), /ending with a user/);
  assert.throws(() => parseChat({ model: 'qwen', messages: [{ role: 'user', content: 'a'.repeat(16001) }] }), /too long/);
});

test('production with no configured token never generates preview responses', async () => {
  const status = await handleChat(new Request(url));
  assert.equal((await status.json()).availability, 'on-device');
  const reply = await handleChat(request());
  assert.equal(reply.status, 503);
  assert.equal((await reply.json()).code, 'HOSTED_UNAVAILABLE');
});

test('Vercel handler uses the request-scoped OIDC token without exposing it', async (t) => {
  const { VERCEL, AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN, XYVORA_DISABLE_HOSTED } = process.env;
  t.after(() => {
    for (const [key, value] of Object.entries({ VERCEL, AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN, XYVORA_DISABLE_HOSTED })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.VERCEL = '1';
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.XYVORA_DISABLE_HOSTED;
  const response = await vercelChat.fetch(new Request(url, { headers: { 'x-vercel-oidc-token': 'mock-runtime-token' } }));
  const data = await response.json();
  assert.equal(data.availability, 'hosted');
  assert.ok(!JSON.stringify(data).includes('mock-runtime-token'));
});

test('development preview streams labeled sample responses', async () => {
  const reply = await handleChat(request(), { preview: true });
  assert.equal(reply.status, 200);
  assert.match(reply.headers.get('content-type') ?? '', /event-stream/);
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
