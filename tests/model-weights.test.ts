import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hasExpectedSize, prepareWeights } from '../server/model-weights.ts';

const bytes = Buffer.from('verified model fixture');
const spec = { url: 'https://weights.invalid/model.gguf', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const signal = new AbortController().signal;

test('stages verified weights atomically and reuses them on subsequent builds', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'xyvora-weight-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'model.gguf');
  assert.equal(await hasExpectedSize(path, spec), false);
  await prepareWeights(spec, path, signal, async (url) => {
    assert.equal(url, spec.url);
    return new Response(bytes);
  });
  assert.equal(await hasExpectedSize(path, spec), true);
  assert.deepEqual(await readFile(path), bytes);
  await prepareWeights(spec, path, signal, async () => assert.fail('did not reuse verified weights'));
  assert.deepEqual(await readdir(directory), ['model.gguf']);
});

test('rejects a corrupt staged file and cleans up a failed replacement', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'xyvora-weight-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'model.gguf');
  const corrupt = Buffer.alloc(spec.size, 42);
  await writeFile(path, corrupt);
  await assert.rejects(prepareWeights(spec, path, signal, async () => new Response(Buffer.alloc(spec.size, 13))), /pinned checksum/);
  assert.deepEqual(await readFile(path), corrupt);
  assert.deepEqual(await readdir(directory), ['model.gguf']);
  await prepareWeights(spec, path, signal, async () => new Response(bytes));
  assert.deepEqual(await readFile(path), bytes);
});

test('refuses oversized artifacts before publishing a GGUF file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'xyvora-weight-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'model.gguf');
  await assert.rejects(prepareWeights(spec, path, signal, async () => new Response(Buffer.alloc(spec.size + 1))), /size/);
  assert.deepEqual(await readdir(directory), []);
});

test('cleans up partial weights when a download is canceled', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'xyvora-weight-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'model.gguf');
  const cancel = new AbortController();
  let open;
  const started = new Promise<void>((resolve) => { open = resolve; });
  const pending = prepareWeights(spec, path, cancel.signal, async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 4));
      open?.();
    },
  })));
  await started;
  const aborted = assert.rejects(pending, { name: 'AbortError' });
  cancel.abort();
  await aborted;
  assert.deepEqual(await readdir(directory), []);
});
