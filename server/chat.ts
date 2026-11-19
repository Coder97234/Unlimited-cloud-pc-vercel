import {
  HOSTED_MODELS, isHostedModel, MAX_CONTEXT, MAX_MESSAGE, MAX_MESSAGES, MODELS, SYSTEM_PROMPT,
} from '../shared/models.ts';
import type { Availability, ChatMessage, HostedModelId } from '../shared/models.ts';
import { previewResponse } from './preview.ts';

const MAX_BODY_BYTES = 85_000;
const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-store, no-transform',
  'X-Content-Type-Options': 'nosniff',
};

class InvalidInput extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function json(value: object, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    throw new InvalidInput('Your message is too large.', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new InvalidInput('A message is required.');
  const decoder = new TextDecoder();
  let total = 0;
  let raw = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new InvalidInput('Your message is too large.', 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
    return JSON.parse(raw + decoder.decode());
  } catch (error) {
    if (error instanceof InvalidInput) throw error;
    throw new InvalidInput('Send a valid JSON chat request.');
  } finally { reader.releaseLock(); }
}

export function parseChat(input: unknown): { model: HostedModelId; messages: ChatMessage[] } {
  if (typeof input !== 'object' || input === null) throw new InvalidInput('A message is required.');
  const { model, messages } = input as { model?: unknown; messages?: unknown };
  if (!isHostedModel(model)) throw new InvalidInput('Choose a supported hosted model.');
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES || messages.length % 2 === 0) {
    throw new InvalidInput('Send a conversation ending with a user message.');
  }
  let total = 0;
  const cleaned = messages.map((message, index): ChatMessage => {
    const role = index % 2 === 0 ? 'user' : 'assistant';
    if (message?.role !== role || typeof message.content !== 'string' || !message.content.trim()) {
      throw new InvalidInput('Conversation roles or messages are invalid.');
    }
    const content = message.content.trim();
    total += content.length;
    if (content.length > MAX_MESSAGE || total > MAX_CONTEXT) throw new InvalidInput('This conversation is too long.', 413);
    return { role, content };
  });
  return { model, messages: cleaned };
}

// Best-effort guard on each function instance. A public deployment should also
// configure a project budget and an edge rate limit to enforce a shared quota.
const windowMs = 60_000;
const ipWindows = new Map<string, { until: number; used: number }>();
let globalWindow = { until: 0, used: 0 };
function mayRequest(ip: string) {
  const now = Date.now();
  if (globalWindow.until <= now) {
    globalWindow = { until: now + windowMs, used: 0 };
    for (const [key, record] of ipWindows) if (record.until <= now) ipWindows.delete(key);
  }
  if (globalWindow.used >= 90) return false;
  const record = ipWindows.get(ip) ?? { until: 0, used: 0 };
  if (record.until <= now) { record.until = now + windowMs; record.used = 0; }
  if (record.used >= 14) return false;
  record.used += 1;
  ipWindows.set(ip, record);
  globalWindow.used += 1;
  return true;
}

interface ChatOptions {
  token?: string;
  preview?: boolean;
  limit?: boolean;
  requestFetch?: typeof fetch;
}

export async function handleChat(request: Request, options: ChatOptions = {}): Promise<Response> {
  const availability: Availability = options.token ? 'hosted' : options.preview ? 'preview' : 'on-device';
  if (request.method === 'GET') return json({ availability, models: HOSTED_MODELS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
  if (request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Use the Xyvora workspace to chat.' }, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    return json({ error: 'Use application/json.' }, 415);
  }

  let input: ReturnType<typeof parseChat>;
  try { input = parseChat(await readBody(request)); }
  catch (error) {
    if (error instanceof InvalidInput) return json({ error: error.message }, error.status);
    return json({ error: 'Could not read this message.' }, 400);
  }

  if (!options.token) {
    if (!options.preview) return json({ error: 'Hosted models are not configured. Try Qwen On-device in the model picker.', code: 'HOSTED_UNAVAILABLE' }, 503);
    return new Response(previewResponse(input.messages.at(-1)!.content, input.model, request.signal), { headers: SSE_HEADERS });
  }

  const ip = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) || 'unknown';
  if (options.limit && !mayRequest(ip)) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429, { 'Retry-After': '60' });

  try {
    const upstream = await (options.requestFetch ?? fetch)(GATEWAY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODELS[input.model].gateway,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...input.messages],
        stream: true,
        max_tokens: 2_048,
        ...(input.model === 'gpt-oss' ? { reasoning_effort: 'low' } : {}),
      }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(53_000)]),
    });
    if (!upstream.ok || !upstream.body || !upstream.headers.get('content-type')?.includes('text/event-stream')) {
      const status = upstream.status;
      await upstream.body?.cancel().catch(() => undefined);
      if ([401, 402, 403, 404].includes(status)) {
        return json({ error: 'The hosted model is unavailable right now. Try a different model or switch to Qwen On-device.', code: 'HOSTED_UNAVAILABLE' }, 503);
      }
      if (status === 429) return json({ error: 'The model is busy. Try again in a moment.' }, 429);
      return json({ error: 'The model could not respond. Try again or switch models.' }, 502);
    }
    return new Response(upstream.body, { headers: SSE_HEADERS });
  } catch {
    return json({ error: 'Could not reach the model. Try again in a moment.' }, 502);
  }
}
