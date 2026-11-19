import { DEFAULT_MODEL, MAX_CONTEXT, MAX_MESSAGES, REPLY_SOURCE_HEADER } from '../shared/models.ts';
import type { Availability, ChatMessage, ReplySource } from '../shared/models.ts';
import { explicitSearchQuery, MAX_SEARCH_QUERY } from '../shared/search.ts';
import { clockReply, contextualClock, validTimeZone } from './clock.ts';
import { inferenceStream } from './inference-stream.ts';
import type { ServerGenerate } from './inference-stream.ts';
import { previewResponse } from './preview.ts';
import type { WebSearch } from './web-search.ts';

const MAX_BODY_BYTES = 85_000;
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-store, no-transform',
  'X-Content-Type-Options': 'nosniff',
};

function reply(body: ReadableStream<Uint8Array>, source: ReplySource) {
  return new Response(body, { headers: { ...SSE_HEADERS, [REPLY_SOURCE_HEADER]: source } });
}

class InvalidInput extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function json(value: object, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new InvalidInput('Your message is too large.', 413);
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

export function parseChat(input: unknown) {
  if (typeof input !== 'object' || input === null) throw new InvalidInput('A message is required.');
  const { model, messages, timeZone = 'UTC', searchQuery } = input as Record<string, unknown>;
  if (model !== DEFAULT_MODEL) throw new InvalidInput('Qwen 2.5 is the only supported model. Refresh Xyvora and try again.');
  if (!validTimeZone(timeZone)) throw new InvalidInput('Send a valid IANA time zone, or omit it to use UTC.');
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
    if (total > MAX_CONTEXT) throw new InvalidInput('This conversation is too long. Shorten your prompt or attachment and try again.', 413);
    return { role, content };
  });
  const rawQuery = searchQuery === undefined ? explicitSearchQuery(cleaned.at(-1)!.content) : searchQuery;
  let query: string | undefined;
  if (rawQuery !== undefined) {
    if (typeof rawQuery !== 'string' || rawQuery.length > MAX_SEARCH_QUERY || !rawQuery.trim()) {
      throw new InvalidInput(`Enter a web search query of 1–${MAX_SEARCH_QUERY} characters.`);
    }
    query = rawQuery.replace(/\s+/g, ' ').trim();
  }
  return { messages: cleaned, timeZone, query };
}

// Best-effort limit per function instance; this is not a shared public quota.
const windowMs = 60_000;
const ipWindows = new Map<string, { until: number; used: number; searches: number }>();
let globalWindow = { until: 0, used: 0, searches: 0 };
function mayRequest(ip: string, search: boolean) {
  const now = Date.now();
  if (globalWindow.until <= now) {
    globalWindow = { until: now + windowMs, used: 0, searches: 0 };
    for (const [key, record] of ipWindows) if (record.until <= now) ipWindows.delete(key);
  }
  if (globalWindow.used >= 90 || (search && globalWindow.searches >= 30)) return false;
  const record = ipWindows.get(ip) ?? { until: now + windowMs, used: 0, searches: 0 };
  if (record.until <= now) { record.until = now + windowMs; record.used = 0; record.searches = 0; }
  if (record.used >= 14 || (search && record.searches >= 6)) return false;
  record.used += 1;
  if (search) { record.searches += 1; globalWindow.searches += 1; }
  ipWindows.set(ip, record);
  globalWindow.used += 1;
  return true;
}

interface ChatOptions {
  preview?: boolean;
  limit?: boolean;
  generate?: ServerGenerate;
  search?: WebSearch;
  now?: () => Date;
}

export async function handleChat(request: Request, options: ChatOptions = {}): Promise<Response> {
  const availability: Availability = options.generate ? 'server' : options.preview ? 'preview' : 'unavailable';
  if (request.method === 'GET') return json({ availability, models: availability === 'unavailable' ? [] : [DEFAULT_MODEL], webSearch: !!(options.search && options.generate) });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
  if (request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Use the Xyvora workspace to chat.' }, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'Use application/json.' }, 415);

  let input: ReturnType<typeof parseChat>;
  try { input = parseChat(await readBody(request)); }
  catch (error) {
    if (error instanceof InvalidInput) return json({ error: error.message }, error.status);
    return json({ error: 'Could not read this message.' }, 400);
  }
  const prompt = input.messages.at(-1)!.content;
  const now = options.now?.() ?? new Date();
  const clock = clockReply(prompt, input.timeZone, now);
  const ip = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) || 'unknown';
  if (options.limit && !mayRequest(ip, !clock && !!input.query)) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429, { 'Retry-After': '60' });

  if (clock) return reply(inferenceStream(async (_signal, output) => { output.text(clock); }, request.signal), 'clock');

  const { generate, search } = options;
  if (input.query && (!search || !generate)) return json({ error: 'Live web search is not available in this environment.', code: 'SEARCH_UNAVAILABLE' }, 503);
  if (!generate) {
    if (options.preview) return reply(previewResponse(prompt, request.signal), 'preview');
    return json({ error: 'Qwen 2.5 is unavailable. Please try again.', code: 'MODEL_UNAVAILABLE' }, 503);
  }

  return reply(inferenceStream(async (signal, output) => {
    const sources = input.query && search ? await search(input.query, signal) : undefined;
    if (sources) {
      output.sources(sources.map(({ title, url, provider }) => ({ title, url, provider })));
      if (sources.length === 0) {
        output.text('I couldn’t find relevant web results. Try a more specific search, or turn off Web search to ask Qwen directly.');
        return;
      }
    }
    await generate(input.messages, signal, output.text, { sources, clock: contextualClock(prompt, input.timeZone, now) });
  }, request.signal), 'server');
}
