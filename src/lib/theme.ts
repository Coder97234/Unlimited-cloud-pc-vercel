import type { Theme } from '../../shared/preferences.ts';

declare global {
  interface Window { xyvoraTheme?: { set: (theme: Theme) => void } }
}
export const currentTheme = (): Theme => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
export const setBrowserTheme = (theme: Theme) => window.xyvoraTheme?.set(theme);
