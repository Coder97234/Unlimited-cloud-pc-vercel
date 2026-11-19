export class ToolError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export type JsonObject = Record<string, unknown>;
export const asObject = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
export const shortText = (value: unknown, max = 240) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, max) : '';

export async function boundedJson(message: Request | Response, maxBytes: number): Promise<unknown> {
  if (Number(message.headers.get('content-length')) > maxBytes) {
    await message.body?.cancel().catch(() => undefined);
    throw new ToolError('The data is too large.', 413);
  }
  const reader = message.body?.getReader();
  if (!reader) throw new ToolError('Expected JSON data.');
  const decoder = new TextDecoder();
  let raw = '', size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(raw + decoder.decode());
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ToolError('The data is too large.', 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

export async function providerJson(url: string, signal: AbortSignal, options: RequestInit = {}, { limit = 128_000, timeout = 9_000 }: { limit?: number; timeout?: number } = {}) {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  try {
    const response = await fetch(url, { ...options, headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      // Don't reflect third-party error bodies, which can include account data.
      if (response.status === 401 || response.status === 403) throw new ToolError('The provider did not grant access. Check the connection and read permissions.', response.status);
      if (response.status === 404) throw new ToolError('The provider could not find that resource.', 404);
      if (response.status === 429) throw new ToolError('The provider is rate limiting requests. Try later.', 429);
      throw new ToolError('The provider could not complete the request.', 502);
    }
    if (!/^application\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel().catch(() => undefined);
      throw new ToolError('The provider did not return JSON.', 502);
    }
    return asObject(await boundedJson(response, limit));
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError('The provider could not be reached or returned invalid data.', 502);
  }
}
