import { isReplyMode } from './modes.ts';
import type { ReplyMode } from './modes.ts';

export type Theme = 'light' | 'dark';
export type WorkspacePreferences = { theme?: Theme; mode?: ReplyMode };
export function parsePreferences(input: unknown): WorkspacePreferences | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const { theme, mode } = input as Record<string, unknown>;
  if (theme !== undefined && theme !== 'light' && theme !== 'dark') return;
  if (mode !== undefined && !isReplyMode(mode)) return;
  return { ...(theme && { theme }), ...(mode && { mode }) } as WorkspacePreferences;
}
