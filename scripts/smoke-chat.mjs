import { isHelioModelId } from '../shared/experience.ts';
import { MODE_IDS } from '../shared/modes.ts';
import assert from 'node:assert/strict';
import { readChatEvents } from '../src/lib/stream.ts';
import { ASSISTANT_PROFILE, DEFAULT_MODEL } from '../shared/models.ts';
import { SKILL_IDS } from '../shared/skill-catalog.ts';

const target = process.argv[2];
if (!target) throw new Error('Pass the origin to smoke-test (for example, https://xyvora.net).');
const benchmark = process.argv.includes('--benchmark');
const url = new URL('/api/chat', target);
const status = await fetch(url, { signal: AbortSignal.timeout(10_000) });
assert.ok(status.ok, `Chat status returned HTTP ${status.status}`);
const capability = await status.json();
assert.deepEqual(capability.assistant, ASSISTANT_PROFILE);
assert.equal(capability.availability, 'server');
assert.ok(capability.models.includes(DEFAULT_MODEL) && capability.models.every(isHelioModelId));
assert.ok(!capability.sampleModels?.includes(DEFAULT_MODEL), 'The live smoke expects a real bundled model, not a sample');
assert.deepEqual(capability.modes, MODE_IDS);
assert.deepEqual(capability.skills, SKILL_IDS.filter((skill) => skill !== 'search' || capability.webSearch));

async function check(label, content, expected, { timeZone, searchQuery, source = 'server', skill } = {}) {
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: DEFAULT_MODEL, messages: [{ role: 'user', content }], timeZone, searchQuery }),
    signal: AbortSignal.timeout(125_000),
  });
  assert.ok(response.ok, `${label} returned HTTP ${response.status}`);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.equal(response.headers.get('x-xyvora-source'), source);
  if (skill) assert.equal(response.headers.get('x-xyvora-skill'), skill);
  let text = '';
  let chunks = 0;
  let firstText;
  let lastText;
  let firstSource;
  let sources = [];
  await readChatEvents(response.body, (delta) => {
    if (!delta) return;
    const now = performance.now() - startedAt;
    if (delta.trim()) firstText ??= now;
    lastText = now;
    chunks++;
    text += delta;
  }, true, (value) => { firstSource ??= performance.now() - startedAt; sources = value; });
  assert.ok(chunks >= (source === 'server' ? 2 : 1) && firstText !== undefined, `${label} did not stream text`);
  assert.match(text, expected, `${label} did not answer the smoke prompt`);
  if (searchQuery) assert.ok(sources.some(({ url, title }) => /^https:\/\//.test(url) && /artemis/i.test(title)), 'No relevant Artemis source returned from the web');
  else assert.equal(sources.length, 0);
  const ms = Math.round;
  console.log(`XYVORA_LIVE ${label} first=${ms(firstText)}ms done=${ms(performance.now() - startedAt)}ms stream=${ms(lastText - firstText)}ms chars=${text.length} deltas=${chunks}${searchQuery ? ` sources=${sources.length} at=${ms(firstSource)}ms` : ''}`);
}

for (let i = 0; i < (benchmark ? 5 : 1); i++) {
  await check(`short-${i + 1}`, 'What is the capital of France? Answer in one short sentence.', /paris/i);
}
if (benchmark) {
  await check('long', 'Give five practical tips for packing light for a weekend trip. Use a numbered list with one sentence per tip.', /pack|wear|layer|cloth/i);
}
await check('identity', 'Who are you?', /Xyvora AI.*xyvora\.net/, { source: 'skill', skill: 'about' });
await check('calculator', 'What is 18% of 84.50?', /15\.21/, { source: 'skill', skill: 'calc' });
await check('clock', '/time', /\d{1,2}:\d{2}.*America\/Chicago/, { timeZone: 'America/Chicago', source: 'clock', skill: 'time' });
if (capability.webSearch) await check('search', 'What is NASA’s Artemis program?', /artemis|nasa|moon/i, { searchQuery: 'NASA Artemis program' });
else console.log('XYVORA_LIVE search skipped: SearXNG is not configured.');
