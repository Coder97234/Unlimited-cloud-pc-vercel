import { DEFAULT_MODE, isReplyMode, MODES, MODE_IDS } from '../shared/modes.ts';
import { ChatError, streamChat } from './lib/stream.ts';

const form = document.querySelector<HTMLFormElement>('#api-playground')!;
const mode = form.querySelector<HTMLSelectElement>('select')!;
const run = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
const stop = form.querySelector<HTMLButtonElement>('#stop-request')!;
const state = document.getElementById('playground-state')!;
const output = document.getElementById('playground-output')!;
for (const id of MODE_IDS) mode.add(new Option(MODES[id].name, id));
mode.value = 'instant';
let active: AbortController | undefined;
stop.addEventListener('click', () => active?.abort());
window.addEventListener('pagehide', () => active?.abort());
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (active) return;
  const prompt = String(new FormData(form).get('prompt') ?? '').trim();
  if (!prompt) { state.textContent = 'Write a prompt before running the request.'; return; }
  const controller = active = new AbortController();
  run.disabled = true; stop.hidden = false; output.hidden = true; output.textContent = '';
  state.textContent = 'Connecting to the API…';
  let text = '', source = 'API';
  try {
    await streamChat([{ role: 'user', content: prompt }], AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]), {
      mode: isReplyMode(mode.value) ? mode.value : DEFAULT_MODE,
      onSource: (kind) => { source = kind === 'preview' ? 'Preview sample' : kind === 'skill' ? 'Built-in tool' : kind === 'clock' ? 'Live clock' : 'Live API'; state.textContent = `${source} · streaming`; },
      onText: (delta) => { text = (text + delta).slice(0, 36_000); output.hidden = false; output.textContent = text; },
      onSources: () => {},
    });
    state.textContent = `${source} · ${text.trim() ? 'complete' : 'empty response'}`;
  } catch (error) {
    state.textContent = controller.signal.aborted ? 'Request stopped.' : error instanceof ChatError ? error.message : 'The request did not finish. Try again.';
  } finally { active = undefined; run.disabled = false; stop.hidden = true; }
});
form.hidden = false;
