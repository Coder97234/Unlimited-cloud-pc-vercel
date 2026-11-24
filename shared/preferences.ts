import { isEffort, isLanguage, isReplyLanguage } from './experience.ts';
import type { Effort, Language, LanguagePreference } from './experience.ts';
import { wellFormedText } from './stored-text.ts';
import { isReplyMode } from './modes.ts';
import type { ReplyMode } from './modes.ts';

export type Theme = 'light' | 'dark';
export const APPEARANCE = {
  accent: ['orange', 'lagoon', 'ember'],
  density: ['comfortable', 'compact'],
  textSize: ['regular', 'large'],
  font: ['xyvora', 'system'],
} as const;
export type Appearance = { [K in keyof typeof APPEARANCE]: typeof APPEARANCE[K][number] };
export type WorkspacePreferences = Partial<Appearance> & { theme?: Theme; mode?: ReplyMode; effort?: Effort; language?: Language; replyLanguage?: LanguagePreference; nickname?: string; autoSearch?: boolean };
export const DEFAULT_APPEARANCE: Appearance = { accent: 'orange', density: 'comfortable', textSize: 'regular', font: 'xyvora' };
export function parsePreferences(input: unknown): WorkspacePreferences | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const { theme, mode, effort, language, replyLanguage, nickname, autoSearch } = input as Record<string, unknown>;
  if (theme !== undefined && theme !== 'light' && theme !== 'dark') return;
  if (mode !== undefined && !isReplyMode(mode)) return;
  if ((effort !== undefined && !isEffort(effort)) || (language !== undefined && !isLanguage(language))
    || (replyLanguage !== undefined && replyLanguage !== 'interface' && !isReplyLanguage(replyLanguage))) return;
  if (nickname !== undefined && (typeof nickname !== 'string' || nickname.length > 40 || /[\x00-\x1f\x7f]/.test(nickname) || wellFormedText(nickname) !== nickname)) return;
  if (autoSearch !== undefined && typeof autoSearch !== 'boolean') return;
  const result: Record<string, unknown> = { ...(theme && { theme }), ...(mode && { mode }), ...(effort && { effort }), ...(language && { language }), ...(replyLanguage && { replyLanguage }),
    ...(typeof nickname === 'string' && { nickname: nickname.trim() }), ...(typeof autoSearch === 'boolean' && { autoSearch }) };
  for (const [key, values] of Object.entries(APPEARANCE)) {
    const value = (input as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (key === 'accent' && value === 'iris') { result[key] = 'orange'; continue; } // Upgrade old browser/account settings.
    if (!values.some((allowed) => value === allowed)) return;
    result[key] = value;
  }
  return result as WorkspacePreferences;
}
