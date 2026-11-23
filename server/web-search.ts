import { MAX_WEB_SOURCES, normalizeSources } from '../shared/search.ts';
import type { WebSource } from '../shared/search.ts';
import { InferenceError } from './inference-stream.ts';

export type WebSearch = (query: string, signal: AbortSignal) => Promise<WebSource[]>;
export const WIKI_SEARCH_URL = 'https://en.wikipedia.org/w/rest.php/v1/search/page';
export const WIBY_SEARCH_URL = 'https://wiby.me/json/';
const MAX_RESPONSE_BYTES = 64_000;
const STOP_WORDS = new Set('a an and are can could for find from give how in is it me of on please search show tell that the to was were what when where which who why with would you your'.split(' '));

function keywords(query: string) {
  return (query.toLowerCase().replace(/['’]s\b/g, '').match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => !STOP_WORDS.has(word));
}

async function readJson(url: URL, signal: AbortSignal, requestFetch: typeof fetch) {
  const response = await requestFetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Xyvora/1.0 (https://xyvora.net; https://github.com/Coder97234/Unlimited-cloud-pc-vercel)' },
    signal, redirect: 'error',
  });
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Search endpoint could not return results');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return JSON.parse(text + decoder.decode()) as unknown;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('Search response too large');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function wikiResults(query: string, signal: AbortSignal, requestFetch: typeof fetch) {
  const url = new URL(WIKI_SEARCH_URL);
  url.search = new URLSearchParams({ q: query, limit: '3' }).toString();
  const response = await readJson(url, signal, requestFetch);
  const pages = (response as { pages?: unknown } | null)?.pages;
  if (!Array.isArray(pages)) throw new Error('Unexpected Wikipedia response');
  return normalizeSources(pages.slice(0, 3).map((page) => ({
    title: page?.title,
    url: typeof page?.key === 'string' ? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key)}` : undefined,
    excerpt: page?.excerpt || page?.description,
    provider: 'wikipedia',
  })));
}

async function wibyResults(query: string, terms: string[], signal: AbortSignal, requestFetch: typeof fetch) {
  const url = new URL(WIBY_SEARCH_URL);
  url.search = new URLSearchParams({ q: query }).toString();
  const rows = await readJson(url, signal, requestFetch);
  if (!Array.isArray(rows)) throw new Error('Unexpected Wiby response');
  return normalizeSources(rows.slice(0, 24).map((entry) => ({
    title: entry?.Title, url: entry?.URL, excerpt: entry?.Snippet || entry?.Description, provider: 'wiby',
  })).filter((result) => {
    // Wiby spans independent sites. Drop weak matches before the source cap.
    if (typeof result.excerpt !== 'string') return false;
    const title = typeof result.title === 'string' ? result.title.slice(0, 140) : '';
    const words = new Set(keywords(`${title} ${result.excerpt.slice(0, 300)}`));
    return terms.filter((term) => words.has(term)).length >= Math.min(2, terms.length);
  }));
}

export async function searchWeb(query: string, signal: AbortSignal, requestFetch = fetch): Promise<WebSource[]> {
  const terms = [...new Set(keywords(query))];
  const lookup = terms.join(' ') || query;
  const [wiki, web] = await Promise.allSettled([
    wikiResults(lookup, AbortSignal.any([signal, AbortSignal.timeout(4_000)]), requestFetch),
    wibyResults(lookup, terms, AbortSignal.any([signal, AbortSignal.timeout(2_500)]), requestFetch),
  ]);
  signal.throwIfAborted();
  if (wiki.status === 'rejected' && web.status === 'rejected') {
    throw new InferenceError('Web search is unavailable right now. Try again or turn off Web search.');
  }
  const pages = wiki.status === 'fulfilled' ? wiki.value : [];
  const related = web.status === 'fulfilled' ? web.value.slice(0, 2) : [];
  return normalizeSources([...pages.slice(0, 1), ...related, ...pages.slice(1)]).slice(0, MAX_WEB_SOURCES);
}

export const WIKI_EXTRACT_URL = 'https://en.wikipedia.org/w/api.php';

// Page text is requested from the publisher's allowlisted API, not by
// following links from search results. No arbitrary outbound URL requests.
export async function researchWeb(query: string, signal: AbortSignal, requestFetch = fetch) {
  const results = await searchWeb(query, signal, requestFetch);
  const titles = results.flatMap((source) => {
    if (source.provider !== 'wikipedia') return [];
    try {
      const url = new URL(source.url);
      if (url.origin !== 'https://en.wikipedia.org' || !url.pathname.startsWith('/wiki/')) return [];
      const title = decodeURIComponent(url.pathname.slice(6)).replace(/_/g, ' ');
      return title.length > 0 && title.length <= 160 && !/[|\x00-\x1f]/.test(title) ? [title] : [];
    } catch { return []; }
  });
  if (!titles.length) return results;
  const url = new URL(WIKI_EXTRACT_URL);
  url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', prop: 'extracts', exintro: '1', explaintext: '1', exlimit: '3', exchars: '1200', titles: titles.join('|') }).toString();
  try {
    const raw = await readJson(url, AbortSignal.any([signal, AbortSignal.timeout(4_000)]), requestFetch) as { query?: { pages?: unknown } };
    if (!Array.isArray(raw?.query?.pages)) return results;
    const pages = new Map<string, string>();
    for (const page of raw.query.pages.slice(0, 3)) {
      if (page?.missing === true || typeof page?.title !== 'string' || typeof page?.extract !== 'string' || page.extract.trim().length < 60) continue;
      pages.set(page.title.toLowerCase().replace(/ /g, '_'), page.extract);
    }
    const output = normalizeSources(results.map((source) => {
      if (source.provider !== 'wikipedia') return source;
      const slug = decodeURIComponent(new URL(source.url).pathname.slice(6)).toLowerCase().replace(/ /g, '_');
      const excerpt = pages.get(slug);
      return excerpt ? { ...source, excerpt, evidence: 'retrieved' } : source;
    }));
    return output.sort((a, b) => Number(b.evidence === 'retrieved') - Number(a.evidence === 'retrieved'));
  } catch (error) {
    signal.throwIfAborted();
    return results; // The UI still marks these as search snippets, not fetched pages.
  }
}
