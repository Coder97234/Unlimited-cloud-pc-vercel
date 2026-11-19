import { ArrowUp, ChevronDown, Globe, LoaderCircle, Paperclip, Plus, Square, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import { MAX_PROMPT } from '../../shared/models.ts';
import { allowsSearchToggle, chatSearchQuery, explicitSearchQuery, MAX_SEARCH_QUERY } from '../../shared/search.ts';
import { MODES } from '../../shared/modes.ts';
import type { ReplyMode } from '../../shared/modes.ts';
import { ACCEPTED_FILES, MAX_FILES } from '../lib/files.ts';
import type { LocalFile } from '../lib/files.ts';
import { MODE_ICONS } from './ModeDialog.tsx';
import { hopMascot, typedCompletedWord } from '../lib/mascot-motion.ts';
import { Mascot } from './Brand.tsx';

type Props = {
  draft: string;
  onDraft: (text: string) => void;
  textarea: RefObject<HTMLTextAreaElement | null>;
  files: LocalFile[];
  onAttach: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  readingFiles: boolean;
  mode: ReplyMode;
  onMode: () => void;
  onSend: () => void;
  onStop: () => void;
  webSearch: boolean;
  canSearch: boolean;
  onToggleSearch: () => void;
  busy: boolean;
};

export function Composer({ draft, onDraft, textarea, files, onAttach, onRemoveFile, readingFiles, mode, onMode, onSend, onStop, webSearch, canSearch, onToggleSearch, busy }: Props) {
  const searchEnabled = allowsSearchToggle(draft);
  const explicit = explicitSearchQuery(draft) !== undefined;
  const query = chatSearchQuery(draft, webSearch);
  const searchTooLong = query !== undefined && query.length > MAX_SEARCH_QUERY;
  const ModeIcon = MODE_ICONS[mode];
  const [dropping, setDropping] = useState(false);
  const canSend = !readingFiles && !!draft.trim() && !searchTooLong && (query === undefined || !!query.trim());
  const fileInput = useRef<HTMLInputElement>(null);
  const mascot = useRef<HTMLSpanElement>(null);
  const beforeComposition = useRef<string | null>(null);
  useLayoutEffect(() => {
    const field = textarea.current;
    if (field) { field.style.height = 'auto'; field.style.height = `${Math.min(field.scrollHeight, 154)}px`; }
  }, [draft, textarea]);

  function attach(event: ChangeEvent<HTMLInputElement>) {
    const items = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (items.length) onAttach(items);
  }

  return <form className={`composer${dropping ? ' composer-drop' : ''}`} data-loading-files={readingFiles || undefined}
    onSubmit={(event) => { event.preventDefault(); if (!busy && canSend) onSend(); }}
    onDragOver={(event) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = busy || readingFiles || files.length >= MAX_FILES ? 'none' : 'copy';
      if (!busy && !readingFiles && files.length < MAX_FILES) setDropping(true);
    }}
    onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropping(false); }}
    onDrop={(event) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault(); setDropping(false);
      if (!busy && !readingFiles) onAttach(Array.from(event.dataTransfer.files));
    }}>
    {(files.length > 0 || readingFiles) && <div className="attachment-list" aria-label="Attachments">
      {files.map((file) => <div className="attachment-chip" key={file.id} title={file.truncated ? `${file.name} (excerpt)` : file.name}>
        <Paperclip size={14} /><span>{file.name}</span>{file.truncated && <small>Excerpt</small>}
        <button type="button" className="bare-icon" onClick={() => onRemoveFile(file.id)} aria-label={`Remove ${file.name}`} disabled={busy || readingFiles}><X size={14} /></button>
      </div>)}
      {readingFiles && <span className="attachment-chip" role="status"><LoaderCircle className="file-spinner" size={14} />Extracting text…</span>}
    </div>}
    <div className="composer-input-row">
      <Mascot className="composer-mark" motionRef={mascot} />
      <textarea
        ref={textarea} value={draft} maxLength={MAX_PROMPT} rows={2}
        placeholder={webSearch ? 'What should I look up?…' : 'Ask Xyvora AI anything…'} aria-label="Message Xyvora"
        aria-describedby={query !== undefined && canSearch ? 'search-disclosure' : undefined}
        onChange={(event) => {
          const field = event.currentTarget;
          const input = event.nativeEvent as InputEvent;
          if (beforeComposition.current === null && !input.isComposing && !input.inputType?.startsWith('delete')
            && typedCompletedWord(draft, field.value, field.selectionStart)) hopMascot(mascot.current);
          onDraft(field.value);
        }}
        onCompositionStart={() => { beforeComposition.current = draft; }}
        onCompositionEnd={({ currentTarget: field }) => {
          const before = beforeComposition.current;
          beforeComposition.current = null;
          if (before !== null && typedCompletedWord(before, field.value, field.selectionStart, true)) hopMascot(mascot.current);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!busy && canSend) onSend();
          }
        }}
      />
    </div>
    {draft.length > MAX_PROMPT - 400 && <span className="char-count">{draft.length}/{MAX_PROMPT}</span>}
    <div className="composer-toolbar">
      <div className="composer-tools">
        <input type="file" ref={fileInput} hidden multiple accept={ACCEPTED_FILES} onChange={attach} />
        <button type="button" className="attach-button" title="Attach files (up to 3)" aria-label="Attach files" disabled={busy || readingFiles || files.length >= MAX_FILES} onClick={() => fileInput.current?.click()}><Plus size={19} /></button>
        <button type="button" className="mode-chip" title={MODES[mode].description} aria-label={`Reply mode: ${MODES[mode].name}`} aria-haspopup="dialog" onClick={onMode} disabled={busy}>
          <ModeIcon size={15} /><span>{MODES[mode].name}</span><ChevronDown size={13} />
        </button>
        <button type="button" className="web-search-chip" aria-pressed={explicit || (searchEnabled && webSearch)} disabled={!canSearch || busy || !searchEnabled || explicit}
          title={!canSearch ? 'Available on the live site' : explicit ? 'Search command active' : searchEnabled ? 'Search the web with just this prompt' : 'This prompt uses a different tool'} onClick={onToggleSearch}>
          <Globe size={16} /><span>Web search</span>
        </button>
      </div>
      <div className="composer-actions">
        {busy
          ? <button type="button" className="send-button" title="Stop response" aria-label="Stop response" onClick={onStop}><Square size={14} fill="currentColor" /></button>
          : <button type="submit" className="send-button" title="Send message" aria-label="Send message" disabled={!canSend}><ArrowUp size={21} strokeWidth={2.3} /></button>}
      </div>
    </div>
    {files.length > 0 && <p className="search-disclosure">Only extracted text is included when you ask Xyvora about a file. Long files are excerpted.</p>}
    {query !== undefined && canSearch && <p id="search-disclosure" className="search-disclosure">
      {searchTooLong ? `Keep search queries to ${MAX_SEARCH_QUERY} characters.` : `Only your search query goes to Wiby and Wikipedia, not your attachments or chat history. Don’t include private information.`}
    </p>}
  </form>;
}
