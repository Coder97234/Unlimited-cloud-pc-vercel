import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { ServerModelId } from '../shared/models.ts';

export type WeightSpec = { url: string; size: number; sha256: string };

// Public Apache-2.0 models. Keep the exact same weights for local and hosted CPU
// inference, and verify the pinned bytes before adding them to a deployment.
export const MODEL_WEIGHTS = {
  'qwen-lite': {
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/9217f5db79a29953eb74d5343926648285ec7e67/qwen2.5-0.5b-instruct-q4_0.gguf',
    size: 428_730_208,
    sha256: '7671c0c304e6ce5a7fc577bcb12aba01e2c155cc2efd29b2213c95b18edaf6ed',
  },
  smollm: {
    url: 'https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/ab928a97ee49f3a015f35194879f68211291d6ca/SmolLM2-360M-Instruct-Q4_K_M.gguf',
    size: 270_590_880,
    sha256: '2fa3f013dcdd7b99f9b237717fa0b12d75bbb89984cc1274be1471a465bac9c2',
  },
} satisfies Record<ServerModelId, WeightSpec>;

export function packagedWeightPath(id: ServerModelId) {
  return join(process.cwd(), 'build', 'models', `${id}.gguf`);
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
  const partial = join(scratch, 'model.gguf');
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
