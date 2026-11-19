// Keep arbitrary content inert when displaying it as Markdown.
export function fencedText(text: string, language = '') {
  let longest = 2;
  for (const match of text.matchAll(/`{3,}/g)) longest = Math.max(longest, match[0].length);
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

let wordSegmenter: Intl.Segmenter | undefined;
let graphemeSegmenter: Intl.Segmenter | undefined;
export function textStats(text: string) {
  if (!text.trim()) return 'Paste text after `/text`, or attach a text file and send `/text`.';
  let words = 0, characters = 0;
  if (typeof Intl.Segmenter === 'function') {
    wordSegmenter ??= new Intl.Segmenter('en', { granularity: 'word' });
    graphemeSegmenter ??= new Intl.Segmenter('en', { granularity: 'grapheme' });
    for (const item of wordSegmenter.segment(text)) if (item.isWordLike) words++;
    for (const _item of graphemeSegmenter.segment(text)) characters++;
  } else {
    words = text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
    characters = Array.from(text).length;
  }
  const lines = text.split(/\r\n|\n|\r/).length;
  const seconds = words ? Math.max(1, Math.round(words / 225 * 60)) : 0;
  const time = seconds < 60 ? `${seconds} sec` : `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
  return `- **Words:** ${words.toLocaleString('en-US')}\n- **Characters (including spaces):** ${characters.toLocaleString('en-US')}\n- **Lines:** ${lines.toLocaleString('en-US')}\n- **Estimated reading time:** ${time}`;
}

export function formatJson(input: string) {
  const text = input.trim().replace(/^```(?:json)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```$/i, '$1');
  if (!text) return 'Paste JSON after `/json`, or attach a `.json` file and send `/json`.';
  try { JSON.parse(text); }
  catch { return 'That isn’t valid JSON. Check for missing quotes or commas, comments, and trailing commas.'; }
  // Validate first, then reformat the original tokens. Serializing the parsed
  // object would lose precision on large numbers and remove duplicate fields.
  const tokens = text.match(/"(?:[^"\\]|\\[\s\S])*"|[\[\]{},:]|[^\s\[\]{},:"]+/g) ?? [];
  let output = '', depth = 0;
  const newline = () => '\n' + '  '.repeat(depth);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '{' || token === '[') {
      depth++;
      if (depth > 24) return 'That JSON is nested more than 24 levels. Format a smaller section at a time.';
      output += token + (tokens[i + 1] === '}' || tokens[i + 1] === ']' ? '' : newline());
    } else if (token === '}' || token === ']') {
      depth--;
      output += (tokens[i - 1] === '{' || tokens[i - 1] === '[' ? '' : newline()) + token;
    } else if (token === ',') output += ',' + newline();
    else if (token === ':') output += ': ';
    else output += token;
    if (output.length > 30_000) return 'That formatted JSON would be too long to display here. Try a smaller section.';
  }
  return `Valid JSON.\n\n${fencedText(output, 'json')}`;
}

function textOperation(argument: string, attachedText?: string) {
  const [action, text] = /^(\S+)(?:\s+([\s\S]+))?$/.exec(argument)?.slice(1) ?? [];
  return { action: action?.toLowerCase(), text: text || attachedText || '' };
}

export function changeCase(argument: string, attachedText?: string) {
  const { action, text } = textOperation(argument, attachedText);
  if (!text || (action !== 'upper' && action !== 'lower')) return 'Try `/case upper hello` or `/case lower HELLO`. You can also attach text and send `/case upper` or `/case lower`.';
  const output = action === 'upper' ? text.toUpperCase() : text.toLowerCase();
  return fencedText(output);
}

export function cleanLines(argument: string, attachedText?: string) {
  const { action, text } = textOperation(argument, attachedText);
  if (!text || (action !== 'unique' && action !== 'sort')) return 'Type `/lines unique` or `/lines sort`, then paste one item per line, or attach a text file.';
  const lines = text.split(/\r\n|\n|\r/).map((line) => line.trim()).filter(Boolean);
  const result = [...new Set(lines)];
  if (action === 'sort') result.sort(new Intl.Collator('en', { numeric: true }).compare);
  if (!result.length) return 'There are no non-empty lines to keep.';
  const duplicateCount = lines.length - result.length;
  return `**${result.length} ${result.length === 1 ? 'line' : 'lines'} kept** · ${duplicateCount} ${duplicateCount === 1 ? 'duplicate' : 'duplicates'} removed.\n\n${fencedText(result.join('\n'))}`;
}
