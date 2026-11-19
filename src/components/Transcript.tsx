import { AlertCircle, ArrowUpRight, Check, Clipboard, Clock3, Globe, Paperclip, RotateCcw, Zap } from 'lucide-react';
import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react';
import { XYVORA_NAME } from '../../shared/models.ts';
import { skillName } from '../../shared/skill-catalog.ts';
import { DEFAULT_MODE, MODES } from '../../shared/modes.ts';
import type { Answer, Thread } from '../lib/history.ts';
import { hasCompletedWord, hopMascot } from '../lib/mascot-motion.ts';
import { Mascot } from './Brand.tsx';

function PlainAnswer({ content }: { content: string }) {
  return <div className="markdown plain-answer">{content}</div>;
}

// Markdown parsing isn't needed to open the workspace or show the first text.
// Plain text remains available if the chunk can't be loaded (e.g. offline).
const MarkdownAnswer = lazy(() => import('./MarkdownAnswer.tsx').catch(() => ({ default: PlainAnswer })));
const AnswerText = memo(function AnswerText({ content, trustedLinksOnly }: { content: string; trustedLinksOnly: boolean }) {
  return <Suspense fallback={<PlainAnswer content={content} />}>
    <MarkdownAnswer content={content} trustedLinksOnly={trustedLinksOnly} />
  </Suspense>;
});

function AnswerCard({ answer, archived, searching, onRetry, onAlert }: {
  answer: Answer; archived: boolean; searching: boolean; onRetry?: () => void;
  onAlert: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const clock = answer.source === 'clock';
  const instant = answer.source === 'skill';
  const historical = archived || answer.source === 'legacy';
  const name = historical ? 'Earlier reply' : XYVORA_NAME;
  const badge = clock ? 'Live clock' : instant ? (answer.skill ? skillName(answer.skill) : 'Built-in tool') : historical ? undefined : MODES[answer.replyMode ?? DEFAULT_MODE].name;
  const sources = answer.sources ?? [];
  const working = answer.state === 'working';
  const mascot = useRef<HTMLSpanElement>(null);
  const seen = useRef({ working: false, length: 0 });
  const { content, state } = answer;
  useEffect(() => {
    const previous = seen.current;
    seen.current = { working, length: content.length };
    const justFinished = previous.working && state === 'finished';
    if (!mascot.current || (!working && !justFinished)) return;
    const from = previous.working && previous.length <= content.length ? previous.length : 0;
    if (hasCompletedWord(content, from, justFinished)) hopMascot(mascot.current);
  }, [content, state, working]);
  return <article className="answer-card" aria-label={`${clock || instant ? badge : name} response`}>
    <header className="answer-heading">
      {clock ? <span className="model-icon tint-sky"><Clock3 size={17} /></span> : instant ? <span className="model-icon tint-violet"><Zap size={17} /></span>
        : <Mascot className="reply-mark" motionRef={historical ? undefined : mascot} />}
      <strong>{name}</strong>{badge && <span className="answer-tag">{badge}</span>}
      {answer.source === 'preview' && <span className="answer-tag">Sample</span>}
    </header>
    {answer.content && <AnswerText content={answer.content} trustedLinksOnly={searching || sources.length > 0} />}
    {working && !answer.content && <div className="answer-loading" role="status">
      <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span><span>{searching && !clock ? (sources.length ? 'Writing with sources' : 'Searching the web') : 'Preparing a reply'}</span>
    </div>}
    {sources.length > 0 && <section className="web-sources" aria-label="Web sources">
      <div className="web-sources-heading"><Globe size={15} /><strong>Web sources</strong></div>
      <ol>{sources.map((source, index) => <li key={source.url}>
        <a href={source.url} target="_blank" rel="noopener noreferrer">
          <span className="source-number">{index + 1}</span><span className="source-info"><strong>{source.title}</strong><small>{new URL(source.url).hostname}</small></span><ArrowUpRight size={14} />
        </a>
      </li>)}</ol>
      <div className="web-source-credits">
        {sources.some((source) => source.provider === 'wiby') && <a href="https://wiby.me/" target="_blank" rel="noopener noreferrer">Wiby search</a>}
        {sources.some((source) => source.provider === 'wikipedia') && <a href="https://en.wikipedia.org/wiki/Wikipedia:Copyrights" target="_blank" rel="noopener noreferrer">Wikipedia (CC BY-SA)</a>}
      </div>
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
        {turn.answers.map((answer, lane) => <AnswerCard key={`${lane}-${answer.model}`} answer={answer} archived={thread.mode === 'compare'} searching={!!turn.searchQuery}
          onRetry={index === thread.turns.length - 1 && !busy && lane === 0 ? onRetry : undefined}
          onAlert={onAlert} />)}
      </div>
    </section>)}
  </div>;
}
