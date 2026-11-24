import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:4207').origin;
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Run against an isolated local preview.');
const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
assert.ok(password, 'Pipe in the corresponding local preview password.');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const notice = 'This website has been locked for an update.';
const errors = [];
try {
  for (const [width, height] of [[1302, 639], [390, 844], [280, 420]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600, colorScheme: 'light' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (/violates.*content security policy/i.test(message.text())) errors.push(message.text()); });
    page.setDefaultTimeout(12_000);
    const heading = page.getByRole('heading', { name: notice });
    const field = page.getByLabel('Early-access password');
    const submit = page.getByRole('button', { name: 'Unlock early access' });
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const lock = await page.goto(origin + (width < 600 ? '/about?test=direct' : '/'));
    assert.ok(await heading.isVisible());
    assert.ok(await noOverflow(), `${width}px lock notice overflows`);
    assert.match(lock.headers()['cache-control'], /no-store/);
    assert.equal(await page.locator('.app-shell').count(), 0);
    for (const path of ['/api/chat', '/api/account', '/api/analytics', '/api/workspace', '/theme.js', '/brand/xyvora-orbit.svg']) assert.equal((await context.request.get(origin + path)).status(), 423, path);
    if (width >= 600) {
      await field.fill('wrong-preview-password');
      const denial = page.waitForResponse(r => r.url().endsWith('/_xyvora/unlock') && r.request().method() === 'POST');
      await submit.click();
      assert.equal((await denial).status(), 401);
      await page.getByRole('alert').getByText('That password didn’t match.', { exact: false }).waitFor();
    }
    await field.fill(password);
    const unlocking = page.waitForResponse(r => r.url().endsWith('/_xyvora/unlock') && r.request().method() === 'POST');
    await submit.click();
    const accepted = await unlocking;
    assert.equal(accepted.status(), 303, 'Browser password form did not redirect after unlock');
    await page.getByRole('heading', { name: 'What can I help with?' }).waitFor();
    assert.ok(await noOverflow(), `${width}px workspace overflows`);
    assert.equal(await page.locator('html').getAttribute('data-edition'), 'early');
    assert.ok(await page.locator('.hero-orbit img').isVisible());
    const pick = page.getByRole('button', { name: 'Model: Helio 1 · Effort: Medium' });
    await pick.click();
    const menu = page.getByRole('menu', { name: 'Model', exact: true });
    await menu.waitFor();
    const bounds = await menu.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1, `${width}px reply menu is clipped`);
    if (width > 280) assert.ok(bounds.y + bounds.height <= (await pick.boundingBox()).y, 'Reply menu should open above the toolbar when it fits');
    assert.deepEqual(await menu.getByRole('menuitemradio').all().then(async (rows) => Promise.all(rows.map((row) => row.locator('strong').innerText()))),
      ['Helio 5', 'Helio 4', 'Helio 3', 'Helio 2', 'Helio 1']);
    await menu.getByRole('menuitem', { name: /^Effort/ }).click();
    const effort = page.getByRole('menu', { name: 'Effort', exact: true });
    await effort.getByRole('menuitemradio', { name: /^Low / }).click();
    const selected = page.getByRole('button', { name: 'Model: Helio 1 · Effort: Low' });
    await selected.click();
    await menu.getByRole('menuitem', { name: /^Effort/ }).click();
    assert.equal(await effort.getByRole('menuitemradio', { name: /^Low / }).getAttribute('aria-checked'), 'true');
    await page.keyboard.press('Escape');
    await effort.waitFor({ state: 'hidden' });
    await menu.waitFor({ state: 'hidden' });
    assert.equal(await selected.evaluate((button) => button === document.activeElement), true);
    if (width < 600) {
      const opener = page.getByRole('button', { name: 'Open sidebar' });
      await opener.click();
      await page.getByRole('button', { name: 'Close sidebar', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await opener.waitFor();
    }
    const cookie = (await context.cookies()).find(c => c.name === 'xyvora-early');
    assert.equal(cookie?.httpOnly, true);
    assert.ok(!(await page.evaluate(() => document.cookie)).includes('xyvora-early'));
    assert.equal((await context.request.get(origin + '/theme.js')).status(), 200);
    const status = await context.request.get(origin + '/api/chat');
    assert.equal(status.status(), 200);
    assert.match(status.headers()['cache-control'], /no-store/);
    if (width > 280) {
      const composer = page.getByRole('textbox', { name: 'Message Xyvora' });
      await composer.fill('Give me a one-sentence explanation of rainbows.');
      const streamed = page.waitForResponse(r => r.url().endsWith('/api/chat') && r.request().method() === 'POST');
      await composer.press('Enter');
      const reply = await streamed;
      assert.equal(reply.status(), 200);
      assert.match(reply.headers()['content-type'], /^text\/event-stream/);
      await page.locator('.answer-card .markdown').waitFor();
      await page.getByRole('button', { name: 'Retry latest prompt' }).waitFor();
      assert.match(await page.locator('.answer-card .markdown').innerText(), /sample response/i);
      assert.ok(await noOverflow(), `${width}px transcript overflows`);
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      await page.goto(origin + '/status');
      await page.getByText(/^Last checked /).waitFor();
      await page.goto(origin);
    }
    await page.getByRole('button', { name: 'Lock preview' }).click();
    await heading.waitFor();
    assert.ok(!(await context.cookies()).some(c => c.name === 'xyvora-early'));
    assert.equal((await context.request.get(origin + '/api/chat')).status(), 423);
    await page.goBack();
    await heading.waitFor();
    await context.close();
    console.log(`XYVORA_UPDATE ${width}px browser: locked routes, unlock, private workspace, relock and history passed`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
