import { MAX_ATTACHMENT } from '../../shared/models.ts';

const maxPart = 800_000, maxParts = 2_000_000;
const decoder = new TextDecoder('utf-8', { fatal: true });
const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const sheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRels = 'http://schemas.openxmlformats.org/package/2006/relationships';
const archiveError = () => new Error('The Office document is invalid or has unsupported compression.');

type Part = { position: number; compressed: number; size: number; method: number; flags: number };
function zipDirectory(data: ArrayBuffer) {
  const view = new DataView(data);
  let end = -1;
  for (let at = view.byteLength - 22; at >= Math.max(0, view.byteLength - 65_557); at--) {
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === view.byteLength) { end = at; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw archiveError();
  const entries = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true);
  const finish = start + view.getUint32(end + 12, true);
  if (entries > 400 || entries !== view.getUint16(end + 8, true) || start > finish || finish > end) throw archiveError();
  let at = start;
  const parts = new Map<string, Part>();
  for (let i = 0; i < entries; i++) {
    if (at + 46 > finish || view.getUint32(at, true) !== 0x02014b50) throw archiveError();
    const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
    if (at + 46 + nameLength + extra + comment > finish || nameLength > 350) throw archiveError();
    const name = decoder.decode(new Uint8Array(data, at + 46, nameLength));
    if (parts.has(name)) throw archiveError();
    parts.set(name, { position: view.getUint32(at + 42, true), compressed: view.getUint32(at + 20, true), size: view.getUint32(at + 24, true),
      method: view.getUint16(at + 10, true), flags: view.getUint16(at + 8, true) });
    at += 46 + nameLength + extra + comment;
  }
  let budget = maxParts;
  async function xml(name: string, signal: AbortSignal, required = true) {
    const part = parts.get(name);
    if (!part && !required) return;
    if (!part || part.size > maxPart || part.size > budget) throw new Error('This Office document is too complex to preview. Export it as text or CSV.');
    budget -= part.size;
    const { position: at, compressed, flags, method, size } = part;
    if ((flags & 1) || ![0, 8].includes(method) || at + 30 > start || view.getUint32(at, true) !== 0x04034b50) throw archiveError();
    const offset = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
    if (offset + compressed > start || (method === 0 && compressed !== size)) throw archiveError();
    signal.throwIfAborted();
    let value: string;
    if (method === 0) value = decoder.decode(new Uint8Array(data, offset, size));
    else {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack Office documents. Use text or CSV.');
      const decompressor = new DecompressionStream('deflate-raw');
      const reader = new Blob([data.slice(offset, offset + compressed)]).stream().pipeThrough(decompressor, { signal }).getReader();
      const bytes = new Uint8Array(size);
      let read = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (read + value.length > size) throw archiveError();
          bytes.set(value, read); read += value.length;
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      if (read !== size) throw archiveError();
      value = decoder.decode(bytes);
    }
    // Never resolve document entities, relationships to other origins, scripts,
    // or style sheets. DOMParser stays detached and only textContent is read.
    if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw archiveError();
    const parsed = new DOMParser().parseFromString(value, 'application/xml');
    if (parsed.getElementsByTagName('parsererror').length) throw archiveError();
    return parsed;
  }
  return xml;
}

const firstText = (el: Element, ns: string, name: string) => el.getElementsByTagNameNS(ns, name).item(0)?.textContent ?? '';
const joinText = (el: Element, ns: string, name: string) => Array.from(el.getElementsByTagNameNS(ns, name), (chunk) => chunk.textContent ?? '').join('');
const csv = (value: string) => /[\n\r,"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export async function officeText(file: File, kind: '.docx' | '.xlsx', signal: AbortSignal): Promise<{ text: string; truncated: boolean }> {
  const xml = zipDirectory(await file.arrayBuffer());
  let text = '', truncated = false;
  const add = (line: string) => { text += (text ? '\n' : '') + line; if (text.length > MAX_ATTACHMENT) truncated = true; };
  if (kind === '.docx') {
    const doc = (await xml('word/document.xml', signal))!;
    for (const paragraph of doc.getElementsByTagNameNS(word, 'p')) {
      const value = joinText(paragraph, word, 't');
      if (value.trim()) add(value);
      if (truncated) break;
    }
  } else {
    const book = (await xml('xl/workbook.xml', signal))!, rels = (await xml('xl/_rels/workbook.xml.rels', signal))!;
    const strings = await xml('xl/sharedStrings.xml', signal, false);
    const lookups = strings ? Array.from(strings.getElementsByTagNameNS(sheet, 'si'), (el) => joinText(el, sheet, 't')) : [];
    const targets = new Map<string, string>();
    for (const rel of rels.getElementsByTagNameNS(packageRels, 'Relationship')) {
      const id = rel.getAttribute('Id'), target = rel.getAttribute('Target');
      if (rel.getAttribute('TargetMode') === 'External' || !id || !target) continue;
      const safe = target.replace(/^\/xl\//, '');
      if (/^worksheets\/sheet[\d-]{1,8}\.xml$/.test(safe)) targets.set(id, `xl/${safe}`);
    }
    const streams = Array.from(book.getElementsByTagNameNS(sheet, 'sheet'));
    for (const [index, item] of streams.entries()) {
      if (index >= 3 || truncated) { truncated = true; break; }
      const path = targets.get(item.getAttributeNS(relationships, 'id') ?? '');
      if (!path) continue;
      const content = (await xml(path, signal))!;
      if (streams.length > 1) add(`# Sheet: ${(item.getAttribute('name') ?? '').replace(/[\x00-\x1f]/g, ' ').slice(0, 70) || index+1}`);
      for (const [rowIndex, row] of Array.from(content.getElementsByTagNameNS(sheet, 'row')).entries()) {
        if (rowIndex >= 250 || truncated) { truncated = true; break; }
        const values: string[] = [];
        for (const cell of row.getElementsByTagNameNS(sheet, 'c')) {
          const column = /^(\$?[A-Z]{1,3})\d+$/.exec(cell.getAttribute('r') ?? '')?.[1].replace('$', '');
          const col = column ? [...column].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1 : values.length;
          if (col >= 64) { truncated = true; continue; }
          const raw = firstText(cell, sheet, 'v'), type = cell.getAttribute('t');
          values[col] = csv(type === 's' && /^\d{1,7}$/.test(raw) ? lookups[Number(raw)] ?? '' : type === 'inlineStr' ? joinText(cell, sheet, 't') : raw);
        }
        if (values.length) add(values.join(','));
      }
    }
  }
  signal.throwIfAborted();
  return { text: text.slice(0, MAX_ATTACHMENT), truncated };
}
