import { REPLY_SOURCE_HEADER } from '../../shared/models.ts';
import type { ChatMessage, ModelId, ReplySource } from '../../shared/models.ts';

export class ChatError extends Error {}

export async function readChatEvents(body: ReadableStream<Uint8Array>, onText: (delta: string) => void, showServerError = false) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;
  let finish = false;
  const consume = (raw: string) => {
    const data = raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') { ended = true; return; }
    let payload: { error?: unknown; choices?: { delta?: { content?: unknown }; finish_reason?: string }[] };
    try { payload = JSON.parse(data); }
    catch { throw new ChatError('The model sent an unreadable response. Try again.'); }
    const choice = payload?.choices?.[0];
    if (payload?.error || choice?.finish_reason === 'error') {
      const message = (payload?.error as { message?: unknown } | undefined)?.message;
      throw new ChatError(showServerError && typeof message === 'string' ? message : 'The model hit an error while responding. Try again.');
    }
    if (choice?.finish_reason) finish = true;
    if (typeof choice?.delta?.content === 'string') onText(choice.delta.content);
  };
  try {
    while (!ended) {
      const { done, value } = await reader.read();
      if (done) { buffer += decoder.decode(); if (buffer.trim()) consume(buffer); break; }
      buffer += decoder.decode(value, { stream: true });
      let separator: RegExpExecArray | null;
      while (!ended && (separator = /\r?\n\r?\n/.exec(buffer))) {
        consume(buffer.slice(0, separator.index));
        buffer = buffer.slice(separator.index + separator[0].length);
      }
      if (buffer.length > 100_000) throw new ChatError('The model sent an unreadable response. Try again.');
    }
    if (!ended && !finish) throw new ChatError('The connection ended before the reply finished. You can try again.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function streamChat(
  model: ModelId, messages: ChatMessage[], signal: AbortSignal,
  onText: (delta: string) => void, onSource: (source: ReplySource) => void,
) {
  const response = await fetch('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages }), signal,
  });
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await response.json().catch(() => null);
    throw new ChatError(typeof data?.error === 'string' ? data.error : 'The chat server could not respond. Try again.');
  }
  const source = response.headers.get(REPLY_SOURCE_HEADER);
  if (source === 'server' || source === 'hosted' || source === 'preview') onSource(source);
  await readChatEvents(response.body, onText, source === 'server');
}
