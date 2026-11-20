export const MODES = {
  normal: { name: 'Normal', description: 'Balanced for everyday questions and writing.' },
  instant: { name: 'Instant', description: 'Quick, concise replies. Uses less chat history and a shorter reply limit.' },
  thinker: { name: 'Thinker', description: 'Compare options, check assumptions, and explain the conclusion.' },
  pro: { name: 'Pro', description: 'Technical help with concrete steps, examples, and checks.' },
  creative: { name: 'Creative', description: 'Brainstorm, tell stories, and explore different directions.' },
} as const;

export type ReplyMode = keyof typeof MODES;
export const DEFAULT_MODE: ReplyMode = 'normal';
export const MODE_IDS = Object.keys(MODES) as ReplyMode[];
export const isReplyMode = (value: unknown): value is ReplyMode => typeof value === 'string' && Object.hasOwn(MODES, value);

// Instant keeps at most one small completed exchange. The latest user prompt
// (and any explicitly attached text) is subject to the same limits as Normal.
export const INSTANT_HISTORY_CHARS = 1_200;
export function modeContext<T extends { content: string }>(messages: T[], mode: ReplyMode): T[] {
  if (mode !== 'instant' || messages.length < 3) return messages;
  const recent = messages.slice(-3);
  return recent[0].content.length + recent[1].content.length <= INSTANT_HISTORY_CHARS ? recent : recent.slice(-1);
}
