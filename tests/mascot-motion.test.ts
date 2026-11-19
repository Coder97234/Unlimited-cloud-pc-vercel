import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasCompletedWord, typedCompletedWord } from '../src/lib/mascot-motion.ts';

test('mascot reacts to word boundaries, not to SSE fragments or old words', () => {
  assert.equal(hasCompletedWord('Par', 0), false);
  assert.equal(hasCompletedWord('Paris', 3), false);
  assert.equal(hasCompletedWord('Paris is', 5), true);
  assert.equal(hasCompletedWord('Paris is', 8), false);
  assert.equal(hasCompletedWord('Paris is', 8, true), true);
  assert.equal(hasCompletedWord('Paris is.', 9, true), false);
  assert.equal(hasCompletedWord('Paris is capitals', 30, true), false);
  assert.equal(hasCompletedWord('Paris 🌙 ', 8), false);
  const oldText = `${'Old words. '.repeat(200)}Fin`;
  assert.equal(hasCompletedWord(`${oldText}!`, oldText.length), true);
});

test('composer uses real edits at the caret and committed multilingual words', () => {
  assert.equal(typedCompletedWord('bonjou', 'bonjour'), false);
  assert.equal(typedCompletedWord('bonjour', 'bonjour '), true);
  assert.equal(typedCompletedWord('hello world', 'hello, world', 6), true);
  assert.equal(typedCompletedWord('hello world', 'hello  world', 7), false);
  assert.equal(typedCompletedWord('existing', 'existing', 4, true), false);
  assert.equal(typedCompletedWord('', '你好', 2, true), true);
  assert.equal(typedCompletedWord('cafe', 'café '), true);
});
