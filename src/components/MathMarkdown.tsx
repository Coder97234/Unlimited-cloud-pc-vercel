import Markdown from 'react-markdown';
import type { Options } from 'react-markdown';
import remarkMath from 'remark-math';
import { rehypeChatMath } from '../lib/chat-math.ts';

export default function MathMarkdown(props: Options) {
  return <Markdown {...props} remarkPlugins={[...(props.remarkPlugins ?? []), [remarkMath, { singleDollarTextMath: false }]]} rehypePlugins={[rehypeChatMath]} />;
}
