import { AlertCircle, Check, Clipboard, Paperclip, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MODELS } from '../../shared/models.ts';
import type { Answer, Thread } from '../lib/history.ts';
import { ModelIcon } from './Brand.tsx';

function AnswerText({ content }: { content: string }) {
  return <div className="markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']}
    components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>
    {content}
  </Markdown></div>;
}

function AnswerCard({ answer, onRetry, onAlert }: {
  answer: Answer; onRetry?: () => void;
  onAlert: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const model = MODELS[answer.model];
  const working = answer.state === 'working';
  return <article className="answer-card" aria-label={`${model.name} response`}>
    <header className="answer-heading">
      <ModelIcon id={answer.model} /><strong>{model.name}</strong>
      {answer.source === 'preview' && <span className="answer-tag">Sample</span>}
      {answer.source === 'legacy' && <span className="answer-tag">Earlier reply</span>}
    </header>
    {answer.content && <AnswerText content={answer.content} />}
    {working && !answer.content && <div className="answer-loading" role="status">
      <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span><span>Preparing a reply</span>
    </div>}
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
  thread: Thread; busy: boolean; onRetry: () => void; onAlert: (message: string) => void;
}) {
  return <div className={`transcript${thread.mode === 'compare' ? ' transcript-compare' : ''}`} aria-label="Conversation">
    {thread.turns.map((turn, index) => <section className="turn" key={turn.id}>
      <div className="user-row">
        <div className="user-message"><p>{turn.prompt}</p>{turn.attachment && <span className="user-attachment"><Paperclip size={13} />{turn.attachment.name}</span>}</div>
      </div>
      <div className="answer-grid">
        {turn.answers.map((answer, lane) => <AnswerCard key={`${lane}-${answer.model}`} answer={answer}
          onRetry={index === thread.turns.length - 1 && !busy && lane === 0 ? onRetry : undefined}
          onAlert={onAlert} />)}
      </div>
    </section>)}
  </div>;
}
