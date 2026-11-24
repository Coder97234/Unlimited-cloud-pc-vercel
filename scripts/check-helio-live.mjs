import assert from 'node:assert/strict';
import { readChatEvents } from '../src/lib/stream.ts';
import { HELIO_CPU_PROFILE } from './helio-profile.mjs';

// This is a real inference check for the CPU starter profile, not a fixture or
// quality benchmark. Use an isolated preview running the staged weights.
const endpoint = new URL('/api/chat', process.argv[2] ?? 'http://127.0.0.1:5173');
assert.ok(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname), 'Use a local preview.');
const caps = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) }).then((response) => {
  assert.ok(response.ok, `Chat status: HTTP ${response.status}`);
  return response.json();
});
assert.equal(caps.availability, 'server');
const prompt = 'What is the capital of France? Answer in one sentence.';
const send = (model) => fetch(endpoint, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, effort: 'low', messages: [{ role: 'user', content: prompt }] }),
  signal: AbortSignal.timeout(120_000),
});
for (const [tier, { alias }] of Object.entries(HELIO_CPU_PROFILE)) {
  assert.ok(caps.models.includes(tier) && !caps.sampleModels?.includes(tier), `${tier} is not live`);
  let first, text = '', deltas = 0, hosted;
  const engine = [];
  const start = performance.now();
  const response = await send(tier);
  assert.equal(response.status, 200, `${tier}: HTTP ${response.status}`);
  assert.equal(response.headers.get('x-xyvora-source'), 'server');
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  await readChatEvents(response.body, (delta) => {
    if (delta.trim()) first ??= performance.now() - start;
    text += delta;
    deltas++;
  }, true, undefined, (provider) => { hosted = provider; }, undefined, (value) => engine.push(value));
  assert.deepEqual(engine, [{ runner: 'llama.cpp', id: alias }]);
  assert.equal(hosted, undefined);
  assert.ok(first !== undefined && deltas > 0);
  assert.match(text, /\bParis\b/i, `${tier} did not answer the check prompt`);
  console.log(`${tier} ${alias}: first=${Math.round(first)}ms done=${Math.round(performance.now() - start)}ms deltas=${deltas}\n${text.trim()}`);
}
if (!caps.models.includes('helio-5')) {
  const unavailable = await send('helio-5');
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, 'MODEL_UNAVAILABLE');
  console.log('helio-5: not configured; 503 without fallback');
}
