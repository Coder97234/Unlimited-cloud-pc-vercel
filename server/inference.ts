import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { ChatHistoryItem, Llama, LlamaModel } from 'node-llama-cpp';
import { SYSTEM_PROMPT } from '../shared/models.ts';
import type { ChatMessage, ServerModelId } from '../shared/models.ts';
import { InferenceError } from './inference-stream.ts';

// Public Apache-2.0 chat models. Only the function fetches these weights. Pin the
// revision, exact size and SHA-256 before opening the files with the native reader.
const weights = {
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
} satisfies Record<ServerModelId, { url: string; size: number; sha256: string }>;

const CONTEXT_TOKENS = 3_072;
const REPLY_TOKENS = 384;
const cache = new Map<ServerModelId, Promise<LlamaModel>>();
let llama: Promise<Llama> | undefined;
let loading: Promise<unknown> = Promise.resolve();
const active = new Set<ServerModelId>();

async function downloadWeights(id: ServerModelId, path: string, signal: AbortSignal) {
  const preset = weights[id];
  const response = await fetch(preset.url, { signal });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Weights download returned HTTP ${response.status}`);
  }
  let size = 0;
  const hash = createHash('sha256');
  const verify = new Transform({ transform(chunk: Buffer, _encoding, done) {
    size += chunk.length;
    if (size > preset.size) { done(new Error('Unexpected weights size')); return; }
    hash.update(chunk);
    done(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), verify, createWriteStream(path, { flags: 'wx' }), { signal });
  if (size !== preset.size || hash.digest('hex') !== preset.sha256) throw new Error('Weights do not match the pinned checksum');
}

function loadModel(id: ServerModelId, signal: AbortSignal): Promise<LlamaModel> {
  const existing = cache.get(id);
  if (existing) return existing;
  // Vercel scratch space fits either file, not both. Load one at a time into
  // memory without mmap, delete its download, and reuse the warm model.
  const pending = loading.then(async () => {
    signal.throwIfAborted();
    let stage = 'runtime';
    let directory: string | undefined;
    try {
      const { getLlama, LlamaLogLevel } = await import('node-llama-cpp');
      const backend = await (llama ??= getLlama({ gpu: false, build: 'never', maxThreads: 1, logLevel: LlamaLogLevel.error })
        .catch((error: unknown) => { llama = undefined; throw error; }));
      stage = 'download';
      directory = await mkdtemp(join(tmpdir(), 'xyvora-'));
      const path = join(directory, 'model.gguf');
      await downloadWeights(id, path, AbortSignal.any([signal, AbortSignal.timeout(45_000)]));
      stage = 'weights';
      return await backend.loadModel({ modelPath: path, gpuLayers: 0, useMmap: false, loadSignal: signal });
    } catch (error) {
      if (signal.aborted) throw error;
      // No prompts or credentials are used during initialization.
      console.error(`[xyvora] Could not initialize ${id} (${stage})`, error instanceof Error ? error.message : 'Unknown error');
      throw new InferenceError('The server could not start this model. Try again or choose another model.');
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }).catch((error: unknown) => { cache.delete(id); throw error; });
  cache.set(id, pending);
  loading = pending.catch(() => undefined);
  return pending;
}

export async function generateOnServer(id: ServerModelId, messages: ChatMessage[], signal: AbortSignal, onText: (text: string) => void) {
  if (active.has(id)) throw new InferenceError('This model is busy. Wait a moment and try again.');
  active.add(id);
  try {
    const model = await loadModel(id, signal);
    signal.throwIfAborted();
    const { LlamaChat, ChatMLChatWrapper } = await import('node-llama-cpp');
    const chatWrapper = new ChatMLChatWrapper();
    const history: ChatHistoryItem[] = [
      { type: 'system', text: SYSTEM_PROMPT },
      ...messages.map((message): ChatHistoryItem => message.role === 'user'
        ? { type: 'user', text: message.content }
        : { type: 'model', response: [message.content] }),
      { type: 'model', response: [] },
    ];
    // Keep the current question and discard older pairs if their token count
    // would leave too little space for a reply. Do not silently cut the prompt.
    while (chatWrapper.generateContextState({ chatHistory: history }).contextText.tokenize(model.tokenizer).length
      > CONTEXT_TOKENS - REPLY_TOKENS - 16) {
      if (history.length <= 3) throw new InferenceError('This message is too long for this model. Shorten your prompt or attachment and try again.');
      history.splice(1, 2);
    }
    const context = await model.createContext({ contextSize: CONTEXT_TOKENS, batchSize: 256, threads: 1, createSignal: signal });
    try {
      const chat = new LlamaChat({ contextSequence: context.getSequence(), chatWrapper });
      try {
        await chat.generateResponse(history, { signal, onTextChunk: onText, maxTokens: REPLY_TOKENS, temperature: 0.4 });
      } finally { chat.dispose(); }
    } finally { await context.dispose(); }
  } finally { active.delete(id); }
}
