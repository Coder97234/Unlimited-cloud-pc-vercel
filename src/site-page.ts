import { loadAccount, saveAccountSettings } from './lib/account.ts';
import { startAnalytics } from './lib/analytics.ts';
import { currentTheme, setBrowserTheme } from './lib/theme.ts';

startAnalytics();
const toggle = document.querySelector<HTMLButtonElement>('[data-theme-switch]');
let pending = Promise.resolve();
toggle?.addEventListener('click', () => {
  const theme = currentTheme() === 'dark' ? 'light' : 'dark';
  setBrowserTheme(theme);
  // Public pages work whether or not accounts are enabled. Never sync guest
  // preferences to the server or read an unverified ID from browser storage.
  pending = pending.then(async () => {
    const signal = AbortSignal.timeout(8_000);
    const account = await loadAccount(signal);
    if (account.user) await saveAccountSettings(account.user.id, { theme }, signal);
  }).catch(() => { /* The selected theme is still saved in this browser. */ });
});
