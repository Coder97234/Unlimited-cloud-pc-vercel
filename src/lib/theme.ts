import { DEFAULT_APPEARANCE, parsePreferences } from '../../shared/preferences.ts';
import type { Appearance, Theme, WorkspacePreferences } from '../../shared/preferences.ts';

declare global {
  interface Window { xyvoraTheme?: { set: (theme: Theme) => void } }
}
export const currentTheme = (): Theme => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
export const setBrowserTheme = (theme: Theme) => window.xyvoraTheme?.set(theme);

const appearanceKey = 'xyvora.appearance.v1';
export function browserAppearance(): Appearance {
  try { return appearanceFrom(parsePreferences(JSON.parse(localStorage.getItem(appearanceKey) ?? 'null'))); }
  catch { return DEFAULT_APPEARANCE; }
}
export function appearanceFrom(prefs: WorkspacePreferences | undefined): Appearance {
  return { accent: prefs?.accent ?? DEFAULT_APPEARANCE.accent, density: prefs?.density ?? DEFAULT_APPEARANCE.density,
    textSize: prefs?.textSize ?? DEFAULT_APPEARANCE.textSize, font: prefs?.font ?? DEFAULT_APPEARANCE.font };
}
export function styleWorkspace(appearance: Appearance, persist: boolean) {
  if (persist) try { localStorage.setItem(appearanceKey, JSON.stringify(appearance)); } catch { /* Appearance still updates in this tab. */ }
  Object.assign(document.documentElement.dataset, appearance);
}

// The older appearance key stays independent. Only the guest workspace reads
// these preferences; the signed-in workspace uses its account settings.
const prefsKey = 'xyvora.preferences.v1';
export function browserPreferences(): WorkspacePreferences {
  try { return parsePreferences(JSON.parse(localStorage.getItem(prefsKey) ?? 'null')) ?? {}; } catch { return {}; }
}
export function storeBrowserPreferences(prefs: WorkspacePreferences) {
  try { localStorage.setItem(prefsKey, JSON.stringify(prefs)); } catch { /* They still apply in this tab. */ }
}
