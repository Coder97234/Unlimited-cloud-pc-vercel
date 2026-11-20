import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_MODEL } from '../shared/models.ts';
import { conversationMarkdown } from '../src/lib/export-chat.ts';
import { buildMessages, forkThread, loadThreads, storeThreads } from '../src/lib/history.ts';
import type { Thread, Turn } from '../src/lib/history.ts';

function turn(id: string, prompt: string, contextOnly?: true): Turn {
  return { id, prompt, contextOnly, answers: [{ model: DEFAULT_MODEL, source: 'server', content: `Reply to ${id}`, state: 'finished' }] };
}
const first = turn('one', 'Project instructions for the assignment.');
const privateTurn = { ...turn('two', 'Private note; do not include in other turns.', true), attachment: { name: 'private.txt', text: 'Private file text' } };
const third = turn('three', 'Ordinary later prompt.');
const example: Thread = { id: 'original', mode: 'chat', updatedAt: 123, title: 'My example chat', turns: [first, privateTurn, third] };

test('a message-only send or retry contains no earlier exchanges', () => {
  for (const mode of ['normal', 'instant', 'pro'] as const) {
    assert.deepEqual(buildMessages([first], privateTurn, mode), [{ role: 'user', content: privateTurn.prompt }]);
  }
});

test('later chats skip both sides and stored files of isolated turns', () => {
  const current = { prompt: 'New question' };
  const full = buildMessages(example.turns, current);
  assert.deepEqual(full.map(({ content }) => content), [first.prompt, 'Reply to one', third.prompt, 'Reply to three', current.prompt]);
  assert.ok(!JSON.stringify(full).includes('Private file text'));
  assert.deepEqual(buildMessages([first, privateTurn], current, 'instant').map(({ content }) => content), [first.prompt, 'Reply to one', current.prompt]);
});

test('reply forks keep the selected exchange; edit forks keep only earlier prompts', () => {
  const reply = forkThread(example, 'two', 'reply', 456);
  const edit = forkThread(example, 'two', 'edit', 456);
  assert.ok(reply && edit);
  assert.notEqual(reply.id, example.id);
  assert.notEqual(reply.id, edit.id);
  assert.equal(reply.title, 'Branch · My example chat');
  assert.equal(edit.updatedAt, 456);
  assert.deepEqual(reply.turns.map(({ id }) => id), ['one', 'two']);
  assert.deepEqual(edit.turns.map(({ id }) => id), ['one']);
  assert.deepEqual(forkThread(example, 'one', 'edit')?.turns, []);
  assert.deepEqual(buildMessages(reply.turns, { prompt: 'Follow-up' }).map(({ content }) => content), [first.prompt, 'Reply to one', 'Follow-up']);
  reply.turns.pop();
  assert.deepEqual(example.turns.map(({ id }) => id), ['one', 'two', 'three']);
});

test('invalid, in-progress and archived replies do not create reply branches', () => {
  assert.equal(forkThread(example, 'unknown', 'reply'), undefined);
  assert.equal(forkThread({ ...example, mode: 'compare' }, 'one', 'edit'), undefined);
  assert.equal(forkThread({ ...example, turns: [{ ...first, answers: [{ ...first.answers[0], state: 'working' }] }] }, 'one', 'reply'), undefined);
});

test('saved message-only preference survives reload and is labeled in Markdown', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  try {
    assert.equal(storeThreads([example]), true);
    const [restored] = loadThreads();
    assert.equal(restored.turns[1].contextOnly, true);
    assert.equal(restored.turns[0].contextOnly, undefined);
    const text = conversationMarkdown(restored);
    assert.match(text, /does not use or supply previous chat context/);
    assert.doesNotMatch(text, /Private file text/);
    assert.match(text, /private.txt/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
