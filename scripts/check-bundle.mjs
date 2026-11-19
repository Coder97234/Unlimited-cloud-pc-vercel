import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import api from '../api/chat.js';
import { DEFAULT_MODEL } from '../shared/models.ts';
import { readChatEvents } from '../src/lib/stream.ts';

const url = 'https://bundle-check.invalid/api/chat';
assert.ok(!(await readdir('dist', { recursive: true })).some((file) => file.endsWith('.gguf')));
const networkFetch = globalThis.fetch;
let lookupsAllowed = false;
globalThis.fetch = async (url, options) => {
  assert.ok(lookupsAllowed && url === 'https://api.keenable.ai/v1/search/public', 'Inference tried to download a model or make another unexpected request');
  return networkFetch(url, options);
};

async function check(label, content, expected, { timeZone = 'UTC', searchQuery, source = 'server' } = {}) {
  const start = performance.now();
  const response = await api.fetch(new Request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: DEFAULT_MODEL, messages: [{ role: 'user', content }], timeZone, searchQuery }),
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-xyvora-source'), source);
  let text = '', first, count = 0, sources;
  await readChatEvents(response.body, (part) => { if (part.trim()) first ??= performance.now() - start; count++; text += part; }, true, (value) => { sources = value; });
  assert.ok(Number.isFinite(first) && count >= (source === 'clock' ? 1 : 2));
  assert.match(text, expected);
  if (searchQuery) assert.ok(sources?.some(({ url }) => /(^|\.)nasa\.gov$/.test(new URL(url).hostname)));
  console.log(`XYVORA_BUNDLE ${label}: first ${Math.round(first)}ms, finished ${Math.round(performance.now() - start)}ms, ${count} deltas${searchQuery ? `, ${sources.length} live sources` : ''}`);
}
await check('clock', 'What time is it in Tokyo?', /\d{1,2}:\d{2}.*Asia\/Tokyo/, { source: 'clock' });
await check('fresh Qwen', 'What is the capital of France? Answer in one short sentence.', /paris/i);
await check('reused context with a different request', 'What is the capital of Japan? Answer in one short sentence.', /tokyo/i);
await check('reused Qwen', 'What is the capital of France? Answer in one short sentence.', /paris/i);
if (process.argv.includes('--search')) {
  lookupsAllowed = true;
  await check('live search', 'What is NASA’s Artemis program?', /artemis|nasa|moon/i, { searchQuery: 'NASA Artemis program Moon missions' });
}
console.log(`XYVORA_BUNDLE peak RSS ${Math.round(process.resourceUsage().maxRSS / 1024)} MiB`);
