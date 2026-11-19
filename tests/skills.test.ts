import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_MODEL, MAX_ATTACHMENT, SYSTEM_PROMPT, XYVORA_NAME, XYVORA_SITE } from '../shared/models.ts';
import { chatSearchQuery } from '../shared/search.ts';
import { isSkillId, SKILL_IDS, SKILLS } from '../shared/skill-catalog.ts';
import { runInstantSkill, workflowPrompt } from '../shared/skills.ts';
import { handleChat } from '../server/chat.ts';
import { conversationMarkdown } from '../src/lib/export-chat.ts';
import { buildMessages, loadThreads } from '../src/lib/history.ts';
import type { Thread, Turn } from '../src/lib/history.ts';
import { readChatEvents } from '../src/lib/stream.ts';

const endpoint = 'https://xyvora.invalid/api/chat';
const makeRequest = (content: string, fields: Record<string, unknown> = {}) => new Request(endpoint, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: DEFAULT_MODEL, messages: [{ role: 'user', content }], ...fields }),
});
const result = (prompt: string, attached?: string) => {
  const reply = runInstantSkill(prompt, attached);
  assert.ok(reply, `No instant tool for ${prompt}`);
  return reply.text;
};

async function read(response: Response) {
  let text = '', chunks = 0;
  await readChatEvents(response.body!, (part) => { text += part; chunks++; }, true);
  return { text, chunks };
}

test('Xyvora consistently identifies the product and host without inventing a model identity', () => {
  for (const prompt of ['/about', '  Who are you? ', 'Who exactly are you?', 'What’s your real name?', 'Who are you and what is your website?', 'What model powers you?', 'Are you ChatGPT or Xyvora AI?', 'What site are you on?', 'Please tell me about yourself.', 'Who made you?']) {
    assert.match(result(prompt), /\*\*Xyvora AI\*\*.*\[xyvora\.net\]\(https:\/\/xyvora\.net\).*\*\*Qwen 2\.5\*\*/, prompt);
    assert.equal(runInstantSkill(prompt)?.id, 'about');
  }
  for (const prompt of ['Who are you in this story? Tell me plot ideas.', 'Who created ChatGPT?', 'Rewrite “Who are you?”', '/aboutness', '/constructor', 'Is 2028-02-29 a holiday?']) assert.equal(runInstantSkill(prompt), undefined, prompt);
  assert.ok(SYSTEM_PROMPT.includes(XYVORA_NAME) && SYSTEM_PROMPT.includes(XYVORA_SITE));
  assert.match(SYSTEM_PROMPT, /Qwen 2\.5/);
  assert.equal(isSkillId('constructor'), false);
  const help = result('What can you do?');
  for (const id of SKILL_IDS) if (id !== 'about') assert.ok(help.includes(`\`/${id}\``) && help.includes(SKILLS[id].name));
});

test('bounded arithmetic evaluates precedence, real powers, decimals, and percentages without executing code', () => {
  for (const [prompt, expected] of [
    ['/calc (2 + 3) × 4', '20'], ['What is 2^3^2?', '512'], ['/calc -2^2', '-4'], ['/calc 2^-3', '0.125'],
    ['What is 0.1 + 0.2?', '0.3'], ['What is 18 percent of 84.50?', '15.21'], ['What is 72 divided by 8 plus 3?', '12'], ['/calc sqrt(81) + 18% of 84.50', '24.21'], ['/calc .5 * 8', '4'],
    ['√(16)', '4'], ['/calc (1.2e2 ÷ 3) − 10', '30'], ['/calc Pi * 2', '6.28318530718'],
  ]) assert.equal(result(prompt), `**${expected}**`, prompt);
  for (const prompt of ['/calc 1 / 0', '/calc sqrt(-1)^0', '/calc 10^10000']) assert.match(result(prompt), /finite real-number/);
  for (const prompt of ['/calc console.log(1)', '/calc 1 +', '/calc 2a + 5', `/calc ${'('.repeat(256)}1`]) assert.match(result(prompt), /couldn’t read/);
  assert.equal(runInstantSkill('2028-02-29'), undefined);
  assert.equal(runInstantSkill('Help debug this function: a + b'), undefined);
});

test('unit conversion handles absolute temperatures, cooking volumes, and mismatched dimensions', () => {
  for (const [prompt, expected] of [
    ['Convert 5 miles to km?', '5 mi = 8.04672 km'], ['What is 72 °F in C?', '72 °F = 22.2222222222 °C'],
    ['/convert 32 F to C', '32 °F = 0 °C'], ['/convert -40 C to F', '-40 °C = -40 °F'],
    ['/convert 0 K to C', '0 K = -273.15 °C'], ['/convert 2 US cups to mL', '2 US cup = 473.176473 mL'],
    ['/convert 120 km/h to m/s', '120 km/h = 33.3333333333 m/s'], ['/convert 2 hours to min', '2 h = 120 min'],
  ]) assert.equal(result(prompt), `**${expected}**`, prompt);
  assert.match(result('/convert -1 K to °F'), /below absolute zero/);
  assert.match(result('/convert 1 meter to ounce'), /same type/);
  assert.match(result('/convert 1 kilometer to unknown'), /couldn’t recognize/);
});

test('tip splitting rounds the tip once and allocates leftover cents exactly', () => {
  const split = result('/split 84.50 + 18% / 3');
  assert.match(split, /Tip: \*\*\$15\.21\*\* · Total: \*\*\$99\.71\*\*/);
  assert.match(split, /2 people pay \*\*\$33\.24\*\* and 1 person pays \*\*\$33\.23/);
  assert.match(result('/split $0.05 + 10% between 2 people'), /\*\*\$0\.03\*\* per person/);
  assert.match(result('/split 100 + 101% / 0'), /0% to 100%/);
});

test('calendar math validates dates, crosses leap days and year boundaries, and ignores DST', () => {
  assert.match(result('/date 2028-02-28 + 3 days'), /Thursday, March 2, 2028.*2028-03-02/);
  assert.match(result('What day of the week is 2028-02-29?'), /Tuesday, February 29, 2028/);
  assert.match(result('/date 2028-01-01 - 1 day'), /2027-12-31/);
  assert.match(result('How many days are there between 2026-03-07 and 2026-03-09?'), /2 days/);
  assert.match(result('/date 2027-02-29 to 2027-03-03'), /couldn’t read one/);
  assert.match(result('/date 9999-12-31 + 1 day'), /outside the supported calendar range/);
});

test('text skills support attachments, Unicode, and list cleanup without interpreting returned text as Markdown', () => {
  const text = result('/text', 'Cafe\u0301 🧑🏽‍💻\nhello');
  assert.match(text, /\*\*Words:\*\* 2/);
  assert.match(text, /characters \(including spaces\):\*\* 12/i);
  assert.match(text, /\*\*Lines:\*\* 2/);
  assert.equal(result('/case lower', 'HELLO, É!'), '```\nhello, é!\n```');
  assert.equal(result('/case upper hi\n```\nthere'), '````\nHI\n```\nTHERE\n````');
  assert.match(result('/lines unique\n pear \r\n\rAPPLE\npear\n'), /2 lines kept.*1 duplicate removed.*\npear\nAPPLE\n/s);
  assert.match(result('/lines sort', 'item 10\nitem 2\nitem 1'), /\nitem 1\nitem 2\nitem 10\n/);
  assert.match(result('/text'), /attach a text file/);
});

test('JSON formatting preserves precision, duplicate fields, escaped strings, and empty collections', () => {
  const reply = result('/json', '{"n":900719925474099312345,"n":-1e222,"s":"a\\n\\\"b","list":[{},[],null]}');
  assert.match(reply, /Valid JSON\./);
  assert.ok(reply.includes('"n": 900719925474099312345,\n  "n": -1e222'));
  assert.ok(reply.includes('"s": "a\\n\\\"b"'));
  assert.ok(reply.includes('"list": [\n    {},\n    [],\n    null\n  ]'));
  assert.match(result('/json {"n":1,}'), /isn’t valid JSON/);
  assert.match(result(`/json ${'['.repeat(25)}1${']'.repeat(25)}`), /nested more than 24 levels/);
  assert.equal(runInstantSkill('/text', 'a'.repeat(MAX_ATTACHMENT + 1)), undefined);
});

test('API tools stream one complete frame without inference, provider requests, or a server model', async () => {
  const forbidden = async () => assert.fail('A built-in skill must not call inference or search');
  const response = await handleChat(makeRequest('What is 2 + 2?'), { generate: forbidden, search: forbidden });
  assert.equal(response.headers.get('x-xyvora-source'), 'skill');
  assert.equal(response.headers.get('x-xyvora-skill'), 'calc');
  assert.deepEqual(await read(response), { text: '**4**', chunks: 1 });
  const identity = await handleChat(makeRequest('Who are you?', { searchQuery: 'must not leave the chat' }), { search: forbidden });
  assert.equal(identity.headers.get('x-xyvora-skill'), 'about');
  assert.match((await read(identity)).text, /Xyvora AI/);
  const attached = await handleChat(makeRequest('/json', { attachment: { name: 'data.json', text: '[1,2]' } }));
  assert.equal(attached.headers.get('x-xyvora-skill'), 'json');
  assert.match((await read(attached)).text, /\[\n  1,\n  2\n\]/);
  assert.equal((await handleChat(makeRequest('/text', { attachment: { name: 'data.txt', text: 'a'.repeat(MAX_ATTACHMENT) } }))).status, 200);
  assert.equal((await handleChat(makeRequest('/text', { attachment: { name: 'data.txt', text: 'a'.repeat(MAX_ATTACHMENT + 1) } }))).status, 413);
  assert.equal((await handleChat(makeRequest('/text', { attachment: { name: 'bad\nname', text: 'test' } }))).status, 400);
});

test('search is explicit; unrelated commands and identity questions cannot activate the search toggle', () => {
  for (const prompt of ['/calc 2+2', '/time Tokyo', '/skills', '/summarize my draft', 'Who are you?']) assert.equal(chatSearchQuery(prompt, true), undefined);
  assert.equal(chatSearchQuery('/search open source\nprivate attachment marker', false), 'open source');
  assert.equal(chatSearchQuery('Artemis', true), 'Artemis');
  assert.equal(chatSearchQuery('Artemis', false), undefined);
});

test('workflow commands pass one task and its material to Qwen; missing input gets immediate guidance', async () => {
  const generate = async (messages: { role: string; content: string }[], _signal: AbortSignal, onText: (text: string) => void) => {
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'user');
    assert.match(messages[0].content, /^Summarize the provided material.*\n\nAttached text file \(notes.txt\):\nAva owns the next draft\.$/s);
    onText('Ava will write the next draft.');
  };
  const response = await handleChat(makeRequest('/summarize', { searchQuery: 'never send', attachment: { name: 'notes.txt', text: 'Ava owns the next draft.' } }), {
    generate, search: async () => assert.fail('a workflow does not request a search'),
  });
  assert.equal(response.headers.get('x-xyvora-source'), 'server');
  assert.match((await read(response)).text, /Ava/);
  assert.match(result('/translate'), /target language/);
  assert.match(result('/summarize'), /Paste material/);
  assert.match(workflowPrompt('/translate French: hello'), /Translate.*French: hello/s);
  assert.equal(workflowPrompt('Normal chat'), 'Normal chat');
});

test('skill history keeps its attribution, skips private data in follow-up chat, and can be exported', (t) => {
  const turns: Turn[] = [
    { id: 'before', prompt: 'Hello', answers: [{ model: DEFAULT_MODEL, content: 'Hi!', source: 'server', state: 'finished' }] },
    { id: 'local', prompt: '/text', attachment: { name: 'private.txt', text: 'never send or export the attachment' }, answers: [{ model: DEFAULT_MODEL, source: 'skill', skill: 'text', content: '**Words:** 6', state: 'finished' }] },
  ];
  const thread: Thread = { id: 'test', title: 'Hello', mode: 'chat', updatedAt: 1, turns };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => JSON.stringify([thread]) } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); });
  const [restored] = loadThreads();
  assert.equal(restored.turns[1].answers[0].skill, 'text');
  assert.deepEqual(buildMessages(restored.turns, { prompt: 'Follow up' }), [
    { role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi!' }, { role: 'user', content: 'Follow up' },
  ]);
  const markdown = conversationMarkdown(restored);
  assert.match(markdown, /Xyvora AI\]\(https:\/\/xyvora\.net\)/);
  assert.match(markdown, /Xyvora AI · Text stats.*private\.txt|private\.txt.*Xyvora AI · Text stats/s);
  assert.doesNotMatch(markdown, /never send or export the attachment/);
});
