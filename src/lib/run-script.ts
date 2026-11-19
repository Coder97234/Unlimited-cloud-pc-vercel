import type { ScriptOutput } from './sandbox-engine.ts';

export function runScript(code: string, input: string, signal: AbortSignal): Promise<ScriptOutput> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./script-worker.ts', import.meta.url), { type: 'module' });
    const cancel = () => { cleanup(); reject(signal.reason); };
    const timeout = window.setTimeout(() => {
      cleanup(); resolve({ ok: false, output: 'Stopped: the sandbox took too long to start or run.' });
    }, 8_000);
    const cleanup = () => { worker.terminate(); clearTimeout(timeout); signal.removeEventListener('abort', cancel); };
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }: MessageEvent<ScriptOutput>) => { cleanup(); resolve(data); };
    worker.onerror = () => { cleanup(); resolve({ ok: false, output: 'The browser could not launch Script Lab.' }); };
    worker.postMessage({ code, input });
  });
}
