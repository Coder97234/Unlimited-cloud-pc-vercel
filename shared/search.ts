import { mentionsCreator } from './creator-policy.ts';
import { workspaceIntent } from './workspace-tools.ts';
import { directInfoSkill, readSkillCommand } from './skill-catalog.ts';

export const MAX_SEARCH_QUERY = 350;
export const MAX_WEB_SOURCES = 4;
export type WebSource = { title: string; url: string; excerpt?: string; provider?: 'wikipedia' | 'wiby'; evidence?: 'retrieved' };

export const isResearchPrompt = (prompt: string) => /^\/research(?:\s|$)/i.test(prompt.trim());
export function explicitSearchQuery(prompt: string): string | undefined {
  const line = prompt.trim().split(/\r?\n/, 1)[0];
  return /^(?:\/(?:search|research)(?:\s+|$)|(?:please\s+)?search (?:the web|online) for\s+)(.*)$/i.exec(line)?.[1].trim();
}

export function allowsSearchToggle(prompt: string) {
  return !readSkillCommand(prompt) && !directInfoSkill(prompt) && !workspaceIntent(prompt) && !mentionsCreator(prompt);
}

export function chatSearchQuery(prompt: string, searchEnabled: boolean) {
  if (mentionsCreator(prompt)) return;
  return explicitSearchQuery(prompt) ?? (searchEnabled && allowsSearchToggle(prompt) ? prompt.trim() : undefined);
}

function cleanText(value: unknown, limit: number) {
  return typeof value === 'string'
    ? value.slice(0, 8_000).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, limit)
    : '';
}

// Validate sources at both the HTTP boundary and on restoration from history.
// Titles/snippets are always displayed as text. Only the server can retrieve evidence.
export function normalizeSources(input: unknown): WebSource[] {
  if (!Array.isArray(input)) return [];
  const results: WebSource[] = [];
  const seen = new Set<string>();
  for (const raw of input.slice(0, 24)) {
    if (raw === null || typeof raw !== 'object') continue;
    const { title, url, excerpt, provider, evidence } = raw as Record<string, unknown>;
    if (typeof url !== 'string' || url.length > 2_048) continue;
    try {
      const link = new URL(url);
      if ((link.protocol !== 'https:' && link.protocol !== 'http:') || link.username || link.password) continue;
      link.hash = '';
      if (seen.has(link.href)) continue;
      seen.add(link.href);
      const source: WebSource = { title: cleanText(title, 140) || link.hostname, url: link.href };
      const retrieved = provider === 'wikipedia' && evidence === 'retrieved' && link.origin === 'https://en.wikipedia.org' && link.pathname.startsWith('/wiki/');
      const snippet = cleanText(excerpt, retrieved ? 1_200 : 300);
      if (snippet) source.excerpt = snippet;
      if (provider === 'wikipedia' || provider === 'wiby') source.provider = provider;
      if (retrieved) source.evidence = 'retrieved';
      results.push(source);
      if (results.length === MAX_WEB_SOURCES) break;
    } catch { /* Ignore invalid URLs. */ }
  }
  return results;
}
