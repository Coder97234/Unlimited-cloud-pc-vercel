import { ArrowUp, ChevronDown, Paperclip, Plus, Square, X } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import { MAX_ATTACHMENT, MAX_PROMPT, MODELS } from '../../shared/models.ts';
import type { ModelId } from '../../shared/models.ts';
import type { Attachment, ChatMode } from '../lib/history.ts';
import { ModelIcon } from './Brand.tsx';

type Props = {
  draft: string;
  onDraft: (text: string) => void;
  textarea: RefObject<HTMLTextAreaElement | null>;
  attachment: Attachment | undefined;
  onAttachment: (file: Attachment | undefined) => void;
  onAlert: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  onChooseModel: () => void;
  model: ModelId;
  busy: boolean;
  mode: ChatMode;
};

export function Composer({ draft, onDraft, textarea, attachment, onAttachment, onAlert, onSend, onStop, onChooseModel, model, busy, mode }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const field = textarea.current;
    if (field) { field.style.height = 'auto'; field.style.height = `${Math.min(field.scrollHeight, 154)}px`; }
  }, [draft, textarea]);

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!/\.(txt|md|csv|json|js|ts|py)$/i.test(file.name) || file.size > MAX_ATTACHMENT * 4) {
      onAlert('Choose a text file under 8,000 characters (.txt, .md, .csv, .json, .js, .ts, or .py).');
      return;
    }
    try {
      const text = await file.text();
      if (text.length > MAX_ATTACHMENT || !text.trim() || text.includes('\0')) {
        onAlert('Choose a non-empty text file under 8,000 characters.');
        return;
      }
      onAttachment({ name: file.name.slice(0, 120), text });
      textarea.current?.focus();
    } catch { onAlert('Could not read that text file.'); }
  }

  return <form className="composer" onSubmit={(event) => { event.preventDefault(); if (!busy && draft.trim()) onSend(); }}>
    {attachment && <div className="attachment-chip">
      <Paperclip size={14} /><span>{attachment.name}</span>
      <button type="button" className="bare-icon" onClick={() => onAttachment(undefined)} aria-label="Remove attachment"><X size={14} /></button>
    </div>}
    <textarea
      ref={textarea} value={draft} maxLength={MAX_PROMPT} onChange={(event) => onDraft(event.target.value)} rows={2}
      placeholder={mode === 'compare' ? 'Ask both models the same question…' : 'Ask Xyvora anything…'}
      aria-label={mode === 'compare' ? 'Prompt for both models' : 'Message Xyvora'}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (!busy && draft.trim()) onSend();
        }
      }}
    />
    <div className="composer-toolbar">
      <div className="composer-tools">
        <input type="file" ref={fileInput} hidden accept=".txt,.md,.csv,.json,.js,.ts,.py" onChange={(event) => void attach(event)} />
        <button type="button" className="attach-button" title="Attach a text file" aria-label="Attach a text file" onClick={() => fileInput.current?.click()}><Plus size={19} /></button>
        {mode === 'chat' && <button type="button" className="model-chip" aria-label={`Choose model, current model ${MODELS[model].name}`} onClick={onChooseModel}>
          <ModelIcon id={model} size={14} /><span>{MODELS[model].name}</span><ChevronDown size={14} className="chevron" />
        </button>}
        {mode === 'compare' && <span className="composer-compare-label">Sends to both models</span>}
      </div>
      <div className="composer-actions">
        {draft.length > MAX_PROMPT - 400 && <span className="char-count">{draft.length}/{MAX_PROMPT}</span>}
        {busy
          ? <button type="button" className="send-button" title="Stop response" aria-label="Stop response" onClick={onStop}><Square size={14} fill="currentColor" /></button>
          : <button type="submit" className="send-button" title="Send message" aria-label="Send message" disabled={!draft.trim()}><ArrowUp size={21} strokeWidth={2.3} /></button>}
      </div>
    </div>
  </form>;
}
