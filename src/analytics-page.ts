import type { AnalyticsReport } from '../shared/analytics.ts';
import { analyticsEnabled, setAnalytics } from './lib/analytics.ts';

const $ = (id: string) => document.getElementById(id);
const count = new Intl.NumberFormat();
const clock = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });
const status = $('metrics-status');
let reading = false;
function showMetrics(visible: boolean) {
  for (const id of ['metrics-grid', 'metrics-trends']) { const node = $(id); if (node) node.hidden = !visible; }
}
async function refresh() {
  if (!status || reading) return;
  reading = true;
  const button = $('refresh-metrics') as HTMLButtonElement | null;
  if (button) button.disabled = true;
  try {
    const response = await fetch('/api/analytics', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(8_000) });
    const data = await response.json();
    if (!response.ok || !data.available || !data.report) {
      showMetrics(false);
      status.textContent = 'Usage data is not available right now.';
      status.dataset.state = 'unavailable';
      return;
    }
    const report: AnalyticsReport = data.report;
    for (const field of ['active', 'today', 'browsers', 'returning', 'accounts'] as const) {
      const node = $(`metric-${field}`);
      if (node && Number.isSafeInteger(report[field])) node.textContent = count.format(report[field]);
    }
    const rate = $('returning-rate');
    if (rate) rate.textContent = report.browsers > 0 ? `${Math.round(100 * report.returning / report.browsers)}% of measured browsers` : 'No measured visits yet';
    const chart = $('visits-chart'), table = $('visits-table');
    if (chart && table && Array.isArray(report.days)) {
      const peak = Math.max(1, ...report.days.map(({ browsers }) => browsers));
      const bars = report.days.map(({ date, browsers }) => {
        const bar = document.createElement('span');
        bar.className = 'visit-bar'; bar.title = `${date}: ${count.format(browsers)}`;
        // Use a vertical scale with a small visible baseline for zero days.
        bar.style.height = `${Math.max(3, 100 * browsers / peak)}%`;
        return bar;
      });
      const rows = report.days.slice().reverse().map(({ date, browsers }) => {
        const row = document.createElement('tr'); row.insertCell().textContent = date; row.insertCell().textContent = count.format(browsers); return row;
      });
      chart.replaceChildren(...bars); table.replaceChildren(...rows);
    }
    showMetrics(true);
    status.dataset.state = 'live';
    status.textContent = `Updated ${clock.format(new Date(report.updatedAt))} · refreshes every 30 seconds`;
  } catch { showMetrics(false); status.dataset.state = 'unavailable'; status.textContent = 'The report is temporarily unavailable. Try refreshing.'; }
  finally { reading = false; if (button) button.disabled = false; }
}
$('refresh-metrics')?.addEventListener('click', () => void refresh());
if (status) { void refresh(); setInterval(() => { if (!document.hidden) void refresh(); }, 30_000); }

const consent = $('cookie-choice');
const accept = $('analytics-on') as HTMLButtonElement | null;
const decline = $('analytics-off') as HTMLButtonElement | null;
if (consent) consent.textContent = analyticsEnabled() ? 'Optional analytics is on in this browser.' : 'Optional analytics is off in this browser.';
async function choose(enabled: boolean) {
  if (!consent || !accept || !decline) return;
  accept.disabled = decline.disabled = true;
  try {
    await setAnalytics(enabled);
    consent.textContent = enabled ? 'Optional analytics is on in this browser.' : 'Optional analytics is off. Previously recorded activity identifiable by this browser was removed.';
  } catch (error) {
    consent.textContent = error instanceof Error ? error.message : 'Could not update your choice.';
  } finally { accept.disabled = decline.disabled = false; }
}
accept?.addEventListener('click', () => void choose(true));
decline?.addEventListener('click', () => void choose(false));
