export const MAX_SEARCH_QUERY = 350;
export const MAX_WEB_SOURCES = 4;
export const SEARCH_PROVIDER = 'Keenable';
export type WebSource = { title: string; url: string; excerpt?: string };

export function explicitSearchQuery(prompt: string): string | undefined {
  const line = prompt.trim().split(/\r?\n/, 1)[0];
  return /^(?:\/search(?:\s+|$)|(?:please\s+)?search (?:the web|online) for\s+)(.*)$/i.exec(line)?.[1].trim();
}

function cleanText(value: unknown, limit: number) {
  return typeof value === 'string'
    ? value.slice(0, 8_000).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, limit)
    : '';
}

// Validate sources at both the HTTP boundary and on restoration from history.
// Titles/snippets are always displayed as text, and result URLs are never fetched.
export function normalizeSources(input: unknown): WebSource[] {
  if (!Array.isArray(input)) return [];
  const results: WebSource[] = [];
  const seen = new Set<string>();
  for (const raw of input.slice(0, 24)) {
    if (raw === null || typeof raw !== 'object') continue;
    const { title, url, excerpt } = raw as Record<string, unknown>;
    if (typeof url !== 'string' || url.length > 2_048) continue;
    try {
      const link = new URL(url);
      if ((link.protocol !== 'https:' && link.protocol !== 'http:') || link.username || link.password) continue;
      link.hash = '';
      if (seen.has(link.href)) continue;
      seen.add(link.href);
      results.push({ title: cleanText(title, 140) || link.hostname, url: link.href, excerpt: cleanText(excerpt, 300) || undefined });
      if (results.length === MAX_WEB_SOURCES) break;
    } catch { /* Ignore invalid URLs. */ }
  }
  return results;
}
