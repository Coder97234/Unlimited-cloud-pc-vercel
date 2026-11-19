import { MAX_WEB_SOURCES, normalizeSources } from '../shared/search.ts';
import type { WebSource } from '../shared/search.ts';
import { InferenceError } from './inference-stream.ts';

export type WebSearch = (query: string, signal: AbortSignal) => Promise<WebSource[]>;
export const SEARCH_ENDPOINT = 'https://api.keenable.ai/v1/search/public';

export async function searchWeb(query: string, signal: AbortSignal, requestFetch = fetch): Promise<WebSource[]> {
  const deadline = AbortSignal.timeout(6_000);
  try {
    const result = await requestFetch(SEARCH_ENDPOINT, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Keenable-Title': 'Xyvora' },
      body: JSON.stringify({ query, max_results: MAX_WEB_SOURCES, snippet_max_length: 300 }),
      signal: AbortSignal.any([signal, deadline]),
    });
    if (!result.ok || Number(result.headers.get('content-length')) > 64_000) {
      await result.body?.cancel().catch(() => undefined);
      if (result.status === 429) throw new InferenceError('Web search is at its rate limit. Try again in a moment.');
      throw new Error(`Search provider returned HTTP ${result.status}`);
    }
    const data: unknown = await result.json();
    const results = (data as { results?: unknown } | null)?.results;
    if (!Array.isArray(results)) throw new Error('Unexpected search response');
    return normalizeSources(results.slice(0, 24).map((entry) => ({
      title: entry?.title, url: entry?.url, excerpt: entry?.snippet || entry?.description,
    })));
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof InferenceError) throw error;
    throw new InferenceError(deadline.aborted
      ? 'Web search took too long. Try again or turn off Web search.'
      : 'Web search is unavailable right now. Try again or turn off Web search.');
  }
}
