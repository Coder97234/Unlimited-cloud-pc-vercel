import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Plugin } from 'vite';
import { SiteFooter } from '../src/components/SiteFooter.ts';
import { ORBIT_ASSET, SOCIAL_ASSET, SITE_DESCRIPTION, TEAM, TEAM_LINK_LABEL, XYVORA_SLOGAN, XYVORA_URL } from '../shared/site.ts';

export const PUBLIC_PAGES = [
  ['/', 'index.html', 'Xyvora AI — Free AI Workspace', SITE_DESCRIPTION],
  ['/about', 'about.html', 'Meet the Team · Xyvora AI', 'Meet the people behind Xyvora AI, meet Orbit, and learn how our workspace for chat, files, and built-in tools works.'],
  ['/schools', 'schools.html', 'For Schools · Xyvora AI', 'Access, privacy, and network information about Xyvora AI for teachers and school IT teams.'],
  ['/analytics', 'analytics.html', 'Usage Analytics · Xyvora AI', 'See aggregate Xyvora AI usage from browsers that opt in to analytics, plus the registered account count.'],
  ['/developers', 'developers.html', 'Developer API · Xyvora AI', 'Try the Xyvora AI text API, stream a reply, and see curl examples and the OpenAPI specification.'],
  ['/terms', 'terms.html', 'Terms of Use · Xyvora AI', 'Read the terms for accessing the Xyvora AI chat workspace, developer API, and optional tools.'],
  ['/privacy', 'privacy.html', 'Privacy Policy · Xyvora AI', 'Learn what Xyvora AI stores, what is shared when you use chat or optional tools, and how to delete account data.'],
  ['/cookies', 'cookies.html', 'Cookie Choices · Xyvora AI', 'Manage optional analytics and learn how Xyvora AI uses cookies and browser storage.'],
  ['/status', 'status.html', 'Service Status · Xyvora AI', 'Check the current availability reported by Xyvora AI chat, web search, and the usage report.'],
] as const;

const infoHeader = `<a class="info-skip" href="#content">Skip to content</a>
    <header class="info-bar"><nav class="info-width" aria-label="Xyvora navigation">
      <a class="info-brand" href="/"><img src="/brand/xyvora-icon.png" width="36" height="36" alt="" /> Xyvora AI<span>.</span></a>
      <div class="info-nav"><a href="/developers">API</a><a class="info-button" href="/">Open chat <span aria-hidden="true">↗</span></a><button type="button" class="info-button info-button-secondary info-theme" data-theme-switch aria-label="Switch to dark theme"><span class="theme-light-icon" aria-hidden="true">☾</span><span class="theme-dark-icon" aria-hidden="true">☀</span></button></div>
    </nav></header>`;
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const socialImage = `${XYVORA_URL}${SOCIAL_ASSET}`;

function pageMeta([path, , pageTitle, summary]: typeof PUBLIC_PAGES[number]) {
  const title = escapeHtml(pageTitle), description = escapeHtml(summary), url = XYVORA_URL + path;
  return `<title>${title}</title>
    <meta name="description" content="${description}" />
    <meta name="theme-color" content="#fdfbf7" />
    <link rel="icon" type="image/png" sizes="64x64" href="/brand/xyvora-icon.png" />
    <link rel="icon" type="image/svg+xml" href="${ORBIT_ASSET}" />
    <link rel="canonical" href="${url}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Xyvora AI" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${socialImage}" />
    <meta property="og:image:alt" content="Xyvora AI and Orbit, an orange, one-eyed triangle with an orbital ring" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${socialImage}" />
    <meta name="twitter:image:alt" content="Xyvora AI and Orbit, an orange, one-eyed triangle with an orbital ring" />
    <script src="/theme.js"></script>`;
}

export function publicPages(): Plugin {
  const fields = {
    INFO_HEADER: infoHeader,
    INFO_FOOTER: renderToStaticMarkup(createElement(SiteFooter, { info: true })),
    SITE_DESCRIPTION: escapeHtml(SITE_DESCRIPTION),
    SITE_SLOGAN: escapeHtml(XYVORA_SLOGAN),
    TEAM_LINK_LABEL: escapeHtml(TEAM_LINK_LABEL),
    TEAM_CARDS: TEAM.map(({ name, role, initials }) => `<li class="team-card"><span class="team-initials" aria-hidden="true">${escapeHtml(initials)}</span><div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(role)}</p></div></li>`).join('\n'),
  };
  return {
    name: 'xyvora-public-pages',
    transformIndexHtml: {
      order: 'pre',
      handler: (html, { filename }) => {
        const page = PUBLIC_PAGES.find(([, file]) => filename.endsWith(`/${file}`));
        return html.replace(/\{\{(PAGE_META|INFO_HEADER|INFO_FOOTER|SITE_DESCRIPTION|SITE_SLOGAN|TEAM_LINK_LABEL|TEAM_CARDS)\}\}/g,
          (_, field: 'PAGE_META' | keyof typeof fields) => field === 'PAGE_META' ? (page ? pageMeta(page) : '') : fields[field]);
      },
    },
  };
}
