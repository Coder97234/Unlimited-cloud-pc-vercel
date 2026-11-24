import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';

const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:4208').origin;
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Use an isolated local preview.');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1302, height: 639 }, colorScheme: 'dark', permissions: ['clipboard-read', 'clipboard-write'] });
const owner = randomUUID(), participant = { id: owner, name: 'Fixture account', email: 'fixture@example.invalid' };
const calls = [], appReads = [], errors = [];
let settings = {}, saved = [], revision = null, signedIn = true, gmail = 'connected';
const result = { messages: [{ subject: 'A fixture subject', from: 'fixture@example.invalid', date: 'Fixture date' }] };
const code = 'const values = [2, 3];\nconsole.log(values.join(","));';
const evidence = { title: 'NASA news', url: 'https://www.nasa.gov/news/', provider: 'searxng' };
const events = (...items) => items.map((item) => `data: ${typeof item === 'string' ? item : JSON.stringify(item)}\n\n`).join('');

try {
  // No external host, live OAuth, speech service, or live inference in this test.
  await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort());
  await context.route(/\/api\/account(?:\?|$)/, async (route) => {
    const req = route.request(), section = new URL(req.url()).searchParams.get('section');
    if (section) assert.equal(req.headers()['x-xyvora-account'], owner);
    if (section === 'settings') { Object.assign(settings, req.postDataJSON().settings); return route.fulfill({ json: { settings } }); }
    if (section === 'memory') return route.fulfill({ json: { profile: { enabled: true, notes: [] } } });
    if (section === 'history') {
      if (req.method() === 'POST') { saved = req.postDataJSON().chats; revision = randomUUID(); }
      return route.fulfill({ json: { chats: saved, revision } });
    }
    return route.fulfill({ json: { user: signedIn ? participant : null, providers: [], passwords: false, settings: signedIn ? settings : {} } });
  });
  await context.route(`${origin}/api/workspace?feature=connections`, async (route) => {
    const req = route.request();
    assert.equal(req.headers()['x-xyvora-account'], owner);
    assert.equal(signedIn, true, 'An old account must not request app details');
    if (req.method() === 'GET') return route.fulfill({ json: { connections: { gmail, vercel: 'unconfigured' } } });
    const review = req.postDataJSON();
    assert.equal(review.approved, true);
    assert.equal(review.provider, 'gmail');
    appReads.push(review);
    if (review.action === 'disconnect') { gmail = 'disconnected'; return route.fulfill({ json: { disconnected: true, revoked: true } }); }
    assert.equal(review.action, 'account'); assert.equal(review.operation, 'inbox');
    return route.fulfill({ json: result });
  });
  await context.route(`${origin}/api/chat`, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { availability: 'server', models: ['xyvora', 'helio-2', 'helio-3', 'helio-4'], webSearch: true, research: true } });
    const data = route.request().postDataJSON();
    calls.push(data);
    const outbound = data.model === 'helio-4' ? [{ localModel: { runner: 'ollama', id: 'fixture-apex' } }] : [];
    assert.equal(route.request().headers()['x-xyvora-account'], undefined, 'Non-project Helio replies do not require an account header');
    await route.fulfill({ headers: { 'Content-Type': 'text/event-stream', 'X-Xyvora-Source': 'server' }, body: events(...outbound,
      { searching: true }, { sources: [evidence] }, { choices: [{ delta: { content: `Estado comprobado [1].\n\n\`\`\`js\n${code}\n\`\`\`` } }] }, '[DONE]') });
  });
  await context.addInitScript(() => {
    const voice = (voiceURI, lang, localService) => ({ voiceURI, name: voiceURI, lang, localService, default: false });
    const calls = window.fixtureSpeech = [];
    const voices = [voice('Fixture English', 'en-US', true), voice('Fixture Spanish', 'es-ES', true), voice('Remote Spanish', 'es-ES', false)];
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { constructor(text) { this.text = text; } } });
    Object.defineProperty(window, 'speechSynthesis', { value: Object.assign(new EventTarget(), {
      getVoices: () => voices,
      speak: (utterance) => calls.push([utterance.voice?.voiceURI, utterance.lang, utterance.text]),
      cancel: () => calls.push('stop'),
    }) });
    const fetcher = window.fetch;
    window.fetch = (path, init) => {
      if (path === '/api/chat' && init?.body && JSON.parse(init.body).messages.at(-1).content === '/search latest NASA launch news') {
        window.fixtureCanceled = false;
        const body = new ReadableStream({ start(stream) {
          stream.enqueue(new TextEncoder().encode('data: {"searching":true}\n\n'));
          init.signal.addEventListener('abort', () => { window.fixtureCanceled = true; stream.error(init.signal.reason); }, { once: true });
        } });
        return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'X-Xyvora-Source': 'server' } }));
      }
      return fetcher(path, init);
    };
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(10_000);
  const dialog = page.getByRole('dialog');
  const settingsButton = () => page.locator('.workspace-settings').click();
  const message = () => page.locator('.composer textarea');
  async function ask(prompt) { await message().fill(prompt); await message().press('Enter'); }
  await page.goto(`${origin}/?connection=gmail-connected`);
  await dialog.getByText('Connected', { exact: true }).waitFor().catch(async (error) => {
    console.error('Initial connection UI:', (await page.locator('body').innerText()).slice(0, 1600), errors); throw error;
  });
  assert.equal(new URL(page.url()).search, '');
  assert.equal(appReads.length, 0);
  await dialog.getByRole('button', { name: 'Read recent inbox headers' }).click();
  assert.equal(appReads.length, 0);
  await dialog.getByRole('button', { name: 'Approve this read' }).click();
  await dialog.getByText('A fixture subject', { exact: false }).waitFor();
  assert.equal(appReads.length, 1);
  assert.equal(calls.length, 0);
  await dialog.getByRole('button', { name: 'Add result to chat draft' }).click();
  await message().waitFor();
  assert.match(await message().inputValue(), /Summarize the approved app result/);
  assert.equal(calls.length, 0, 'Adding an attachment never sends a message');
  await page.getByRole('button', { name: 'Remove Approved app result.txt' }).click();
  await settingsButton();
  const search = dialog.getByRole('searchbox', { name: 'Search settings' });
  await search.fill('automatic web search');
  await search.press('Enter');
  const toggle = dialog.getByRole('switch', { name: 'Automatic web search' });
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  await toggle.click();
  await dialog.getByRole('button', { name: 'Voice & language', exact: true }).click();
  await dialog.getByLabel('App language').selectOption('es');
  await page.locator('html[lang="es"]').waitFor({ state: 'attached' });
  assert.equal(await dialog.getByLabel('Voz del dispositivo').locator('option').count(), 2, 'Remote and unrelated voices must not be offered');
  await dialog.getByRole('button', { name: 'Probar voz' }).click();
  assert.deepEqual((await page.evaluate(() => window.fixtureSpeech))[0].slice(0, 2), ['Fixture Spanish', 'es-ES']);
  await page.keyboard.press('Escape');
  assert.equal((await page.evaluate(() => window.fixtureSpeech)).at(-1), 'stop', 'Closing settings stops the voice test');
  await page.getByRole('button', { name: /^Modelo: Helio 1/ }).click();
  await page.getByRole('menuitemradio', { name: /^Helio 4/ }).click();
  await page.getByRole('button', { name: /^Modelo: Helio 4/ }).click();
  await page.getByRole('menuitem', { name: /^Esfuerzo/ }).click();
  await page.getByRole('menuitemradio', { name: /^Max / }).click();
  await page.getByRole('button', { name: 'Modo de voz', exact: true }).click();
  await ask('/search NASA news');
  await page.getByRole('button', { name: 'Copiar bloque de código' }).waitFor();
  assert.equal(calls[0].model, 'helio-4'); assert.equal(calls[0].effort, 'max');
  assert.equal(calls[0].language, 'es'); assert.equal(calls[0].autoSearch, false);
  assert.equal(calls[0].searchQuery, 'NASA news'); assert.equal(calls[0].attachment, undefined);
  assert.equal(await page.locator('.markdown').getAttribute('lang'), 'es');
  assert.equal(await page.locator('.markdown .inline-citation').getAttribute('href'), evidence.url);
  await page.getByRole('button', { name: 'Copiar bloque de código' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code);
  assert.equal((await page.evaluate(() => window.fixtureSpeech)).at(-1)[2], 'Estado comprobado.');
  await page.getByRole('button', { name: 'Detener lectura' }).click();
  await ask('/search latest NASA launch news');
  await page.getByText('Buscando en la web', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Detener respuesta' }).click();
  await page.getByText('Response stopped.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureCanceled), true);
  await settingsButton();
  await dialog.getByRole('button', { name: 'Conexiones', exact: true }).click();
  await dialog.getByRole('button', { name: 'Manage', exact: true }).click();
  await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
  assert.equal(appReads.length, 1);
  await dialog.getByRole('button', { name: 'Confirm disconnect', exact: true }).click();
  await dialog.getByText('Gmail disconnected.', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  signedIn = false;
  await page.reload();
  await page.locator('.topbar').getByRole('button', { name: 'Guest workspace' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('.history-entry').count(), 0);
  assert.equal(await page.getByText('A fixture subject', { exact: false }).count(), 0);
  assert.equal(appReads.length, 2);
  assert.deepEqual(errors, []);
  console.log('XYVORA_EXPERIENCE fixture: approval + staged result, settings search, Spanish voice and response, independent model/effort, whole-block copy, citation, cancellation, account isolation.');
} finally { await browser.close(); }
