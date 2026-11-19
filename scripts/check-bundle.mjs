import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import api from '../api/chat.js';
import { WIBY_SEARCH_URL, WIKI_SEARCH_URL, searchWeb } from '../server/web-search.ts';
import { ASSISTANT_PROFILE, DEFAULT_MODEL } from '../shared/models.ts';
import { readChatEvents } from '../src/lib/stream.ts';

const url = 'https://bundle-check.invalid/api/chat';
assert.deepEqual((await (await api.fetch(new Request(url))).json()).assistant, ASSISTANT_PROFILE);
assert.ok(!(await readdir('dist', { recursive: true })).some((file) => file.endsWith('.gguf')));
const networkFetch = globalThis.fetch;
let lookupsAllowed = false;
globalThis.fetch = async (url, options) => {
  const address = new URL(url);
  assert.ok(lookupsAllowed && [WIBY_SEARCH_URL, WIKI_SEARCH_URL].includes(address.origin + address.pathname), 'Unexpected network access');
  return networkFetch(url, options);
};

async function check(label, content, expected, { timeZone = 'UTC', searchQuery, source = 'server', skill } = {}) {
  const start = performance.now();
  const response = await api.fetch(new Request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: DEFAULT_MODEL, messages: [{ role: 'user', content }], timeZone, searchQuery }),
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-xyvora-source'), source);
  if (skill) assert.equal(response.headers.get('x-xyvora-skill'), skill);
  let text = '', first, count = 0, sources;
  await readChatEvents(response.body, (part) => { if (part.trim()) first ??= performance.now() - start; count++; text += part; }, true, (value) => { sources = value; });
  assert.ok(Number.isFinite(first) && count >= (source === 'server' ? 2 : 1));
  assert.match(text, expected);
  if (searchQuery) assert.ok(sources?.some(({ title }) => /artemis/i.test(title)));
  if (searchQuery) assert.ok(sources.every(({ excerpt }) => excerpt === undefined), 'Only source metadata should reach the client');
  console.log(`XYVORA_BUNDLE ${label}: first ${Math.round(first)}ms, finished ${Math.round(performance.now() - start)}ms, ${count} deltas${searchQuery ? `, ${sources.length} live sources` : ''}`);
}
await check('identity', 'Who exactly are you?', /Xyvora AI.*xyvora\.net.*Qwen 2\.5/, { source: 'skill', skill: 'about' });
await check('calculator', 'What is 18% of 84.50?', /15\.21/, { source: 'skill', skill: 'calc' });
await check('clock', '/time Tokyo', /\d{1,2}:\d{2}.*Asia\/Tokyo/, { source: 'clock', skill: 'time' });
await check('fresh Qwen', 'What is the capital of France? Answer in one short sentence.', /paris/i);
await check('reused context with a different request', 'What is the capital of Japan? Answer in one short sentence.', /tokyo/i);
await check('reused Qwen', 'What is the capital of France? Answer in one short sentence.', /paris/i);
// Cancel real native generation and verify the next request on the same state.
const stop = new AbortController();
const interrupted = await api.fetch(new Request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: stop.signal,
  body: JSON.stringify({ model: DEFAULT_MODEL, messages: [{ role: 'user', content: 'Write a long fictional travel diary about a place called Orchid Ridge.' }] }),
}));
await assert.rejects(readChatEvents(interrupted.body, () => stop.abort(), true), /ended before the reply finished/);
await check('after cancellation', 'What is the capital of Japan? Answer in one short sentence.', /tokyo/i);
await check('translate workflow', '/translate Spanish: Good morning!', /buenos d[íi]as/i);
if (process.argv.includes('--search')) {
  lookupsAllowed = true;
  const independent = await searchWeb('unix shell tutorial', AbortSignal.timeout(7_000));
  console.log(`XYVORA_BUNDLE provider check: ${[...new Set(independent.map(({ provider }) => provider))].join(', ') || 'no results'}`);
  await check('live search', 'What is NASA’s Artemis program?', /artemis|nasa|moon/i, { searchQuery: 'NASA Artemis program' });
}
console.log(`XYVORA_BUNDLE peak RSS ${Math.round(process.resourceUsage().maxRSS / 1024)} MiB`);
