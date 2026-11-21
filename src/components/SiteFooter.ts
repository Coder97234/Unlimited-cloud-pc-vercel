import { createElement as h } from 'react';
import { SITE_LINKS } from '../../shared/site.ts';

// Also rendered to static HTML by Vite, so the public links work without JS.
export function SiteFooter({ info = false }: { info?: boolean }) {
  return h('footer', { className: info ? 'info-width info-footer' : 'main-footer' },
    h('span', null, info ? 'Built by the Xyvora team' : 'Xyvora AI can make mistakes. Check important information.'),
    h('nav', { className: info ? 'info-footlinks' : 'footer-nav', 'aria-label': 'Xyvora resources' },
      SITE_LINKS.map(([path, name]) => h('a', { key: path, className: 'footer-link', href: path }, name))));
}
