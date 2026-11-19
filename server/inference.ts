import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatHistoryItem, Llama, LlamaModel } from 'node-llama-cpp';
import { SYSTEM_PROMPT } from '../shared/models.ts';
import type { ChatMessage, ServerModelId } from '../shared/models.ts';
import { InferenceError } from './inference-stream.ts';
import { hasExpectedSize, MODEL_WEIGHTS, packagedWeightPath, prepareWeights } from './model-weights.ts';

const CONTEXT_TOKENS = 3_072;
const REPLY_TOKENS = 384;
const cache = new Map<ServerModelId, Promise<LlamaModel>>();
let llama: Promise<Llama> | undefined;
let downloadQueue: Promise<unknown> = Promise.resolve();
const active = new Set<ServerModelId>();

function loadDevelopmentModel(backend: Llama, id: ServerModelId, signal: AbortSignal) {
  // Limit scratch usage in unbundled development. Packaged models never use
  // this queue, so a cold Compare can open both weight files independently.
  const pending = downloadQueue.then(async () => {
    signal.throwIfAborted();
    const directory = await mkdtemp(join(tmpdir(), 'xyvora-'));
    try {
      const path = join(directory, 'model.gguf');
      await prepareWeights(MODEL_WEIGHTS[id], path, AbortSignal.any([signal, AbortSignal.timeout(45_000)]));
      return await backend.loadModel({ modelPath: path, gpuLayers: 0, useMmap: false, loadSignal: signal });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  downloadQueue = pending.catch(() => undefined);
  return pending;
}

function loadModel(id: ServerModelId, signal: AbortSignal): Promise<LlamaModel> {
  const existing = cache.get(id);
  if (existing) return existing;
  const pending = (async () => {
    signal.throwIfAborted();
    const path = packagedWeightPath(id);
    const packaged = await hasExpectedSize(path, MODEL_WEIGHTS[id]);
    if (!packaged && process.env.VERCEL === '1') {
      throw new Error('The function bundle is missing a verified model file');
    }
    const { getLlama, LlamaLogLevel } = await import('node-llama-cpp');
    const backend = await (llama ??= getLlama({ gpu: false, build: 'never', maxThreads: 1, logLevel: LlamaLogLevel.error })
      .catch((error: unknown) => { llama = undefined; throw error; }));
    signal.throwIfAborted();
    return packaged
      ? await backend.loadModel({ modelPath: path, gpuLayers: 0, useMmap: true, loadSignal: signal })
      : await loadDevelopmentModel(backend, id, signal);
  })().catch((error: unknown) => {
    cache.delete(id);
    if (signal.aborted) throw error;
    // Model initialization does not use prompts or credentials.
    console.error(`[xyvora] Could not initialize ${id}`, error instanceof Error ? error.message : 'Unknown error');
    throw new InferenceError('The server could not start this model. Try again or choose another model.');
  });
  cache.set(id, pending);
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
