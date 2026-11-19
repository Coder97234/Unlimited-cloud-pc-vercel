import assert from 'node:assert/strict';
import { readChatEvents } from '../src/lib/stream.ts';
import { SERVER_MODELS } from '../shared/models.ts';

const target = process.argv[2];
if (!target) throw new Error('Pass the origin to smoke-test (for example, https://xyvora.net).');
const url = new URL('/api/chat', target);
const status = await fetch(url, { signal: AbortSignal.timeout(10_000) });
assert.ok(status.ok, `Chat status returned HTTP ${status.status}`);
const configuration = await status.json();
assert.equal(configuration.availability, 'server');

await Promise.all(SERVER_MODELS.map(async (model, index) => {
  assert.ok(configuration.models.includes(model), `${model} is not enabled`);
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: index === 0
      ? 'What is the capital of France? Answer in one short sentence.'
      : 'What color is a ripe banana? Answer in one short sentence.' }] }),
    signal: AbortSignal.timeout(125_000),
  });
  assert.ok(response.ok, `${model} returned HTTP ${response.status}`);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.equal(response.headers.get('x-xyvora-source'), 'server');
  let text = '';
  let chunks = 0;
  let firstDelta = 0;
  await readChatEvents(response.body, (delta) => {
    if (!chunks) firstDelta = performance.now() - startedAt;
    chunks++;
    text += delta;
  }, true);
  assert.ok(chunks > 1, `${model} did not stream multiple chunks`);
  assert.ok((index === 0 ? /paris/i : /yellow/i).test(text), `${model} did not return an answer to the smoke prompt`);
  console.log(`${model}: ${chunks} streamed chunks; first text in ${Math.round(firstDelta)}ms; finished in ${Math.round(performance.now() - startedAt)}ms`);
}));
