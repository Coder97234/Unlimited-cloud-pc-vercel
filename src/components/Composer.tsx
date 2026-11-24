import { ArrowUp, Brain, AudioLines, Image, ListTree, LoaderCircle, Paperclip, Plus, ShieldCheck, Square, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import { IMAGE_FILE_ACCEPT, isVisionFile, MAX_VISION_QUESTION } from '../../shared/media.ts';
import { MAX_PROMPT } from '../../shared/models.ts';
import { explicitSearchQuery, MAX_SEARCH_QUERY } from '../../shared/search.ts';
import type { Effort, ModelTier, RankedModel } from '../../shared/experience.ts';
import { useLabels } from '../lib/labels.ts';
import type { ReplyMode } from '../../shared/modes.ts';
import { ACCEPTED_FILES, MAX_FILES } from '../lib/files.ts';
import type { LocalFile } from '../lib/files.ts';
import type { VisionPhoto } from '../lib/vision-file.ts';
import { usePhotoUrl } from './VisionDialog.tsx';
import { floatMascot, typedCompletedWord } from '../lib/mascot-motion.ts';
import { ReplyMenu } from './ReplyMenu.tsx';

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
  onMode: (mode: ReplyMode) => void;
  model: RankedModel;
  needsModelChoice: boolean;
  onModel: (model: ModelTier) => void;
  models: RankedModel[];
  effort: Effort;
  onEffort: (value: Effort) => void;
  sample: boolean;
  onContext: () => void;
  focusPrompt: () => void;
  welcomeMark: RefObject<HTMLSpanElement | null>;
  onSend: () => void;
  onStop: () => void;
  canSearch: boolean;
  voiceMode: boolean;
  voiceAvailable: boolean;
  onVoiceMode: () => void;
  busy: boolean;
  isolated: boolean;
};

export function Composer({ draft, onDraft, textarea, files, photo, canAnalyze, onRemovePhoto, filePicker, checking, usesMemory, onAttach, onRemoveFile, readingFiles, mode, onMode, model, onModel, needsModelChoice, models, effort, onEffort, sample, onContext, focusPrompt, welcomeMark, onSend, onStop, canSearch, voiceMode, voiceAvailable, onVoiceMode, busy, isolated }: Props) {
  const t = useLabels();
  const query = photo ? undefined : explicitSearchQuery(draft);
  const searchTooLong = query !== undefined && query.length > MAX_SEARCH_QUERY;
  const [dropping, setDropping] = useState(false);
  const limit = photo ? MAX_VISION_QUESTION : MAX_PROMPT;
  const canSend = (photo ? canAnalyze : !needsModelChoice) && !checking && !readingFiles && !!draft.trim() && draft.trim().length <= limit && !searchTooLong && (query === undefined || !!query.trim());
  const photoUrl = usePhotoUrl(photo?.blob);
  const attachEnabled = !checking && !busy && !readingFiles && !photo && files.length < MAX_FILES;
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
    {dropping && <div className="file-drop-hint" aria-live="polite"><Paperclip size={15} /> Drop images, documents, spreadsheets, or text files</div>}
    {(files.length > 0 || photo || readingFiles) && <div className="attachment-list" aria-label="Attachments">
      {files.map((file) => <div className="file-card" key={file.id}>
        <details>
          <summary title={file.name}><Paperclip size={14} /><span>{file.name}</span><small>{(/\.(pdf|docx|xlsx)$/i.exec(file.name)?.[1]?.toUpperCase() ?? 'Text')} preview</small></summary>
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
      <textarea
        ref={textarea} value={draft} disabled={checking || (!!photo && busy)} maxLength={limit} rows={2}
        placeholder={photo ? canAnalyze ? 'Ask about this image…' : 'Remove the image to send a text message…' : t('placeholder')} aria-label={t('message')}
        aria-describedby={photo ? 'vision-disclosure' : query !== undefined && canSearch ? 'search-disclosure' : undefined}
        onChange={(event) => {
          const field = event.currentTarget;
          const input = event.nativeEvent as InputEvent;
          if (beforeComposition.current === null && !input.isComposing && !input.inputType?.startsWith('delete')
            && typedCompletedWord(draft, field.value, field.selectionStart)) floatMascot(welcomeMark.current);
          onDraft(field.value);
        }}
        onCompositionStart={() => { beforeComposition.current = draft; }}
        onCompositionEnd={({ currentTarget: field }) => {
          const before = beforeComposition.current;
          beforeComposition.current = null;
          if (before !== null && typedCompletedWord(before, field.value, field.selectionStart, true)) floatMascot(welcomeMark.current);
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
        <button type="button" className="attach-button" title="Attach documents or an image" aria-label={t('attach')} disabled={!attachEnabled} onClick={() => filePicker.current?.click()}><Plus size={19} /></button>
        {photo ? <span className="vision-mode"><Image size={15} /> {canAnalyze ? 'Image analysis' : 'Image preview'}</span> : <>
          <div className="composer-context">
            <button type="button" className={`context-button${isolated ? ' context-isolated' : ''}`} aria-label={t('context')}
              title={isolated ? 'Message context: This message only' : 'Message context: Recent chat'} aria-haspopup="dialog" disabled={busy || checking} onClick={onContext}>
              <ListTree size={14} /><span>{t(isolated ? 'oneMessage' : 'chat')}</span>
            </button>
          </div>
        </>}
      </div>
      <div className="composer-actions">
        {!photo && <ReplyMenu mode={mode} model={model} needsModelChoice={needsModelChoice} models={models} effort={effort} onEffort={onEffort} sample={sample} disabled={busy || checking}
          onMode={onMode} onModel={onModel} onReturnToPrompt={focusPrompt} />}
        {!photo && <button type="button" className="voice-mode-button" aria-label={t('voiceMode')} aria-pressed={voiceMode} title={voiceAvailable ? t('voiceHelp') : t('noVoice')} disabled={checking} onClick={onVoiceMode}><AudioLines size={17} /></button>}
        {busy
          ? <button type="button" className="send-button" title={t('stop')} aria-label={t('stop')} onClick={onStop}><Square size={14} fill="currentColor" /></button>
          : <button type="submit" className="send-button" title={photo ? 'Review image upload' : t('send')} aria-label={photo ? 'Review image upload' : t('send')} disabled={!canSend}><ArrowUp size={21} strokeWidth={2.3} /></button>}
      </div>
    </div>
    {!photo && needsModelChoice ? <p className="context-disclosure" role="status">This chat used an earlier model. Choose a Helio model before sending or retrying with recent chat context.</p>
      : !photo && !model.available ? <p className="context-disclosure" role="status">{model.name} is unavailable for generated replies. Choose another model.</p> : null}
    {isolated && <p className="context-disclosure"><ShieldCheck size={13} /> This message only · Earlier exchanges and saved memory aren’t included.</p>}
    {usesMemory && !photo && <p className="context-disclosure"><Brain size={13} /> Saved memory can be used for this reply.</p>}
    {photo && <p id="vision-disclosure" className="search-disclosure">{!canAnalyze ? 'This is a local preview. Remove the image to send a text message.' : draft.trim().length > limit ? `Keep your question to ${limit} characters.` : 'Review before sending the image and question to OpenAI. No prior chat or memory is sent.'}</p>}
    {files.length > 0 && <p className="search-disclosure">Only extracted text is included when you ask Xyvora about a file. Long files are excerpted.</p>}
    {query !== undefined && canSearch && <p id="search-disclosure" className="search-disclosure">
      {searchTooLong ? `Keep search queries to ${MAX_SEARCH_QUERY} characters.` : `Only your query goes to SearXNG, not your attachments or chat history. Don’t include private information.`}
    </p>}
  </form>;
}
