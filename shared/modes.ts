export const MODES = {
  normal: { name: 'Normal', description: 'Balanced for everyday questions and writing.' },
  thinker: { name: 'Thinker', description: 'Compare options, check assumptions, and explain the conclusion.' },
  pro: { name: 'Pro', description: 'Technical help with concrete steps, examples, and checks.' },
  creative: { name: 'Creative', description: 'Brainstorm, tell stories, and explore different directions.' },
} as const;

export type ReplyMode = keyof typeof MODES;
export const DEFAULT_MODE: ReplyMode = 'normal';
export const MODE_IDS = Object.keys(MODES) as ReplyMode[];
export const isReplyMode = (value: unknown): value is ReplyMode => typeof value === 'string' && Object.hasOwn(MODES, value);
