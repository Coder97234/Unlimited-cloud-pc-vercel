const key = 'xyvora.analytics.choice.v1';
const idKey = 'xyvora.analytics.browser.v1';
const privacySignal = () => (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
export const analyticsEnabled = () => {
  try { return !privacySignal() && localStorage.getItem(key) === 'yes'; } catch { return false; }
};
let pinging: Promise<Response> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let lastAction = Date.now();

function analyticsPost(body: object) {
  return fetch('/api/analytics', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(8_000) });
}
export async function trackVisit() {
  if (!analyticsEnabled() || document.hidden || Date.now() - lastAction > 90_000 || pinging) return;
  try {
    const id = localStorage.getItem(idKey) ?? crypto.randomUUID();
    localStorage.setItem(idKey, id);
    pinging = analyticsPost({ action: 'ping', consent: true, id });
    await pinging;
  } catch { /* Analytics never prevents chat. */ }
  finally { pinging = undefined; }
}
export async function setAnalytics(enabled: boolean) {
  if (enabled && privacySignal()) throw new Error('Global Privacy Control is enabled. Analytics stays off.');
  localStorage.setItem(key, enabled ? 'yes' : 'no');
  if (enabled) { lastAction = Date.now(); await trackVisit(); return; }
  await pinging?.catch(() => undefined);
  const id = localStorage.getItem(idKey);
  if (id) {
    const cleared = await analyticsPost({ action: 'forget', id });
    if (!cleared.ok) throw new Error('Analytics is off. Couldn’t delete earlier activity yet; try again later.');
    localStorage.removeItem(idKey);
  }
}
export function startAnalytics() {
  if (heartbeat) return;
  const touch = () => { lastAction = Date.now(); };
  window.addEventListener('pointerdown', touch, { passive: true }); window.addEventListener('keydown', touch);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { touch(); void trackVisit(); } });
  void trackVisit();
  heartbeat = setInterval(() => void trackVisit(), 50_000);
}
