import type { ReplyLanguage } from '../shared/experience.ts';
import { LANGUAGES } from '../shared/experience.ts';
import { MAX_SEARCH_QUERY, normalizeSources } from '../shared/search.ts';
import type { WebSource } from '../shared/search.ts';
import { InferenceError } from './inference-stream.ts';

export type SearchService = (query: string, signal: AbortSignal, language?: ReplyLanguage) => Promise<WebSource[]>;

export function searxngSearch(env: Record<string, string | undefined>, request = fetch): SearchService | undefined {
  let endpoint: URL;
  try {
    const url = new URL(env.XYVORA_SEARXNG_URL?.trim() ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port
      || !/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]+$/.test(url.hostname) || /\.(local|localhost|internal|test|invalid|lan)$/.test(url.hostname)) return;
    endpoint = new URL(url.href.replace(/\/$/, '') + (url.pathname.replace(/\/$/, '').endsWith('/search') ? '' : '/search'));
  } catch { return; }
  const key = env.XYVORA_SEARXNG_KEY?.trim();
  if (key && (key.length > 256 || !/^[\x21-\x7e]+$/.test(key))) return;
  return async (query, signal, language) => {
    const unavailable = () => new InferenceError('Web search is unavailable. Try again shortly.');
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
    if (!query.trim() || query.length > MAX_SEARCH_QUERY) throw unavailable();
    try {
      // POST keeps the query out of the request path. The operator controls
      // this destination; neither prompts nor returned URLs are fetched.
      const body = new URLSearchParams({ q: query, format: 'json', categories: 'general', safesearch: '1', pageno: '1' });
      if (language && language !== 'auto') body.set('language', LANGUAGES[language].locale);
      const response = await request(endpoint, { method: 'POST', body, headers: { Accept: 'application/json', ...(key && { Authorization: `Bearer ${key}` }) }, redirect: 'error', cache: 'no-store', signal: deadline });
      if (!response.ok || !/^application\/json\b/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); throw unavailable(); }
      const reader = response.body?.getReader();
      if (!reader) throw unavailable();
      const decoder = new TextDecoder();
      let raw = '', bytes = 0;
      try {
        for (;;) {
          deadline.throwIfAborted();
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > 320_000) throw unavailable();
          raw += decoder.decode(next.value, { stream: true });
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      deadline.throwIfAborted();
      const { results } = JSON.parse(raw + decoder.decode()) ?? {};
      if (!Array.isArray(results)) throw unavailable();
      return normalizeSources(results.slice(0, 24).map((item) => ({ title: item?.title, url: item?.url, excerpt: item?.content, provider: 'searxng' })));
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof InferenceError) throw error;
      throw unavailable();
    }
  };
}
