import { createContext, isValidElement, lazy, Suspense, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Link, Parent, Root, RootContent } from 'mdast';
import Markdown from 'react-markdown';
import type { Components, Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReplyLanguage } from '../../shared/experience.ts';
import type { WebSource } from '../../shared/search.ts';
import { CodeBlock } from './CodeBlock.tsx';

const Settled = createContext(true);
const emptySources: WebSource[] = [];
const MathMarkdown = lazy(() => import('./MathMarkdown.tsx').catch(() => ({ default: Markdown })));
function Pre({ children }: { children?: ReactNode }) {
  const settled = useContext(Settled);
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children) || typeof children.props.children !== 'string') return <pre>{children}</pre>;
  const language = /^language-([\w+#-]{1,24})$/.exec(children.props.className ?? '')?.[1];
  return <CodeBlock text={children.props.children.replace(/\n$/, '')} language={language} settled={settled} />;
}

// Work on parsed text, not Markdown source. Fences, inline code, and link
// labels aren't rewritten. Only indexes into our own source list become links.
function citations(sources: readonly WebSource[]) {
  return (tree: Root) => {
    function scan(parent: Parent) {
      if (parent.type === 'link' || parent.type === 'linkReference') return;
      parent.children = parent.children.flatMap((node): RootContent[] => {
        if (node.type !== 'text') {
          if ('children' in node) scan(node);
          return [node];
        }
        let start = 0;
        const parts: RootContent[] = [];
        for (const match of node.value.matchAll(/\[(\d{1,3})\]/g)) {
          const index = match.index!;
          if (index > start) parts.push({ type: 'text', value: node.value.slice(start, index) });
          const source = sources[Number(match[1]) - 1];
          if (source) parts.push({ type: 'link', url: source.url, title: source.title, children: [{ type: 'text', value: match[0] }], data: { hProperties: { className: ['inline-citation'] } } } as Link);
          start = index + match[0].length;
        }
        if (start === 0) return [node];
        if (start < node.value.length) parts.push({ type: 'text', value: node.value.slice(start) });
        return parts;
      }) as typeof parent.children;
    }
    scan(tree);
  };
}
export default function MarkdownAnswer({ content, sources = emptySources, language, trustedLinksOnly, working }: { content: string; sources?: WebSource[]; language?: ReplyLanguage; trustedLinksOnly: boolean; working?: boolean }) {
  const components: Components = useMemo(() => ({
    a: ({ node: _node, href, children, ...props }) => trustedLinksOnly && !sources.some(({ url }) => url === href)
      ? <>{children}</> : <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    pre: Pre,
    table: ({ node: _node, ...props }) => <div className="table-scroll" tabIndex={0} aria-label="Scrollable table"><table {...props} /></div>,
  }), [trustedLinksOnly, sources]);
  const math = !working && content.includes('$$');
  const options: Options = {
    remarkPlugins: [remarkGfm, ...(sources.length ? [() => citations(sources)] : [])],
    skipHtml: true, unwrapDisallowed: true, disallowedElements: ['img'], components, children: content,
  };
  return <div className="markdown" lang={language === 'auto' ? undefined : language}><Settled.Provider value={!working}>
    {math ? <Suspense fallback={<Markdown {...options} />}><MathMarkdown {...options} /></Suspense> : <Markdown {...options} />}
  </Settled.Provider></div>;
}
