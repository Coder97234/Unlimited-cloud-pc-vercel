import type { MLCEngineInterface } from '@mlc-ai/web-llm';
import { SYSTEM_PROMPT } from '../../shared/models.ts';
import type { ChatMessage } from '../../shared/models.ts';
import { ChatError } from './stream.ts';

const modelId = 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC';
let loadedEngine: MLCEngineInterface | undefined;

async function getEngine(signal: AbortSignal, onProgress: (progress: number) => void) {
  if (loadedEngine) return loadedEngine;
  if (!globalThis.isSecureContext || !('gpu' in navigator) || !navigator.gpu) {
    throw new ChatError('On-device chat needs WebGPU. Try a recent Chrome or Edge with hardware acceleration enabled, or choose a hosted model.');
  }
  const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
  signal.throwIfAborted();
  const worker = new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' });
  let stop: (() => void) | undefined;
  try {
    onProgress(0);
    const abort = new Promise<never>((_, reject) => {
      stop = () => { worker.terminate(); reject(signal.reason); };
      signal.addEventListener('abort', stop, { once: true });
    });
    const failed = new Promise<never>((_, reject) => {
      worker.addEventListener('error', () => reject(new Error('Model worker failed.')), { once: true });
    });
    loadedEngine = await Promise.race([
      CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: ({ progress }) => onProgress(Math.round(progress * 100)),
      }),
      abort,
      failed,
    ]);
    return loadedEngine;
  } catch {
    worker.terminate();
    signal.throwIfAborted();
    throw new ChatError('The browser could not load the model. Check that WebGPU is available, free some memory, and try again.');
  } finally { if (stop) signal.removeEventListener('abort', stop); }
}

export async function streamDevice(messages: ChatMessage[], signal: AbortSignal,
  onText: (delta: string) => void, onProgress: (progress: number | null) => void) {
  if (messages.at(-1)!.content.length > 5_000) throw new ChatError('Use fewer than 5,000 characters with the on-device model.');
  const engine = await getEngine(signal, onProgress);
  signal.throwIfAborted();
  onProgress(null);
  const interrupt = () => engine.interruptGenerate();
  signal.addEventListener('abort', interrupt, { once: true });
  try {
    const chunks = await engine.chat.completions.create({
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      stream: true, max_tokens: 720,
    });
    for await (const chunk of chunks) {
      const text = chunk.choices[0]?.delta.content;
      if (!signal.aborted && text) onText(text);
    }
    signal.throwIfAborted();
  } finally { signal.removeEventListener('abort', interrupt); }
}
