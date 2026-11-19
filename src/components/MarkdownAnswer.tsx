import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function MarkdownAnswer({ content, trustedLinksOnly }: { content: string; trustedLinksOnly: boolean }) {
  return <div className="markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml unwrapDisallowed disallowedElements={trustedLinksOnly ? ['img', 'a'] : ['img']}
    components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
    {content}
  </Markdown></div>;
}
