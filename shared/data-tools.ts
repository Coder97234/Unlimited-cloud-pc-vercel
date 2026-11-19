import { fencedText } from './text-tools.ts';

export function encodeText(kind: 'url' | 'base64', argument: string, attached?: string) {
  const op = /^(encode|decode)(?:\s+([\s\S]+))?$/i.exec(argument);
  const text = op?.[2] ?? attached;
  if (!op || !text) return `Try \`/${kind} encode hello world\` or \`/${kind} decode\` with an attachment.`;
  try {
    const encode = op[1].toLowerCase() === 'encode';
    if (kind === 'url') return fencedText(encode ? encodeURIComponent(text) : decodeURIComponent(text));
    if (encode) return fencedText(btoa(Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join('')));
    const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
    return fencedText(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return `That isn’t valid ${kind === 'url' ? 'URL-encoded' : 'Base64-encoded UTF-8'} text.`; }
}

export function jsonPointer(argument: string, attached?: string) {
  const pointer = /^\S+/.exec(argument)?.[0];
  if (!pointer?.startsWith('/') || pointer.length > 230 || /~(?![01])/.test(pointer)) return 'Use a JSON pointer such as `/jsonpick /items/0/name` with a JSON attachment or JSON after the pointer.';
  try {
    let value: unknown = JSON.parse(argument.slice(pointer.length).trim() || attached || '');
    for (const part of pointer.slice(1).split('/')) {
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return 'No value exists at that JSON pointer.';
      value = (value as Record<string, unknown>)[key];
    }
    return fencedText(JSON.stringify(value, null, 2).slice(0, 18_000), 'json');
  } catch { return 'I couldn’t read that JSON. Attach a valid JSON file or paste it after the pointer.'; }
}

export function csvSummary(text: string) {
  if (!text.trim()) return 'Attach a CSV file or paste CSV after `/csv`. The first row is treated as headers.';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  const usage = 'I couldn’t parse this CSV. Check that quoted fields are closed and escape quotes as `""`.';
  const push = () => { row.push(cell); cell = ''; closed = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === ',') push();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      push();
      if (row.length > 1 || row[0].trim()) rows.push(row);
      row = [];
    } else if (c === '"' && !cell && !closed) quoted = true;
    else if (closed || c === '"') return usage;
    else cell += c;
  }
  if (quoted) return usage;
  if (cell || row.length || closed) { push(); rows.push(row); }
  const headers = rows.shift();
  if (!headers) return 'The CSV has no rows.';
  const ragged = rows.filter((cells) => cells.length !== headers.length).length;
  const names = headers.slice(0, 24).map((name, i) => `${i + 1}. ${name.replace(/\s+/g, ' ').trim().slice(0, 100) || '(unnamed)'}`);
  return `**${rows.length} data rows · ${headers.length} columns**${ragged ? ` · ${ragged} rows differ from the header width` : ''}\n\n${fencedText(names.join('\n') + (headers.length > 24 ? '\n…' : ''))}`;
}

export function compareLists(text: string) {
  const parts = text.split(/^[ \t]*---[ \t]*$/m);
  if (parts.length !== 2) return 'Paste two lists separated by a line containing `---`, then send `/comparelists`.';
  const sets = parts.map((part) => new Set(part.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)));
  const left = [...sets[0]].filter((line) => !sets[1].has(line));
  const right = [...sets[1]].filter((line) => !sets[0].has(line));
  const describe = (lines: string[]) => fencedText(lines.slice(0, 30).join('\n') + (lines.length > 30 ? '\n…' : '') || '(none)');
  return `**Shared:** ${sets[0].size - left.length} · **Only first:** ${left.length} · **Only second:** ${right.length}\n\nFirst list only:\n${describe(left)}\n\nSecond list only:\n${describe(right)}`;
}
