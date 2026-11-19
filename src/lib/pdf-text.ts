import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { MAX_ATTACHMENT } from '../../shared/models.ts';

GlobalWorkerOptions.workerSrc = workerUrl;
const pageLimit = 6;

// Text extraction only: no rendering, scripting, link navigation, or embedded
// file handling. The parser runs in PDF.js's worker; tear it down on timeout.
export async function pdfText(file: File, signal: AbortSignal) {
  const data = new Uint8Array(await file.arrayBuffer());
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
  deadline.throwIfAborted();
  const task = getDocument({ data, enableXfa: false, useWorkerFetch: false, useSystemFonts: false, useWasm: false, disableFontFace: true, stopAtErrors: true });
  const stop = () => { void task.destroy().catch(() => undefined); };
  deadline.addEventListener('abort', stop, { once: true });
  try {
    const pdf = await task.promise;
    const count = Math.min(pdf.numPages, pageLimit);
    let text = '';
    for (let n = 1; n <= count && text.length < MAX_ATTACHMENT; n++) {
      deadline.throwIfAborted();
      const page = await pdf.getPage(n);
      const reader = page.streamTextContent().getReader();
      let pageText = '';
      try {
        while (text.length + pageText.length <= MAX_ATTACHMENT) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const item of value.items) if ('str' in item) {
            pageText += item.str + (item.hasEOL ? '\n' : ' ');
            if (text.length + pageText.length > MAX_ATTACHMENT) break;
          }
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); page.cleanup(); }
      if (pageText.trim()) text += `${text ? '\n\n' : ''}Page ${n}\n${pageText.trimEnd()}`;
    }
    return { text, truncated: pdf.numPages > count || text.length >= MAX_ATTACHMENT };
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Could not extract text from this PDF. Use an unlocked, text-based PDF under 4 MB.');
  } finally { deadline.removeEventListener('abort', stop); await task.destroy().catch(() => undefined); }
}
