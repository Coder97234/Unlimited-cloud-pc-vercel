import { isReplyMode } from './modes.ts';
import type { ReplyMode } from './modes.ts';

export type Theme = 'light' | 'dark';
export const APPEARANCE = {
  accent: ['iris', 'lagoon', 'ember'],
  density: ['comfortable', 'compact'],
  textSize: ['regular', 'large'],
  font: ['xyvora', 'system'],
} as const;
export type Appearance = { [K in keyof typeof APPEARANCE]: typeof APPEARANCE[K][number] };
export type WorkspacePreferences = Partial<Appearance> & { theme?: Theme; mode?: ReplyMode };
export const DEFAULT_APPEARANCE: Appearance = { accent: 'iris', density: 'comfortable', textSize: 'regular', font: 'xyvora' };
export function parsePreferences(input: unknown): WorkspacePreferences | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const { theme, mode } = input as Record<string, unknown>;
  if (theme !== undefined && theme !== 'light' && theme !== 'dark') return;
  if (mode !== undefined && !isReplyMode(mode)) return;
  const result: Record<string, unknown> = { ...(theme && { theme }), ...(mode && { mode }) };
  for (const [key, values] of Object.entries(APPEARANCE)) {
    const value = (input as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (!values.some((allowed) => value === allowed)) return;
    result[key] = value;
  }
  return result as WorkspacePreferences;
}
