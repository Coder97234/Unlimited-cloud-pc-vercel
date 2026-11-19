import type { ChatMessage, ServerModelId } from '../shared/models.ts';

export type ServerGenerate = (model: ServerModelId, messages: ChatMessage[], signal: AbortSignal, onText: (text: string) => void) => Promise<void>;

// Only explicitly safe messages from our server are forwarded to the browser.
export class InferenceError extends Error {}

export function inferenceStream(generate: ServerGenerate, id: ServerModelId, messages: ChatMessage[], requestSignal: AbortSignal) {
  const encoder = new TextEncoder();
  const canceled = new AbortController();
  const deadline = AbortSignal.timeout(110_000);
  const signal = AbortSignal.any([requestSignal, canceled.signal, deadline]);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (value: string) => controller.enqueue(encoder.encode(value));
      // Send headers before model startup, and keep the connection open on a cold start.
      emit(': connected\n\n');
      const heartbeat = setInterval(() => { if (!signal.aborted) emit(': waiting\n\n'); }, 10_000);
      void (async () => {
        let hasText = false;
        try {
          signal.throwIfAborted();
          await generate(id, messages, signal, (text) => {
            if (!signal.aborted && text) {
              if (text.trim()) hasText = true;
              emit(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
            }
          });
          signal.throwIfAborted();
          if (!hasText) throw new InferenceError('The model returned an empty reply. Try rephrasing your question.');
          emit('data: [DONE]\n\n');
        } catch (error) {
          if (!canceled.signal.aborted && !requestSignal.aborted) {
            const message = deadline.aborted ? 'The model took too long to respond. Try a shorter prompt.'
              : error instanceof InferenceError ? error.message : 'The server model could not respond. Try again.';
            emit(`data: ${JSON.stringify({ error: { message } })}\n\n`);
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
