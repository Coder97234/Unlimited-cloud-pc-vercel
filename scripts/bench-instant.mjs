import assert from 'node:assert/strict';
import { readChatEvents } from '../src/lib/stream.ts';

const target = process.argv[2];
if (!target) throw new Error('Pass --bundle (with verified model weights staged) or the site’s HTTPS origin.');
const bundled = target === '--bundle' ? (await import('../api/chat.js')).default : undefined;
const url = new URL('/api/chat', bundled ? 'https://bundle-check.invalid' : target);
if (bundled) globalThis.fetch = async () => { throw new Error('Unexpected outbound request in the bundled benchmark'); };
const invoke = (request) => bundled ? bundled.fetch(request) : fetch(request);
const question = 'What is the capital of Japan? Answer in one short sentence.';
const rows = Array.from({ length: 23 }, (_, i) => `Record ${i + 1} | product: sample ${i + 101} | count: ${i * 13} | status: available`).join('\n');
const history = [
  { role: 'user', content: `This is a fictional inventory for a classroom exercise.\n${rows}` },
  { role: 'assistant', content: 'I noted the sample inventory.' },
  { role: 'user', content: 'Is this real inventory?' },
  { role: 'assistant', content: 'No, it is fictional practice data.' },
];

async function sample(label, mode, preceding) {
  const started = performance.now();
  const response = await invoke(new Request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [...preceding, { role: 'user', content: question }], mode }),
    signal: AbortSignal.timeout(30_000),
  }));
  assert.equal(response.status, 200, `${label}: HTTP ${response.status}`);
  assert.equal(response.headers.get('x-xyvora-source'), 'server');
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/i);
  let first, text = '', deltas = 0;
  await readChatEvents(response.body, (delta) => {
    if (delta.trim()) first ??= performance.now() - started;
    text += delta; deltas++;
  }, true);
  const done = performance.now() - started;
  assert.match(text, /tokyo/i);
  assert.ok(Number.isFinite(first));
  console.log(`XYVORA_INSTANT ${label} ${mode}: first=${Math.round(first)}ms done=${Math.round(done)}ms, ${deltas} deltas, ${text.length} chars`);
  return { first, done };
}

await sample(bundled ? 'fresh-engine' : 'warm-up', 'normal', []);
const median = (items, key) => Math.round(items.map((item) => item[key]).sort((a, b) => a - b)[1]);
for (const [label, preceding] of [['new-chat', []], ['older-context', history]]) {
  const samples = { normal: [], instant: [] };
  for (const order of [['normal', 'instant'], ['instant', 'normal'], ['normal', 'instant']]) {
    for (const mode of order) samples[mode].push(await sample(label, mode, preceding));
  }
  for (const [mode, measurements] of Object.entries(samples)) {
    console.log(`XYVORA_INSTANT ${label} ${mode}: median first/done ${median(measurements, 'first')}/${median(measurements, 'done')} ms (3 requests)`);
  }
}
