import type { Plugin } from 'vite';
import { SITE_DESCRIPTION, TEAM, TEAM_LINK_LABEL, XYVORA_SLOGAN } from '../shared/site.ts';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

// Use the same names and slogan in static HTML and the chat identity tool.
export function publicPages(): Plugin {
  const fields = {
    SITE_DESCRIPTION: escapeHtml(SITE_DESCRIPTION),
    SITE_SLOGAN: escapeHtml(XYVORA_SLOGAN),
    TEAM_LINK_LABEL: escapeHtml(TEAM_LINK_LABEL),
    TEAM_CARDS: TEAM.map(({ name, role, initials }) => `<li class="team-card"><span class="team-initials" aria-hidden="true">${escapeHtml(initials)}</span><div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(role)}</p></div></li>`).join('\n'),
  };
  return {
    name: 'xyvora-public-pages',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace(/\{\{(SITE_DESCRIPTION|SITE_SLOGAN|TEAM_LINK_LABEL|TEAM_CARDS)\}\}/g, (_, field: keyof typeof fields) => fields[field]),
    },
  };
}
