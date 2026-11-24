import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:4213').origin;
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Use an isolated local preview.');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const variant = { id: 'former-model', version: '4.16', label: 'Earlier hosted chat model' };
const archive = [{ id: 'archived-choice', mode: 'chat', title: 'Earlier model chat', updatedAt: 1, turns: [
  { id: 'older-turn', prompt: 'An earlier prompt', answers: [{ model: 'xyvora', source: 'server', state: 'finished', content: 'A saved answer.', tier: 'apex', modelVariant: variant,
    hostedModel: { provider: 'openai', model: 'earlier-backend', variant }, effort: 'high', replyMode: 'pro' }] },
] }];
const content = 'The area is $$\\pi r^2$$ [1].\n\n```js\nconst area = (r) => Math.PI * r ** 2;\n```';
const sources = [{ title: 'Geometry', url: 'https://example.org/geometry', provider: 'searxng' }];
const sse = (...events) => events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');

try {
  for (const width of [1302, 390, 280]) {
    const context = await browser.newContext({ viewport: { width, height: 720 }, isMobile: width < 500, hasTouch: width < 500, colorScheme: width === 390 ? 'dark' : 'light' });
    const errors = [], prompts = [];
    let models = ['xyvora', 'helio-2'];
    const advancedEngine = { runner: 'ollama', id: 'fixture-advanced-27b' };
    await context.addInitScript((chats) => {
      if (!localStorage.getItem('xyvora.conversations.v1')) localStorage.setItem('xyvora.conversations.v1', JSON.stringify(chats));
    }, archive);
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort());
    await context.route(`${origin}/api/account`, (route) => route.fulfill({ json: { user: null, providers: [], passwords: false } }));
    await context.route(`${origin}/api/chat`, async (route) => {
      const request = route.request();
      assert.equal(request.headers()['x-xyvora-account'], undefined);
      if (request.method() === 'GET') return route.fulfill({ json: models.length > 1 ? { availability: 'server', models, sampleModels: ['xyvora'], webSearch: true } : { availability: 'preview', models } });
      const data = request.postDataJSON();
      prompts.push(data);
      return route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-xyvora-source': 'server' }, body: sse(
        { localModel: data.model === 'helio-5' ? advancedEngine : { runner: 'llama.cpp', id: 'fixture-local-2b' } }, { sources }, { choices: [{ delta: { content } }] }, '[DONE]'),
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    const trigger = (name) => page.getByRole('button', { name: new RegExp(`^Model: Helio ${name} · Effort`) });
    await trigger(2).waitFor(); // Live local inference is preferred to a sample on new chats.
    if (width > 500) { await trigger(2).focus(); await trigger(2).press('ArrowDown'); }
    else await trigger(2).click();
    const menu = page.getByRole('menu', { name: 'Model' });
    await menu.waitFor();
    const radios = menu.getByRole('menuitemradio');
    assert.deepEqual((await radios.allTextContents()).map((text) => text.slice(0, 7)), ['Helio 5', 'Helio 4', 'Helio 3', 'Helio 2', 'Helio 1']);
    assert.equal(await menu.getByRole('menuitem', { name: /^Effort/ }).count(), 1);
    assert.equal(await menu.getByRole('menuitem', { name: /^Reply style/ }).count(), 1);
    assert.equal(await menu.getByRole('menuitem').count(), 2);
    assert.equal(await page.getByText(/More models|Search models|Catalog only/).count(), 0);
    assert.equal(await radios.filter({ hasText: 'Helio 5' }).getAttribute('aria-disabled'), 'true');
    assert.match(await radios.filter({ hasText: 'Helio 5' }).textContent(), /Advanced reasoning/);
    assert.equal(await radios.filter({ hasText: 'Helio 4' }).getAttribute('aria-disabled'), 'true');
    assert.match(await radios.filter({ hasText: 'Helio 1' }).textContent(), /Sample replies/);
    const bounds = await menu.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= 721);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    const openEarlier = async () => {
      if (width < 500) await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
      await page.locator('.history-entry').getByText('Earlier model chat', { exact: true }).click();
    };
    await openEarlier();
    await page.getByText('A saved answer.', { exact: true }).waitFor();
    await page.getByText(/This chat used an earlier model/).waitFor();
    await trigger(4).waitFor();
    const retry = page.getByRole('button', { name: 'Retry latest prompt' });
    await retry.click();
    await page.getByText('Select a Helio model before continuing this earlier chat.', { exact: true }).waitFor();
    assert.equal(prompts.length, 0);
    await trigger(4).click();
    await menu.getByRole('menuitemradio', { name: /^Helio 2/ }).click();
    await trigger(2).waitFor();
    assert.equal(await trigger(2).getAttribute('aria-label'), 'Model: Helio 2 · Effort: High');
    await retry.click();
    await page.locator('.markdown .katex math').waitFor();
    assert.equal(await page.locator('.markdown .inline-citation').getAttribute('href'), sources[0].url);
    await page.getByRole('button', { name: 'Copy code block' }).waitFor();
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].model, 'helio-2');
    assert.equal(prompts[0].mode, 'pro');
    assert.equal(prompts[0].effort, 'high');
    assert.equal(prompts[0].messages.at(-1).content, archive[0].turns[0].prompt);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('xyvora.conversations.v1'))?.[0]?.turns[0]?.answers[0]?.state === 'finished');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('xyvora.conversations.v1'))[0].turns[0].answers[0]);
    assert.deepEqual(stored.localModel, { runner: 'llama.cpp', id: 'fixture-local-2b' });
    assert.equal(stored.model, 'helio-2');
    assert.equal(stored.modelVariant, undefined);
    assert.equal(await page.getByText('fixture-local-2b', { exact: false }).count(), 0, 'Only branded model names show in the new conversation');
    // An installed advanced model becomes selectable without changing the
    // current choice, effort or style. Save its ID and restore it on reopen.
    models = ['xyvora', 'helio-2', 'helio-3', 'helio-4', 'helio-5'];
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await trigger(2).click();
    await menu.getByRole('menuitemradio', { name: /^Helio 5/ }).click();
    await trigger(5).waitFor();
    assert.equal(await trigger(5).getAttribute('aria-label'), 'Model: Helio 5 · Effort: High');
    await page.getByRole('textbox', { name: 'Message Xyvora' }).fill('Explain this for a rectangle.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.waitForFunction(() => {
      const answer = JSON.parse(localStorage.getItem('xyvora.conversations.v1'))?.[0]?.turns.at(-1)?.answers[0];
      return answer?.model === 'helio-5' && answer?.state === 'finished';
    });
    assert.equal(prompts.length, 2);
    assert.equal(prompts[1].model, 'helio-5');
    assert.equal(prompts[1].mode, 'pro');
    assert.equal(prompts[1].effort, 'high');
    const top = await page.evaluate(() => JSON.parse(localStorage.getItem('xyvora.conversations.v1'))[0].turns.at(-1).answers[0]);
    assert.equal(top.tier, 'advanced');
    assert.equal(top.model, 'helio-5');
    assert.deepEqual(top.localModel, advancedEngine);
    assert.equal(await page.getByText(advancedEngine.id, { exact: false }).count(), 0);
    await page.reload();
    await openEarlier();
    await trigger(5).waitFor();
    // Simulate an inventory change in the same session; never reroute the already selected tier.
    models = ['xyvora'];
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.getByText(/Helio 5 is unavailable/).waitFor();
    await trigger(5).waitFor();
    await retry.click();
    await page.getByText('Helio 5 is unavailable. Choose another model.', { exact: true }).waitFor();
    assert.equal(prompts.length, 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`XYVORA_HELIO ${width}px: branded menu, legacy confirmation, exact tier/effort/style, math and sources, Helio 5 persistence and inventory removal.`);
  }
} finally { await browser.close(); }
