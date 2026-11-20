import type { Plugin } from 'vite';
import { SITE_DESCRIPTION, TEAM, TEAM_LINK_LABEL, XYVORA_SLOGAN } from '../shared/site.ts';

export const PUBLIC_PAGES = [
  ['/', 'index.html'], ['/about', 'about.html'], ['/schools', 'schools.html'], ['/analytics', 'analytics.html'],
  ['/developers', 'developers.html'], ['/terms', 'terms.html'], ['/privacy', 'privacy.html'], ['/cookies', 'cookies.html'],
] as const;

const infoHeader = `<a class="info-skip" href="#content">Skip to content</a>
    <header class="info-bar"><nav class="info-width" aria-label="Xyvora navigation">
      <a class="info-brand" href="/"><img src="/brand/xyvora-icon.png" width="36" height="36" alt="" /> Xyvora AI<span>.</span></a>
      <div class="info-nav"><a href="/analytics">Analytics</a><a href="/developers">API</a><a class="info-button" href="/">Open chat <span aria-hidden="true">↗</span></a></div>
    </nav></header>`;
const infoFooter = `<footer class="info-width info-footer"><span>Built by the Xyvora team</span><nav class="info-footlinks" aria-label="Xyvora resources"><a href="/about">About</a><a href="/schools">For schools</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/cookies">Cookies</a></nav></footer>`;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

// Use the same names and slogan in static HTML and the chat identity tool.
export function publicPages(): Plugin {
  const fields = {
    INFO_HEADER: infoHeader,
    INFO_FOOTER: infoFooter,
    SITE_DESCRIPTION: escapeHtml(SITE_DESCRIPTION),
    SITE_SLOGAN: escapeHtml(XYVORA_SLOGAN),
    TEAM_LINK_LABEL: escapeHtml(TEAM_LINK_LABEL),
    TEAM_CARDS: TEAM.map(({ name, role, initials }) => `<li class="team-card"><span class="team-initials" aria-hidden="true">${escapeHtml(initials)}</span><div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(role)}</p></div></li>`).join('\n'),
  };
  return {
    name: 'xyvora-public-pages',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace(/\{\{(INFO_HEADER|INFO_FOOTER|SITE_DESCRIPTION|SITE_SLOGAN|TEAM_LINK_LABEL|TEAM_CARDS)\}\}/g, (_, field: keyof typeof fields) => fields[field]),
    },
  };
}
