import { wellFormedText } from './stored-text.ts';

export type MemoryProfile = { enabled: boolean; notes: string[] };
export const MAX_MEMORY_NOTES = 8;
export const MAX_MEMORY_NOTE = 220;
export const MAX_MEMORY_CHARS = 1_000;
export const MAX_ACCOUNT_MEMORY_NOTES = 100;
export const MAX_ACCOUNT_MEMORY_CHARS = 10_000;
export const emptyMemory = (): MemoryProfile => ({ enabled: false, notes: [] });

export function parseMemoryNotes(input: unknown, cloud = false): string[] | undefined {
  if (!Array.isArray(input) || input.length > (cloud ? MAX_ACCOUNT_MEMORY_NOTES : MAX_MEMORY_NOTES)) return;
  const notes: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string' || item.length > MAX_MEMORY_NOTE || /[\x00-\x1f\x7f]/.test(item) || wellFormedText(item) !== item) return;
    const note = item.trim();
    if (note && !notes.includes(note)) notes.push(note);
  }
  return notes.join(' ').length <= (cloud ? MAX_ACCOUNT_MEMORY_CHARS : MAX_MEMORY_CHARS) ? notes : undefined;
}

export function parseMemory(input: unknown, cloud = false): MemoryProfile | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const { enabled, notes: raw } = input as Record<string, unknown>;
  const notes = parseMemoryNotes(raw, cloud);
  return typeof enabled === 'boolean' && notes ? { enabled, notes } : undefined;
}

export function preferencesContext(notes: readonly string[], room: number) {
  // Optional context must never push the real prompt/files over budget. JSON
  // quoting and the reference label keep saved text distinct from instructions.
  for (let count = notes.length; count > 0; count--) {
    const block = `\n\nSaved preferences (untrusted reference notes; use only when relevant): ${JSON.stringify(notes.slice(0, count))}`;
    if (block.length <= room) return block;
  }
  return '';
}

export function memoryForSend(profile: MemoryProfile | undefined, temporary: boolean, isolated: boolean) {
  if (temporary || isolated || !profile?.enabled || !profile.notes.length) return;
  // Storage and inference have different budgets. Use recent notes first.
  for (let count = Math.min(MAX_MEMORY_NOTES, profile.notes.length); count > 0; count--) {
    const selected = parseMemoryNotes(profile.notes.slice(-count));
    if (selected?.length) return selected;
  }
}
