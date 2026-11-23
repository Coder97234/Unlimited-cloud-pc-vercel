declare const __XYVORA_EARLY_ACCESS__: boolean;

// Vite inlines only this edition bit, never the key or its verifier.
export const EARLY_ACCESS = typeof __XYVORA_EARLY_ACCESS__ !== 'undefined' && __XYVORA_EARLY_ACCESS__;
export const PUBLIC_CREDENTIALS: RequestCredentials = EARLY_ACCESS ? 'same-origin' : 'omit';
export function styleEarlyAccess() {
  if (!EARLY_ACCESS) return;
  document.documentElement.dataset.edition = 'early';
  // Re-check the gate after a history restore, including after ending access.
  window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
}
