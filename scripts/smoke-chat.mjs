import assert from 'node:assert/strict';
import { readChatEvents } from '../src/lib/stream.ts';
import { SERVER_MODELS } from '../shared/models.ts';

const target = process.argv[2];
if (!target) throw new Error('Pass the origin to smoke-test (for example, https://xyvora.net).');
const benchmark = process.argv.includes('--benchmark');
const url = new URL('/api/chat', target);
const status = await fetch(url, { signal: AbortSignal.timeout(10_000) });
assert.ok(status.ok, `Chat status returned HTTP ${status.status}`);
const configuration = await status.json();
assert.equal(configuration.availability, 'server');
for (const model of SERVER_MODELS) assert.ok(configuration.models.includes(model), `${model} is not enabled`);

const prompts = {
  'qwen-lite': ['What is the capital of France? Answer in one short sentence.', /paris/i],
  smollm: ['What color is a ripe banana? Answer in one short sentence.', /yellow/i],
};

async function check(model, [content, expected], label) {
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }] }),
    signal: AbortSignal.timeout(125_000),
  });
  assert.ok(response.ok, `${model} returned HTTP ${response.status}`);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.equal(response.headers.get('x-xyvora-source'), 'server');
  let text = '';
  let chunks = 0;
  let firstText;
  let lastText;
  await readChatEvents(response.body, (delta) => {
    if (!delta) return;
    const now = performance.now() - startedAt;
    if (delta.trim()) firstText ??= now;
    lastText = now;
    chunks++;
    text += delta;
  }, true);
  assert.ok(chunks > 1 && firstText !== undefined, `${model} did not stream multiple text chunks`);
  assert.match(text, expected, `${model} did not return an answer to the smoke prompt`);
  const ms = Math.round;
  console.log(`XYVORA_CHAT ${label} ${model}: first text ${ms(firstText)}ms; streaming ${ms(lastText - firstText)}ms; finished ${ms(performance.now() - startedAt)}ms; ${chunks} deltas, ${text.length} chars`);
}

for (const label of benchmark ? ['initial', 'repeat-1', 'repeat-2'] : ['initial']) {
  await Promise.all(SERVER_MODELS.map((model) => check(model, prompts[model], label)));
}
if (benchmark) {
  await check('qwen-lite', [
    'Give five practical tips for packing light for a weekend trip. Use a numbered list with one sentence per tip.',
    /pack|wear|layer|cloth/i,
  ], 'longer-reply');
}
