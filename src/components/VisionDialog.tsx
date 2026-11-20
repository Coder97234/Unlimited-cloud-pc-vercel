import { Image, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { VisionPhoto } from '../lib/vision-file.ts';
import { Dialog } from './Dialog.tsx';

export function usePhotoUrl(blob?: Blob) {
  const [current, setCurrent] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) { setCurrent(undefined); return; }
    const url = URL.createObjectURL(blob);
    setCurrent({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return current && current.blob === blob ? current.url : undefined;
}

export function VisionDialog({ photo, question, onApprove, onClose }: { photo: VisionPhoto; question: string; onApprove: (accessCode: string) => void; onClose: () => void }) {
  const [code, setCode] = useState('');
  const url = usePhotoUrl(photo.blob);
  return <Dialog title="Review image upload" subtitle="Ask AI a question about this image." onClose={onClose}>
    <form className="plugin-fields" onSubmit={(event) => { event.preventDefault(); if (code.trim()) onApprove(code.trim()); }}>
      <figure className="vision-preview">
        {url ? <img src={url} alt="Image to analyze" /> : <LoaderCircle size={18} aria-label="Preparing image preview" />}
        <figcaption><strong>{photo.name}</strong><span>{photo.width} × {photo.height}</span></figcaption>
      </figure>
      <blockquote className="branch-quote vision-question">{question}</blockquote>
      <p className="plugin-notice"><ShieldCheck size={17} /> Only this image and question go to OpenAI. Xyvora resizes it if needed and removes original metadata. No earlier chat, files, or memory notes are sent.</p>
      <p className="form-hint">Chats can save the question and reply, not the image itself. Avoid sensitive images. Approval can use the owner’s AI credits.</p>
      <label className="field-label">Studio access code<input className="plugin-input" type="password" autoComplete="off" required maxLength={180} value={code} onChange={({ target }) => setCode(target.value)} /></label>
      <div className="dialog-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="plugin-primary" disabled={!code.trim()}><Image size={16} /> Approve &amp; analyze</button>
      </div>
    </form>
  </Dialog>;
}
