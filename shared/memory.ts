export type MemoryProfile = { enabled: boolean; notes: string[] };
export const MAX_MEMORY_NOTES = 8;
export const MAX_MEMORY_NOTE = 220;
export const MAX_MEMORY_CHARS = 1_000;
export const emptyMemory = (): MemoryProfile => ({ enabled: false, notes: [] });

export function parseMemoryNotes(input: unknown): string[] | undefined {
  if (!Array.isArray(input) || input.length > MAX_MEMORY_NOTES) return;
  const notes: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string' || item.length > MAX_MEMORY_NOTE || /[\x00-\x1f\x7f]/.test(item)) return;
    const note = item.trim();
    if (note && !notes.includes(note)) notes.push(note);
  }
  return notes.join(' ').length <= MAX_MEMORY_CHARS ? notes : undefined;
}

export function parseMemory(input: unknown): MemoryProfile | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const { enabled, notes: raw } = input as Record<string, unknown>;
  const notes = parseMemoryNotes(raw);
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
  return !temporary && !isolated && profile?.enabled && profile.notes.length > 0 ? profile.notes : undefined;
}
