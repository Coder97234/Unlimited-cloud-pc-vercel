import { MAX_ATTACHMENT } from '../../shared/models.ts';
import type { TextAttachment } from '../../shared/models.ts';

export const MAX_FILES = 3;
export const ACCEPTED_FILES = '.pdf,.txt,.md,.csv,.tsv,.json,.jsonl,.js,.mjs,.ts,.py,.log,.yaml,.yml,.xml,.html,.css,.sql';
const extensions = ACCEPTED_FILES.split(',');
const maxBytes = 4_000_000;
export type LocalFile = TextAttachment & { id: string; truncated: boolean };

export async function readLocalFile(file: File, signal: AbortSignal): Promise<LocalFile> {
  const name = file.name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100).trim() || 'attachment.txt';
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (!extensions.includes(extension)) throw new Error(`${name}: choose a text, code, CSV, JSON, or PDF file.`);
  if (file.size > maxBytes) throw new Error(`${name}: files can be at most 4 MB.`);
  let text: string, truncated: boolean;
  if (extension === '.pdf') {
    const { pdfText } = await import('./pdf-text.ts');
    ({ text, truncated } = await pdfText(file, signal));
  } else {
    const bytes = Math.min(file.size, (MAX_ATTACHMENT + 1) * 4);
    truncated = bytes < file.size;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try { text = decoder.decode(await file.slice(0, bytes).arrayBuffer(), { stream: truncated }); }
    catch { throw new Error(`${name}: this doesn’t appear to be UTF-8 text.`); }
  }
  signal.throwIfAborted();
  if (!text.trim() || text.includes('\0')) throw new Error(`${name}: no readable text was found. Scanned PDFs need OCR first.`);
  return { id: crypto.randomUUID(), name, text: text.trim().slice(0, MAX_ATTACHMENT), truncated: truncated || text.trim().length > MAX_ATTACHMENT };
}

export function combineFiles(files: LocalFile[]): TextAttachment | undefined {
  if (!files.length) return;
  if (files.length === 1) return { name: files[0].name, text: files[0].text };
  const titles = files.map(({ name }) => `\n\n--- File: ${name} ---\n`);
  let budget = MAX_ATTACHMENT - titles.join('').length;
  const text = files.map((file, i) => {
    const limit = Math.floor(budget / (files.length - i));
    const piece = file.text.slice(0, limit);
    budget -= piece.length;
    return titles[i] + piece;
  }).join('').trim();
  return { name: `${files.length} files: ${files.map((file) => file.name).join(', ')}`.slice(0, 120), text };
}
