import { AlertCircle, ArrowUpRight, Check, Clipboard, Clock3, Globe, Paperclip, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SEARCH_PROVIDER } from '../../shared/search.ts';
import { SAVED_MODEL_NAMES } from '../lib/history.ts';
import type { Answer, Thread } from '../lib/history.ts';
import { ModelIcon } from './Brand.tsx';

function AnswerText({ content, trustedLinksOnly }: { content: string; trustedLinksOnly: boolean }) {
  return <div className="markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml unwrapDisallowed disallowedElements={trustedLinksOnly ? ['img', 'a'] : ['img']}
    components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
    {content}
  </Markdown></div>;
}

function AnswerCard({ answer, searching, onRetry, onAlert }: {
  answer: Answer; searching: boolean; onRetry?: () => void;
  onAlert: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const clock = answer.source === 'clock';
  const name = clock ? 'Live clock' : SAVED_MODEL_NAMES[answer.model];
  const sources = answer.sources ?? [];
  const working = answer.state === 'working';
  return <article className="answer-card" aria-label={`${name} response`}>
    <header className="answer-heading">
      {clock ? <span className="model-icon tint-sky"><Clock3 size={17} /></span> : <ModelIcon id={answer.model} />}<strong>{name}</strong>
      {answer.source === 'preview' && <span className="answer-tag">Sample</span>}
      {answer.source === 'legacy' && <span className="answer-tag">Earlier reply</span>}
    </header>
    {answer.content && <AnswerText content={answer.content} trustedLinksOnly={sources.length > 0} />}
    {working && !answer.content && <div className="answer-loading" role="status">
      <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span><span>{searching && !clock ? (sources.length ? 'Writing with sources' : 'Searching the web') : 'Preparing a reply'}</span>
    </div>}
    {sources.length > 0 && <section className="web-sources" aria-label="Web sources">
      <div className="web-sources-heading"><Globe size={15} /><strong>Web sources</strong><span>via {SEARCH_PROVIDER}</span></div>
      <ol>{sources.map((source, index) => <li key={source.url}>
        <a href={source.url} target="_blank" rel="noopener noreferrer">
          <span className="source-number">{index + 1}</span><span className="source-info"><strong>{source.title}</strong><small>{new URL(source.url).hostname}</small></span><ArrowUpRight size={14} />
        </a>
      </li>)}</ol>
    </section>}
    {answer.state === 'error' && <div className="answer-error" role="status"><AlertCircle size={17} /><span>{answer.error}</span></div>}
    {answer.state === 'stopped' && <p className="answer-stopped">Response stopped.</p>}
    {!working && <div className="answer-actions">
      {answer.content && <button type="button" className="bare-icon answer-icon" aria-label={copied ? 'Copied response' : 'Copy response'} title={copied ? 'Copied' : 'Copy response'} onClick={async () => {
        try {
          await navigator.clipboard.writeText(answer.content);
          setCopied(true);
          setTimeout(() => setCopied(false), 1_500);
        } catch { onAlert('Clipboard access is unavailable in this browser.'); }
      }}>{copied ? <Check size={15} /> : <Clipboard size={15} />}</button>}
      {onRetry && <button type="button" className="bare-icon answer-icon" onClick={onRetry} aria-label="Retry latest prompt" title="Retry latest prompt"><RotateCcw size={15} /></button>}
    </div>}
  </article>;
}

export function Transcript({ thread, busy, onRetry, onAlert }: {
  thread: Thread; busy: boolean; onRetry?: () => void; onAlert: (message: string) => void;
}) {
  return <div className={`transcript${thread.mode === 'compare' ? ' transcript-compare' : ''}`} aria-label="Conversation">
    {thread.turns.map((turn, index) => <section className="turn" key={turn.id}>
      <div className="user-row">
        <div className="user-message"><p>{turn.prompt}</p>{turn.searchQuery && <span className="user-attachment"><Globe size={13} />Web search</span>}{turn.attachment && <span className="user-attachment"><Paperclip size={13} />{turn.attachment.name}</span>}</div>
      </div>
      <div className="answer-grid">
        {turn.answers.map((answer, lane) => <AnswerCard key={`${lane}-${answer.model}`} answer={answer} searching={!!turn.searchQuery}
          onRetry={index === thread.turns.length - 1 && !busy && lane === 0 ? onRetry : undefined}
          onAlert={onAlert} />)}
      </div>
    </section>)}
  </div>;
}
