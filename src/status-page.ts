const summary = document.getElementById('service-summary')!;
const button = document.querySelector<HTMLButtonElement>('#refresh-services')!;
async function check(path: string) {
  try {
    const response = await fetch(path, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(8_000) });
    return response.ok ? await response.json() : undefined;
  } catch { return undefined; }
}
function state(service: string, text: string, live = false) {
  const node = document.getElementById(`service-${service}`)!;
  node.textContent = text; node.dataset.state = live ? 'live' : 'unavailable';
}
async function refresh() {
  if (button.disabled) return;
  button.disabled = true; summary.textContent = 'Checking services…';
  try {
    const [chat, analytics] = await Promise.all([check('/api/chat'), check('/api/analytics')]);
    state('chat', chat?.availability === 'server' ? 'Accepting requests' : chat?.availability === 'preview' ? 'Preview · sample replies' : 'Unavailable', chat?.availability === 'server');
    state('search', chat?.webSearch === true ? 'Available' : 'Unavailable', chat?.webSearch === true);
    state('analytics', analytics?.available === true ? 'Available' : 'Unavailable', analytics?.available === true);
    summary.textContent = `Last checked at ${new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date())}.`;
  } finally { button.disabled = false; }
}
document.getElementById('service-details')!.hidden = false;
button.addEventListener('click', () => void refresh());
void refresh();
