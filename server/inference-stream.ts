import type { ReplyMode } from '../shared/modes.ts';
import type { ChatMessage } from '../shared/models.ts';
import type { WebSource } from '../shared/search.ts';

export type Evidence = { mode?: ReplyMode; task?: 'translate'; clock?: string; sources?: WebSource[] };
export type ServerGenerate = (messages: ChatMessage[], signal: AbortSignal, onText: (text: string) => void, evidence: Evidence) => Promise<void>;

type StreamOutput = { text: (value: string) => void; sources: (value: WebSource[]) => void };

// Only explicitly safe messages from our server are forwarded to the browser.
export class InferenceError extends Error {}

export function inferenceStream(work: (signal: AbortSignal, output: StreamOutput) => Promise<void>, requestSignal: AbortSignal) {
  const encoder = new TextEncoder();
  const canceled = new AbortController();
  const deadline = AbortSignal.timeout(110_000);
  const signal = AbortSignal.any([requestSignal, canceled.signal, deadline]);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (value: string) => controller.enqueue(encoder.encode(value));
      const send = (value: object) => emit(`data: ${JSON.stringify(value)}\n\n`);
      emit(': connected\n\n');
      const heartbeat = setInterval(() => { if (!signal.aborted) emit(': waiting\n\n'); }, 10_000);
      void (async () => {
        let hasText = false;
        try {
          signal.throwIfAborted();
          await work(signal, {
            text: (text) => {
              if (signal.aborted || !text) return;
              if (text.trim()) hasText = true;
              send({ choices: [{ delta: { content: text } }] });
            },
            sources: (sources) => { if (!signal.aborted) send({ sources }); },
          });
          signal.throwIfAborted();
          if (!hasText) throw new InferenceError('The model returned an empty reply. Try rephrasing your question.');
          emit('data: [DONE]\n\n');
        } catch (error) {
          if (!canceled.signal.aborted && !requestSignal.aborted) {
            const message = deadline.aborted ? 'The model took too long to respond. Try a shorter prompt.'
              : error instanceof InferenceError ? error.message : 'The server could not respond. Try again.';
            send({ error: { message } });
          }
        } finally {
          clearInterval(heartbeat);
          if (!canceled.signal.aborted) controller.close();
        }
      })();
    },
    cancel() { canceled.abort(); },
  });
}
