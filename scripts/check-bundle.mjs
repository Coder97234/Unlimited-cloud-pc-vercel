import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { checkUpdateLock, makeUpdateKey } from '../server/update-lock.ts';
import { readdir } from 'node:fs/promises';
import api from '../api/chat.js';
import middleware from '../middleware.js';
import workspace from '../api/workspace.js';
import account from '../api/account.js';
import analytics from '../api/analytics.js';
import { guestAccount } from '../shared/account.ts';
import { MODE_IDS } from '../shared/modes.ts';
import { PUBLIC_API_EXAMPLE, WORKSPACE_PLUGINS_ENABLED } from '../shared/workspace-tools.ts';
import { WIBY_SEARCH_URL, WIKI_SEARCH_URL, searchWeb } from '../server/web-search.ts';
import { ASSISTANT_PROFILE, DEFAULT_MODEL } from '../shared/models.ts';
import { readChatEvents } from '../src/lib/stream.ts';

const url = 'https://bundle-check.invalid/api/chat';
const origin = new URL(url).origin;
// Replace the real configuration only in this smoke-test process. Never
// print or consume the deployment credential in the engine checks.
const password = randomBytes(24).toString('base64url');
process.env.XYVORA_UPDATE_KEY = await makeUpdateKey(password);
for (const [path, route] of [['chat', api], ['account', account], ['analytics', analytics], ['workspace', workspace]]) {
  const denied = await route.fetch(new Request(`${origin}/api/${path}`));
  assert.equal(denied.status, 423, `${path} must be locked before any service work`);
  assert.equal((await denied.json()).code, 'UPDATE_LOCKED');
}
const unlocked = await checkUpdateLock(new Request(`${origin}/_xyvora/unlock`, {
  method: 'POST', headers: { Origin: origin }, body: new URLSearchParams({ password }),
}), process.env, { deployed: true });
assert.equal(unlocked?.status, 303, 'Fixture password did not unlock production handlers');
const cookie = unlocked.headers.get('set-cookie').split(';', 1)[0];
const earlyRequest = (address, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Cookie', cookie);
  return new Request(address, { ...init, headers });
};
const home = await middleware(new Request(origin, { headers: { Accept: 'text/html' } }));
assert.equal(home.headers.get('x-xyvora-update'), 'locked');
assert.equal(home.headers.get('x-middleware-next'), null);
assert.match(await home.text(), /This website has been locked for an update\./);
const asset = await middleware(new Request(`${origin}/theme.js`));
assert.equal(asset.status, 423);
const permitted = await middleware(earlyRequest(`${origin}/theme.js`));
assert.equal(permitted.headers.get('x-middleware-next'), '1');
assert.match(permitted.headers.get('cache-control') ?? '', /no-store/);
console.log('XYVORA_UPDATE packaged middleware, API gate and independent fixture session verified');
const status = await (await api.fetch(earlyRequest(url))).json();
assert.deepEqual(status.assistant, ASSISTANT_PROFILE);
assert.deepEqual(status.modes, MODE_IDS);
assert.deepEqual(status.models, [DEFAULT_MODEL]);
assert.doesNotMatch(JSON.stringify(status), /qwen/i);
assert.deepEqual(await (await account.fetch(earlyRequest('https://bundle-check.invalid/api/account'))).json(), guestAccount());
assert.equal((await (await analytics.fetch(earlyRequest('https://bundle-check.invalid/api/analytics'))).json()).available, false);
assert.ok(!(await readdir('dist', { recursive: true })).some((file) => file.endsWith('.gguf')));
const networkFetch = globalThis.fetch;
let lookupsAllowed = false;
let publicAllowed = false;
const publicReads = new Set([
  PUBLIC_API_EXAMPLE, `${PUBLIC_API_EXAMPLE}/contents?ref=master`, `${PUBLIC_API_EXAMPLE}/contents/README?ref=master`,
  'https://registry.npmjs.org/react/latest',
]);
globalThis.fetch = async (url, options) => {
  const address = new URL(url);
  assert.ok((lookupsAllowed && [WIBY_SEARCH_URL, WIKI_SEARCH_URL].includes(address.origin + address.pathname))
    || (publicAllowed && publicReads.has(address.href)), 'Unexpected network access');
  return networkFetch(url, options);
};

async function check(label, content, expected, { timeZone = 'UTC', searchQuery, mode, source = 'server', skill } = {}) {
  const start = performance.now();
  const response = await api.fetch(earlyRequest(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: DEFAULT_MODEL, messages: [{ role: 'user', content }], timeZone, searchQuery, mode }),
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-xyvora-source'), source);
  if (skill) assert.equal(response.headers.get('x-xyvora-skill'), skill);
  let text = '', first, count = 0, sources;
  await readChatEvents(response.body, (part) => { if (part.trim()) first ??= performance.now() - start; count++; text += part; }, true, (value) => { sources = value; });
  // The creator guard releases complete sentences, so a short native answer
  // can legitimately be one SSE delta. tests/chat.test.ts checks early release
  // while a later sentence is still generating; readChatEvents requires [DONE].
  assert.ok(Number.isFinite(first), `${label}: no nonempty streamed text`);
  assert.match(text, expected);
  assert.doesNotMatch(text, /qwen/i);
  if (searchQuery) assert.ok(sources?.some(({ title }) => /artemis/i.test(title)));
  if (searchQuery) assert.ok(sources.every(({ excerpt }) => excerpt === undefined), 'Only source metadata should reach the client');
  console.log(`XYVORA_BUNDLE ${label}: first ${Math.round(first)}ms, finished ${Math.round(performance.now() - start)}ms, ${count} deltas${searchQuery ? `, ${sources.length} live sources` : ''}`);
}
await check('identity', 'Who made Xyvora AI?', /Xyvora AI.*xyvora\.net.*Ethan Bennett.*Noberto Dominguez.*Elijah Richardson.*Developer.*xyvora\.net\/about/s, { source: 'skill', skill: 'about' });
await check('calculator', 'What is 18% of 84.50?', /15\.21/, { source: 'skill', skill: 'calc' });
await check('clock', '/time Tokyo', /\d{1,2}:\d{2}.*Asia\/Tokyo/, { source: 'clock', skill: 'time' });
await check('fresh engine', 'What is the capital of France? Answer in one short sentence.', /paris/i);
await check('reused context with a different request', 'What is the capital of Japan? Answer in one short sentence.', /tokyo/i);
await check('reused engine', 'What is the capital of France? Answer in one short sentence.', /paris/i);
await check('Thinker generation', 'What is the capital of France? Answer in one short sentence.', /paris/i, { mode: 'thinker' });
await check('Pro generation', 'What is the capital of Japan? Answer in one short sentence.', /tokyo/i, { mode: 'pro' });
await check('Instant generation', 'What is the capital of France? Answer in one short sentence.', /paris/i, { mode: 'instant' });
// Cancel real native generation and verify the next request on the same state.
const stop = new AbortController();
const interrupted = await api.fetch(earlyRequest(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: stop.signal,
  body: JSON.stringify({ model: DEFAULT_MODEL, messages: [{ role: 'user', content: 'Write a long fictional travel diary about a place called Orchid Ridge.' }] }),
}));
await assert.rejects(readChatEvents(interrupted.body, () => stop.abort(), true), /ended before the reply finished/);
await check('after cancellation', 'What is the capital of Japan? Answer in one short sentence.', /tokyo/i);
await check('Creative translation', '/translate Spanish: Good morning!', /buenos d[íi]as/i, { mode: 'creative' });
await check('Instant translation', '/translate Spanish: Good morning!', /buenos d[íi]as/i, { mode: 'instant' });
if (process.argv.includes('--search')) {
  lookupsAllowed = true;
  const independent = await searchWeb('unix shell tutorial', AbortSignal.timeout(7_000));
  console.log(`XYVORA_BUNDLE provider check: ${[...new Set(independent.map(({ provider }) => provider))].join(', ') || 'no results'}`);
  await check('live search', 'What is NASA’s Artemis program?', /artemis|nasa|moon/i, { searchQuery: 'NASA Artemis program', mode: 'instant' });
}
const apiRequest = (data) => earlyRequest('https://bundle-check.invalid/api/workspace', {
  method: 'POST', headers: { Origin: 'https://bundle-check.invalid', 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'api', method: 'GET', target: PUBLIC_API_EXAMPLE, ...data }),
});
if (!WORKSPACE_PLUGINS_ENABLED) {
  const response = await workspace.fetch(apiRequest({ approved: true }));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await workspace.fetch(earlyRequest('https://bundle-check.invalid/api/workspace?code=old&state=old'))).status, 404);
  console.log('XYVORA_BUNDLE plugin routes paused');
} else {
  assert.equal((await workspace.fetch(apiRequest({ approved: false }))).status, 403);
  assert.equal((await workspace.fetch(apiRequest({ approved: true, target: 'https://example.invalid/' }))).status, 400);
  if (process.argv.includes('--plugins')) {
    publicAllowed = true;
    const reply = await workspace.fetch(apiRequest({ approved: true }));
    assert.equal(reply.status, 200);
    assert.equal((await reply.json()).data.name, 'octocat/Hello-World');
    const npm = await workspace.fetch(apiRequest({ approved: true, target: 'https://registry.npmjs.org/react/latest' }));
    assert.equal(npm.status, 200);
    assert.match((await npm.json()).data.version, /^\d+\.\d+\.\d+/);
    const readRepo = (operation, data) => workspace.fetch(apiRequest({ approved: true, action: 'repository', operation, repo: 'octocat/Hello-World', ...data }));
    const overview = await readRepo('overview');
    assert.equal(overview.status, 200);
    const ref = (await overview.json()).repo.branch;
    assert.equal(ref, 'master');
    const files = await readRepo('files', { ref });
    assert.equal(files.status, 200);
    assert.ok((await files.json()).entries.some((entry) => entry.path === 'README'));
    const file = await readRepo('file', { ref, path: 'README' });
    assert.equal(file.status, 200);
    assert.match((await file.json()).file.text, /Hello World/);
    console.log('XYVORA_BUNDLE GitHub repo overview, directory/readme and API Explorer GitHub/npm reads passed');
  }
}
console.log(`XYVORA_BUNDLE peak RSS ${Math.round(process.resourceUsage().maxRSS / 1024)} MiB`);
