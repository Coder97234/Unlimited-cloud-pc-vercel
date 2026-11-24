import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

export type WeightSpec = { url: string; size: number; sha256: string };

// Apache-2.0 Qwen 2.5 0.5B Instruct, compact Q4_0 GGUF by bartowski.
export const MODEL_WEIGHT = {
  url: 'https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/41ba88dbac95fed2528c92514c131d73eb5a174b/Qwen2.5-0.5B-Instruct-Q4_0.gguf',
  size: 352_972_352,
  sha256: 'c8cd5f37dd1235fb010c45316d4ff8af875e1a4e0ff368b4bf6cacb9053d4919',
} satisfies WeightSpec;

export function packagedWeightPath() {
  return join(process.cwd(), 'build', 'models', 'qwen-lite.gguf');
}

export async function hasExpectedSize(path: string, spec: WeightSpec) {
  try {
    const info = await stat(path);
    return info.isFile() && info.size === spec.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function isVerified(path: string, spec: WeightSpec, signal: AbortSignal) {
  if (!await hasExpectedSize(path, spec)) return false;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest('hex') === spec.sha256;
}

// Write to a temporary sibling and rename only after verification. A failed or
// canceled download never replaces the last good file or leaves a partial GGUF.
export async function prepareWeights(spec: WeightSpec, destination: string, signal: AbortSignal, requestFetch = fetch) {
  signal.throwIfAborted();
  if (await isVerified(destination, spec, signal)) return;
  const folder = dirname(destination);
  await mkdir(folder, { recursive: true });
  const scratch = await mkdtemp(join(folder, '.download-'));
  const partial = join(scratch, 'model.partial');
  try {
    const response = await requestFetch(spec.url, { signal });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Weights download returned HTTP ${response.status}`);
    }
    const hash = createHash('sha256');
    let size = 0;
    const verify = new Transform({ transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > spec.size) { done(new Error('Unexpected weights size')); return; }
      hash.update(chunk);
      done(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), verify, createWriteStream(partial, { flags: 'wx' }), { signal });
    if (size !== spec.size || hash.digest('hex') !== spec.sha256) {
      throw new Error('Weights do not match the pinned checksum');
    }
    signal.throwIfAborted();
    await rename(partial, destination);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
