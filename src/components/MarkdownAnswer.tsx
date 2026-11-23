import { createContext, isValidElement, useContext } from 'react';
import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock.tsx';

const Settled = createContext(true);
function Pre({ children }: { children?: ReactNode }) {
  const settled = useContext(Settled);
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children) || typeof children.props.children !== 'string') return <pre>{children}</pre>;
  const language = /^language-([\w+#-]{1,24})$/.exec(children.props.className ?? '')?.[1];
  return <CodeBlock text={children.props.children.replace(/\n$/, '')} language={language} settled={settled} />;
}
const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  pre: Pre,
  table: ({ node: _node, ...props }) => <div className="table-scroll" tabIndex={0} aria-label="Scrollable table"><table {...props} /></div>,
};
export default function MarkdownAnswer({ content, trustedLinksOnly, working }: { content: string; trustedLinksOnly: boolean; working?: boolean }) {
  return <div className="markdown"><Settled.Provider value={!working}><Markdown remarkPlugins={[remarkGfm]} skipHtml unwrapDisallowed disallowedElements={trustedLinksOnly ? ['img', 'a'] : ['img']} components={components}>
    {content}
  </Markdown></Settled.Provider></div>;
}
