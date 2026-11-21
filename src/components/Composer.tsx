import { ArrowUp, Brain, ChevronDown, Globe, Image, LoaderCircle, Paperclip, Plus, ShieldCheck, Square, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import { IMAGE_FILE_ACCEPT, isVisionFile, MAX_VISION_QUESTION } from '../../shared/media.ts';
import { MAX_PROMPT } from '../../shared/models.ts';
import { allowsSearchToggle, chatSearchQuery, explicitSearchQuery, MAX_SEARCH_QUERY } from '../../shared/search.ts';
import { MODES } from '../../shared/modes.ts';
import type { ReplyMode } from '../../shared/modes.ts';
import { ACCEPTED_FILES, MAX_FILES } from '../lib/files.ts';
import type { LocalFile } from '../lib/files.ts';
import type { VisionPhoto } from '../lib/vision-file.ts';
import { usePhotoUrl } from './VisionDialog.tsx';
import { MODE_ICONS } from './ModeDialog.tsx';
import { hopMascot, typedCompletedWord } from '../lib/mascot-motion.ts';
import { Mascot } from './Brand.tsx';

type Props = {
  draft: string;
  onDraft: (text: string) => void;
  textarea: RefObject<HTMLTextAreaElement | null>;
  files: LocalFile[];
  photo?: VisionPhoto;
  canAnalyze: boolean;
  onRemovePhoto: () => void;
  filePicker: RefObject<HTMLInputElement | null>;
  checking: boolean;
  usesMemory: boolean;
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
  isolated: boolean;
};

export function Composer({ draft, onDraft, textarea, files, photo, canAnalyze, onRemovePhoto, filePicker, checking, usesMemory, onAttach, onRemoveFile, readingFiles, mode, onMode, onSend, onStop, webSearch, canSearch, onToggleSearch, busy, isolated }: Props) {
  const searchEnabled = allowsSearchToggle(draft);
  const explicit = explicitSearchQuery(draft) !== undefined;
  const query = photo ? undefined : chatSearchQuery(draft, webSearch);
  const searchTooLong = query !== undefined && query.length > MAX_SEARCH_QUERY;
  const ModeIcon = MODE_ICONS[mode];
  const [dropping, setDropping] = useState(false);
  const limit = photo ? MAX_VISION_QUESTION : MAX_PROMPT;
  const canSend = (!photo || canAnalyze) && !checking && !readingFiles && !!draft.trim() && draft.trim().length <= limit && !searchTooLong && (query === undefined || !!query.trim());
  const photoUrl = usePhotoUrl(photo?.blob);
  const attachEnabled = !checking && !busy && !readingFiles && !photo && files.length < MAX_FILES;
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
      event.dataTransfer.dropEffect = attachEnabled ? 'copy' : 'none';
      if (attachEnabled) setDropping(true);
    }}
    onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropping(false); }}
    onDrop={(event) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault(); setDropping(false);
      if (attachEnabled) onAttach(Array.from(event.dataTransfer.files));
    }}
    onPaste={(event) => {
      const images = Array.from(event.clipboardData.files).filter(isVisionFile);
      if (!images.length || event.clipboardData.getData('text/plain')) return;
      event.preventDefault(); if (attachEnabled) onAttach(images);
    }}>
    {dropping && <div className="file-drop-hint" aria-live="polite"><Paperclip size={15} /> Drop images, PDFs, or text and code files</div>}
    {(files.length > 0 || photo || readingFiles) && <div className="attachment-list" aria-label="Attachments">
      {files.map((file) => <div className="file-card" key={file.id}>
        <details>
          <summary title={file.name}><Paperclip size={14} /><span>{file.name}</span><small>{file.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'Text'} preview</small></summary>
          <pre className="attachment-excerpt" aria-label={`${file.name} preview`} tabIndex={0}>{file.text.slice(0, 900)}{(file.truncated || file.text.length > 900) && '\n… (excerpt)'}</pre>
        </details>
        <button type="button" className="bare-icon" onClick={() => onRemoveFile(file.id)} aria-label={`Remove ${file.name}`} disabled={busy || readingFiles}><X size={14} /></button>
      </div>)}
      {photo && <div className="attachment-chip photo-chip" title={photo.name}>
        {photoUrl ? <img src={photoUrl} alt={`Preview of ${photo.name}`} /> : <Image size={15} />}<span>{photo.name}</span><small>{canAnalyze ? 'Image' : 'On this device'}</small>
        <button type="button" className="bare-icon" onClick={onRemovePhoto} aria-label={`Remove ${photo.name}`} disabled={busy}><X size={14} /></button>
      </div>}
      {readingFiles && <span className="attachment-chip" role="status"><LoaderCircle className="file-spinner" size={14} />Preparing attachment…</span>}
    </div>}
    <div className="composer-input-row">
      <Mascot className="composer-mark" motionRef={mascot} />
      <textarea
        ref={textarea} value={draft} disabled={checking || (!!photo && busy)} maxLength={limit} rows={2}
        placeholder={photo ? canAnalyze ? 'Ask about this image…' : 'Remove the image to send a text message…' : webSearch ? 'What should I look up?…' : 'Ask Xyvora AI anything…'} aria-label="Message Xyvora"
        aria-describedby={photo ? 'vision-disclosure' : query !== undefined && canSearch ? 'search-disclosure' : undefined}
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
    {draft.length > limit - (photo ? 100 : 400) && <span className="char-count">{draft.length}/{limit}</span>}
    <div className="composer-toolbar">
      <div className="composer-tools">
        <input type="file" ref={filePicker} hidden multiple accept={`${ACCEPTED_FILES},${IMAGE_FILE_ACCEPT}`} onChange={attach} />
        <button type="button" className="attach-button" title="Attach documents or an image" aria-label="Attach files" disabled={!attachEnabled} onClick={() => filePicker.current?.click()}><Plus size={19} /></button>
        {photo ? <span className="vision-mode"><Image size={15} /> {canAnalyze ? 'Image analysis' : 'Image preview'}</span> : <>
          <button type="button" className="mode-chip" title={MODES[mode].description} aria-label={`Reply mode: ${MODES[mode].name}`} aria-haspopup="dialog" onClick={onMode} disabled={busy}>
            <ModeIcon size={15} /><span>{MODES[mode].name}</span><ChevronDown size={13} />
          </button>
          <button type="button" className="web-search-chip" aria-pressed={explicit || (searchEnabled && webSearch)} disabled={!canSearch || busy || !searchEnabled || explicit}
            title={!canSearch ? 'Available on the live site' : explicit ? 'Search command active' : searchEnabled ? 'Search the web with just this prompt' : 'This prompt uses a different tool'} onClick={onToggleSearch}>
            <Globe size={16} /><span>Web search</span>
          </button>
        </>}
      </div>
      <div className="composer-actions">
        {busy
          ? <button type="button" className="send-button" title="Stop response" aria-label="Stop response" onClick={onStop}><Square size={14} fill="currentColor" /></button>
          : <button type="submit" className="send-button" title={photo ? 'Review image upload' : 'Send message'} aria-label={photo ? 'Review image upload' : 'Send message'} disabled={!canSend}><ArrowUp size={21} strokeWidth={2.3} /></button>}
      </div>
    </div>
    {isolated && <p className="context-disclosure"><ShieldCheck size={13} /> This message only · Earlier exchanges and saved memory aren’t included.</p>}
    {usesMemory && !photo && <p className="context-disclosure"><Brain size={13} /> Saved memory can be used for this reply.</p>}
    {photo && <p id="vision-disclosure" className="search-disclosure">{!canAnalyze ? 'This is a local preview. Remove the image to send a text message.' : draft.trim().length > limit ? `Keep your question to ${limit} characters.` : 'Review before sending the image and question to OpenAI. No prior chat or memory is sent.'}</p>}
    {files.length > 0 && <p className="search-disclosure">Only extracted text is included when you ask Xyvora about a file. Long files are excerpted.</p>}
    {query !== undefined && canSearch && <p id="search-disclosure" className="search-disclosure">
      {searchTooLong ? `Keep search queries to ${MAX_SEARCH_QUERY} characters.` : `Only your search query goes to Wiby and Wikipedia, not your attachments or chat history. Don’t include private information.`}
    </p>}
  </form>;
}
