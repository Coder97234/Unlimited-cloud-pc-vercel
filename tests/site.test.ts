import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_MODEL, SYSTEM_PROMPT } from '../shared/models.ts';
import { ABOUT_URL, TEAM, TEAM_NAME } from '../shared/site.ts';
import { chatSearchQuery } from '../shared/search.ts';
import { runInstantSkill } from '../shared/skills.ts';
import { handleChat, parseChat } from '../server/chat.ts';
import { RESPONSE_PROFILES } from '../server/mode-settings.ts';
import { buildMessages } from '../src/lib/history.ts';
import type { Turn } from '../src/lib/history.ts';
import { readChatEvents } from '../src/lib/stream.ts';

const user = (content: string) => ({ role: 'user' as const, content });
const assistant = (content: string) => ({ role: 'assistant' as const, content });
const oldPair = [user('An older question'), assistant('An older answer')];
const lastPair = [user('A recent question'), assistant('A recent answer')];
const last = user('The latest question');
const messages = [...oldPair, ...lastPair, last];

test('Instant bounds previous exchanges and the reply limit without changing Normal defaults', async () => {
  assert.equal(parseChat({ messages }).mode, 'normal');
  assert.deepEqual(parseChat({ messages }).messages, messages);
  assert.deepEqual(parseChat({ messages, mode: 'instant' }).messages, [...lastPair, last]);
  assert.deepEqual(parseChat({ messages: [...oldPair, user('x'.repeat(1_200)), lastPair[1], last], mode: 'instant' }).messages, [last]);
  assert.throws(() => parseChat({ messages: [assistant('invalid'), ...messages.slice(1)], mode: 'instant' }), /roles/);
  assert.ok(RESPONSE_PROFILES.instant.maxTokens < RESPONSE_PROFILES.normal.maxTokens / 2);
  assert.equal(RESPONSE_PROFILES.instant.temperature, 0);
  const res = await handleChat(new Request('https://xyvora.invalid/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'instant', messages, attachment: { name: 'fixture.txt', text: 'Latest document' } }),
  }), { generate: async (context, _, emit, evidence) => {
    assert.equal(evidence.mode, 'instant');
    assert.deepEqual(context.slice(0, -1), lastPair);
    assert.match(context.at(-1)!.content, /The latest question.*Latest document/s);
    emit('A quick reply.');
  } });
  let reply = '';
  await readChatEvents(res.body!, (text) => { reply += text; }, true);
  assert.equal(reply, 'A quick reply.');
});

test('Instant client sends only the latest eligible exchange, never archived or local tool output', () => {
  const turns: Turn[] = [oldPair, lastPair].map(([question, answer], i) => ({
    id: String(i), prompt: question.content, answers: [{ model: DEFAULT_MODEL, content: answer.content, state: 'finished', source: 'server' }],
  }));
  turns.push({ id: 'tool', prompt: '/text private data', answers: [{ model: DEFAULT_MODEL, source: 'skill', content: 'Local result', state: 'finished' }] });
  assert.deepEqual(buildMessages(turns, { prompt: last.content }, 'instant'), [...lastPair, last]);
  assert.deepEqual(buildMessages(turns, { prompt: last.content }), messages);
});

test('team credits come from Xyvora, are linked, and do not trigger external search', () => {
  for (const prompt of ['Who made you?', 'Who made Xyvora AI?', 'Who designed Xyvora?', 'Who is your founder?', 'Who is Ethan Bennett?', "What's Noberto Dominguez’s role at Xyvora?", 'Meet the Xyvora team', '/team', '/about']) {
    const result = runInstantSkill(prompt);
    assert.equal(result?.id, 'about', prompt);
    assert.ok(result!.text.includes(TEAM_NAME) && result!.text.includes(ABOUT_URL), prompt);
    for (const { name, role } of TEAM) {
      assert.ok(result!.text.includes(name) && result!.text.includes(role), prompt);
      assert.ok(SYSTEM_PROMPT.includes(name) && SYSTEM_PROMPT.includes(role));
    }
    assert.equal(chatSearchQuery(prompt, true), undefined, prompt);
  }
  assert.equal(runInstantSkill('Who founded a different company?'), undefined);
});
