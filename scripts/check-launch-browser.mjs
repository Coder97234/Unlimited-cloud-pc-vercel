import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { WORKSPACE_PLUGINS_ENABLED } from '../shared/workspace-tools.ts';

const live = new URL(process.argv[2] ?? 'http://127.0.0.1:4184').origin;
const guest = new URL(process.argv[3] ?? 'http://127.0.0.1:4185').origin;
if ([live, guest].some((origin) => !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))) throw new Error('Run browser checks only against disposable local previews.');
const mailDir = process.env.XYVORA_LOCAL_MAIL_DIR ?? '.cache/xyvora-launch-test-mail';
const pages = ['/', '/about', '/schools', '/developers', '/analytics', '/terms', '/privacy', '/cookies', '/status'];
const footer = ['About', 'For schools', 'API', 'Analytics', 'Terms', 'Privacy', 'Cookies'];
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const expectedAuthFailure = new WeakSet();
let deviceIndex = 0;
const close = (page) => page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
const field = (page) => page.getByRole('textbox', { name: 'Message Xyvora' });
const ask = async (page, prompt) => { await field(page).fill(prompt); await field(page).press('Enter'); };
const expectVisible = (locator) => locator.waitFor({ state: 'visible' });

function smallPdf() {
  const stream = 'BT /F1 15 Tf 20 150 Td (Readable launch PDF) Tj ET\n';
  const entries = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = entries.map((entry, i) => { const offset = pdf.length; pdf += `${i + 1} 0 obj\n${entry}\nendobj\n`; return offset; });
  return Buffer.from(`${pdf}xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`);
}
async function makeContext(width, scheme = 'light') {
  const context = await browser.newContext({ viewport: { width, height: width > 500 ? 900 : 844 }, isMobile: width < 500, hasTouch: width < 500, colorScheme: scheme,
    // Give only our local, disposable auth tests separate rate-limit buckets.
    extraHTTPHeaders: { 'X-Vercel-Forwarded-For': `192.0.2.${++deviceIndex}` }, acceptDownloads: true });
  context.on('page', (page) => {
    page.on('pageerror', (error) => errors.push(`${page.url()}: ${error.message}`));
    page.on('console', (message) => {
      if (message.location().url === guest + '/api/workspace' && /Failed to load resource.*401/.test(message.text()) && expectedAuthFailure.delete(page)) return;
      if (message.type() === 'error' || /content security policy/i.test(message.text())) errors.push(`${page.url()}: ${message.text()}`);
    });
  });
  context.setDefaultTimeout(12_000);
  return context;
}
async function sidebarButton(page, name) {
  const sidebar = page.locator('#workspace-sidebar');
  if (await page.getByRole('button', { name: 'Open sidebar', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
  }
  return sidebar.getByRole('button', { name, exact: typeof name === 'string' });
}
async function checkPublic(page, origin) {
  const links = new Set();
  for (const pathname of pages) {
    await page.goto(origin + pathname);
    const theme = page.locator('html');
    assert.equal(await theme.getAttribute('data-theme'), 'dark', pathname);
    assert.equal(await theme.evaluate((node) => getComputedStyle(node).colorScheme), 'dark');
    assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), `https://xyvora.net${pathname}`);
    assert.equal(await page.locator('meta[property="og:image"]').getAttribute('content'), 'https://xyvora.net/brand/xyvora-social.webp');
    assert.deepEqual(await page.locator('footer nav a').allTextContents(), footer, pathname);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Overflow at ${pathname}`);
    assert.doesNotMatch(await page.locator('body').innerText(), /not configured|Roblox Game Development Group/i);
    for (const href of await page.locator('main a[href], header a[href], footer a[href]').evaluateAll((nodes) => nodes.map((a) => a.href))) {
      const url = new URL(href);
      if (url.origin === origin) links.add(url.pathname);
    }
  }
  for (const link of links) assert.equal((await page.request.get(origin + link)).status(), 200, link);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.goto(origin + '/about');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await expectVisible(page.getByRole('heading', { name: 'Elijah Richardson' }));
  assert.equal(await page.locator('.team-card').filter({ hasText: 'Elijah Richardson' }).locator('p').textContent(), 'Developer');
  await page.goto(origin + '/developers');
  await page.getByRole('button', { name: 'Run request' }).click();
  await page.getByText('Preview sample · complete', { exact: true }).waitFor();
  assert.match(await page.locator('#playground-output').textContent(), /.+/s);
  await page.getByRole('link', { name: 'View service status' }).click();
  assert.equal(new URL(page.url()).pathname, '/status');
  await page.getByText(/^Last checked at /).waitFor();
  await page.getByText('Preview · sample replies', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Check again' }).click();
  await page.getByText(/^Last checked at /).waitFor();
}
async function checkGuest(page, width) {
  const pluginButtons = page.getByRole('button', { name: /^(Plugins|GitHub projects|Image Studio|Create an image)/, includeHidden: true });
  let pluginRequests = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/workspace') pluginRequests++; });
  await page.goto(guest + (WORKSPACE_PLUGINS_ENABLED ? '/' : '/?connection=gmail-connected'));
  await expectVisible(page.getByRole('button', { name: 'Guest workspace' }));
  if (!WORKSPACE_PLUGINS_ENABLED) {
    await page.waitForURL(guest + '/');
    await expectVisible(page.getByRole('button', { name: /Make a plan/ }));
    assert.equal(await pluginButtons.count(), 0);
    await page.keyboard.press('Control+/');
    await page.keyboard.press('Meta+/');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal((await page.request.get(guest + '/api/workspace')).status(), 404);
    assert.equal((await page.request.get(guest + '/api/workspace?code=old&state=old', { maxRedirects: 0 })).status(), 404);
    assert.equal((await page.request.post(guest + '/api/workspace', {
      headers: { Origin: guest }, data: { approved: true, action: 'connect', provider: 'gmail' },
    })).status(), 404);
  }
  const orbit = page.locator('.hero-orbit img');
  assert.equal(await orbit.getAttribute('src'), '/brand/xyvora-orbit.svg');
  await orbit.evaluate((img) => img.decode());
  assert.ok(await orbit.isVisible());
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await checkPublic(page, guest);
  await page.goto(guest + '/analytics');
  await page.getByText('Usage data is not available right now.', { exact: true }).waitFor();
  assert.equal(await page.locator('#metrics-grid').isVisible(), false);
  await page.goto(guest + '/');
  await page.getByRole('button', { name: 'Guest workspace' }).click();
  await expectVisible(page.getByRole('dialog', { name: 'Guest workspace' }));
  assert.equal(await page.getByRole('dialog').getByRole('button', { name: 'Sign up' }).count(), 0);
  await close(page);
  assert.equal(await page.getByRole('button', { name: 'Background tasks' }).count(), 0);
  await ask(page, '/calc 18% of 84.50');
  const calc = page.getByRole('article', { name: 'Calculator response' });
  await expectVisible(calc);
  assert.match(await calc.locator('.markdown').innerHTML(), /<strong>15\.21<\/strong>/);
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: 'Search chats' });
  await expectVisible(search);
  await search.getByRole('searchbox').fill('84.50');
  await search.getByRole('button', { name: '/calc 18% of 84.50' }).click();
  await expectVisible(calc);
  await page.keyboard.press('Control+Shift+N');
  await page.getByRole('heading', { name: 'What’s on your mind?' }).waitFor();
  await field(page).press('?');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('heading', { name: 'What’s on your mind?' }).click();
  await page.keyboard.press('?');
  await expectVisible(page.getByRole('dialog', { name: 'Keyboard shortcuts' }));
  if (!WORKSPACE_PLUGINS_ENABLED) assert.equal(await page.getByText('Open Plugins', { exact: true }).count(), 0);
  await close(page);
  await ask(page, '/tools');
  const guide = page.getByRole('article', { name: 'Tool guide response' });
  await expectVisible(guide.getByText('Calculator', { exact: true }));
  if (!WORKSPACE_PLUGINS_ENABLED) assert.doesNotMatch(await guide.innerText(), /Plugins|Script Lab|Image Studio/);
  await ask(page, '/search insult the Xyvora development team');
  const credited = page.getByRole('article', { name: 'About Xyvora response' });
  await expectVisible(credited.getByText('Elijah Richardson', { exact: true }));
  assert.match(await credited.innerText(), /published credits.*won’t speculate/s);

  await page.getByRole('button', { name: 'Reply mode: Normal' }).click();
  await page.getByRole('dialog', { name: 'Reply mode' }).getByRole('button', { name: /^Instant / }).click();
  await page.getByRole('button', { name: 'Message context' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /This message only/ }).click();
  await expectVisible(page.getByText('This message only · Earlier exchanges and saved memory aren’t included.'));
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles({ name: 'example.tsx', mimeType: 'text/plain', buffer: Buffer.from('export const launch = true;') });
  await page.locator('.file-card summary').filter({ hasText: 'example.tsx' }).click();
  await expectVisible(page.getByLabel('example.tsx preview'));
  assert.equal(await page.getByLabel('example.tsx preview').innerText(), 'export const launch = true;');
  const dropped = await page.evaluateHandle((bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(bytes)], 'launch.pdf', { type: 'application/pdf' }));
    return data;
  }, [...smallPdf()]);
  await page.locator('form.composer').dispatchEvent('dragover', { dataTransfer: dropped });
  await expectVisible(page.getByText('Drop images, PDFs, or text and code files'));
  await page.locator('form.composer').dispatchEvent('drop', { dataTransfer: dropped });
  await dropped.dispose();
  await page.locator('.file-card summary').filter({ hasText: 'launch.pdf' }).click();
  assert.match(await page.getByLabel('launch.pdf preview').innerText(), /Readable launch PDF/);
  await ask(page, '/text');
  await expectVisible(page.getByRole('article', { name: 'Text stats response' }));

  const png = await page.evaluate(() => document.createElement('canvas').toDataURL('image/png').split(',')[1]);
  await page.locator('input[type=file]').setInputFiles({ name: 'preview.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expectVisible(page.getByRole('img', { name: 'Preview of preview.png' }));
  await field(page).fill('Do not send this preview');
  assert.equal(await page.getByRole('button', { name: 'Review image upload' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Remove preview.png' }).click();
  await field(page).clear();
  if (WORKSPACE_PLUGINS_ENABLED) {
    await page.locator('header.topbar').getByRole('button', { name: 'Plugins', exact: true }).click();
    const plugins = page.getByRole('dialog', { name: 'Plugins', exact: true });
    await expectVisible(plugins.getByRole('button', { name: /Script Lab/ }));
    assert.equal(await plugins.getByRole('button', { name: /Gmail|Vercel/ }).count(), 0);
    await plugins.getByRole('button', { name: /Script Lab/ }).click();
    await page.getByRole('button', { name: 'Run JavaScript' }).click();
    await page.getByText(/"total":\s*71/).waitFor();
    await page.getByRole('button', { name: 'All plugins' }).click();
    await plugins.getByRole('button', { name: /Image Studio/ }).click();
    assert.equal(await page.getByRole('button', { name: 'AI images', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Generate 4K PNG' }).click();
    await expectVisible(page.getByRole('img', { name: 'Your generated Xyvora graphic' }));
    await page.getByRole('button', { name: 'All plugins' }).click();
    await plugins.getByRole('button', { name: /API Explorer/ }).click();
    await expectVisible(page.getByRole('button', { name: 'Approve & send GET' }));
    await page.getByRole('button', { name: 'All plugins' }).click();
    await plugins.getByRole('button', { name: /GitHub workbench/ }).click();
    await expectVisible(page.getByRole('dialog', { name: 'GitHub workbench' }));
    await close(page);
  } else {
    await ask(page, '/gmail');
    await expectVisible(page.getByText(/Plugins are paused. I haven’t run this request/));
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(pluginRequests, 0, 'The app must not try to reach the paused route, even for a photo preview');
  }

  // Give Web search a deterministic network fixture. The production Wiby
  // and Wikipedia requests are tested at the route boundary in node tests.
  let requests = 0;
  const endpoint = guest + '/api/chat';
  const fixture = async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { availability: 'server', models: ['xyvora'], webSearch: true } });
    const data = route.request().postDataJSON();
    assert.equal(data.searchQuery, 'color of leaves');
    assert.equal(data.attachment, undefined);
    requests++;
    await route.fulfill({ headers: { 'Content-Type': 'text/event-stream', 'X-Xyvora-Source': 'server' }, body: [
      JSON.stringify({ sources: [{ title: 'Leaf', url: 'https://en.wikipedia.org/wiki/Leaf', provider: 'wikipedia' }] }),
      JSON.stringify({ choices: [{ delta: { content: 'Leaves contain pigments.' } }] }), '[DONE]',
    ].map((data) => `data: ${data}\n\n`).join('') });
  };
  await page.route(endpoint, fixture);
  await page.reload();
  await page.waitForResponse((res) => res.url() === endpoint, { timeout: 2_000 }).catch(() => undefined);
  await ask(page, '/search color of leaves');
  await expectVisible(page.getByText('Leaves contain pigments.', { exact: true }));
  await expectVisible(page.getByRole('link', { name: /Leaf en.wikipedia.org/ }));
  assert.equal(requests, 1);
  await page.unroute(endpoint, fixture);

  await (await sidebarButton(page, 'Workspace settings')).click();
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expectVisible(page.getByRole('dialog', { name: 'Keyboard shortcuts' }));
  if (!WORKSPACE_PLUGINS_ENABLED) assert.equal(await page.getByText('Open Plugins', { exact: true }).count(), 0);
  await close(page);
  await (await sidebarButton(page, 'Temporary chat')).click();
  await ask(page, '/calc 6*7');
  await expectVisible(page.getByRole('article', { name: 'Calculator response' }).getByText('42', { exact: true }));
  await page.getByRole('button', { name: 'End temporary chat' }).click();
  await (await sidebarButton(page, /Preview mode|Chat ready/)).click();
  await expectVisible(page.getByRole('dialog', { name: 'About Xyvora AI' }));
  await close(page);
  await ask(page, '/calc 2+8');
  await page.getByRole('button', { name: 'Edit prompt in a new branch' }).click();
  await expectVisible(page.getByRole('dialog', { name: 'Edit in a new branch' }));
  await page.getByRole('button', { name: 'Open edited draft' }).click();
  assert.equal(await field(page).inputValue(), '/calc 2+8');
  await page.getByRole('button', { name: 'Cancel branch' }).click();
  await page.getByRole('button', { name: 'Branch from reply' }).click();
  await expectVisible(page.getByRole('dialog', { name: 'Branch from this reply' }));
  await close(page);
  await (await sidebarButton(page, 'Delete /calc 2+8')).click();
  await page.getByRole('dialog', { name: 'Delete conversation?' }).getByRole('button', { name: 'Delete chat', exact: true }).click();
  assert.equal(await page.locator('.history-entry').filter({ hasText: '/calc 2+8' }).count(), 0);
  if (width < 500) await page.keyboard.press('Escape');
  console.log(`Guest ${width}px: 9 routes, shared footer/theme, commands, attachments, playground, status, shortcuts and plugin gates.`);
}
async function checkProviderFixtures(context, width) {
  const page = await context.newPage();
  const oauth = {
    google: 'https://accounts.google.com/o/oauth2/v2/auth',
    github: 'https://github.com/login/oauth/authorize',
  };
  await page.route(guest + '/api/account', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { user: null, providers: ['google', 'github'], passwords: false, background: false } });
    const { action, provider } = route.request().postDataJSON();
    assert.equal(action, 'start');
    assert.ok(Object.hasOwn(oauth, provider));
    return route.fulfill({ json: { url: oauth[provider] + '?client_id=fixture&state=fixture' } });
  });
  for (const [name, path] of Object.entries(oauth)) await page.route(path + '**', (route) => route.fulfill({ contentType: 'text/html', body: `<h1>${name} consent fixture</h1>` }));
  for (const name of ['Google', 'GitHub']) {
    await page.goto(guest + '/');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: `Continue with ${name}` }).click();
    await expectVisible(page.getByRole('heading', { name: `${name.toLowerCase()} consent fixture` }));
    assert.ok(page.url().startsWith(oauth[name.toLowerCase()] + '?'));
  }

  if (!WORKSPACE_PLUGINS_ENABLED) {
    console.log(`Identity fixtures ${width}px: Google and GitHub consent starts without Plugins.`);
    await page.close();
    return;
  }
  await page.goto(guest + '/');
  const [png, jpg] = await page.evaluate(() => ['image/png', 'image/jpeg'].map((mime) => document.createElement('canvas').toDataURL(mime).split(',')[1]));
  const fixtureCode = 'fixture-approval-code-do-not-store';
  let postCount = 0;
  let failStatus = true;
  let vercelRevoked = false;
  const reads = [];
  await page.route((url) => url.origin === guest && url.pathname === '/api/workspace', async (route) => {
    if (route.request().method() === 'GET') {
      if (failStatus) return route.fulfill({ json: {} });
      return route.fulfill({ json: { connections: { gmail: 'connected', vercel: vercelRevoked ? 'disconnected' : 'connected' }, hostedImages: true, hostedVision: true } });
    }
    const payload = route.request().postDataJSON();
    assert.equal(payload.approved, true);
    if (payload.action === 'api') {
      reads.push('api');
      assert.equal(payload.method, 'GET');
      return route.fulfill({ json: { data: { name: 'fixture-package' } } });
    }
    if (payload.action === 'repository') {
      reads.push(`repo-${payload.operation}`);
      assert.equal(payload.repo, 'octocat/Hello-World');
      if (payload.operation === 'overview') return route.fulfill({ json: { repo: { name: payload.repo, branch: 'main', description: '', stars: 0, openIssues: 0 } } });
      if (payload.operation === 'files') return route.fulfill({ json: { entries: [{ name: 'README.md', path: 'README.md', type: 'file', size: 12 }], more: false } });
      assert.equal(payload.operation, 'file'); assert.equal(payload.path, 'README.md');
      return route.fulfill({ json: { file: { path: 'README.md', text: 'Hello fixture\n' } } });
    }
    if (payload.action === 'account' && payload.provider === 'gmail') {
      reads.push('inbox'); assert.equal(payload.operation, 'inbox');
      return route.fulfill({ json: { messages: [{ subject: 'Read-only inbox fixture', from: 'sample@example.invalid' }] } });
    }
    if (payload.action === 'account' && payload.provider === 'vercel') {
      reads.push('projects'); assert.equal(payload.operation, 'projects'); assert.equal(payload.teamSlug, 'example-team');
      if (vercelRevoked) {
        expectedAuthFailure.add(page);
        return route.fulfill({ status: 401, json: { error: 'The connection expired or was revoked. Connect it again to continue.' } });
      }
      return route.fulfill({ json: { projects: [{ name: 'team-project-fixture' }] } });
    }
    assert.equal(payload.accessCode, fixtureCode);
    postCount++;
    if (payload.action === 'image') {
      assert.equal(payload.prompt, 'The launch fixture.');
      return route.fulfill({ json: { mime: 'image/jpeg', image: jpg, size: payload.size } });
    }
    assert.equal(payload.action, 'vision');
    assert.equal(payload.prompt, 'What is drawn here?');
    assert.match(payload.image, /^\/9j\//);
    assert.equal(payload.memory, undefined);
    return route.fulfill({ json: { text: 'Fixture image description.' } });
  });
  await page.locator('header.topbar').getByRole('button', { name: 'Plugins', exact: true }).click();
  const back = page.getByRole('button', { name: 'All plugins' });
  await expectVisible(page.getByRole('button', { name: 'Retry plugin status' }));
  assert.equal(await page.getByRole('button', { name: /^Gmail / }).count(), 0);
  await page.getByRole('button', { name: /^API Explorer / }).click();
  assert.deepEqual(reads, []);
  await page.getByRole('button', { name: 'Approve & send GET' }).click();
  await expectVisible(page.getByText(/fixture-package/));
  await back.click();
  await page.getByRole('button', { name: /^GitHub workbench / }).click();
  await page.getByRole('button', { name: 'Approve & open repo' }).click();
  await page.getByRole('button', { name: 'Read files', exact: true }).click();
  await page.getByRole('button', { name: /^README.md/ }).click();
  await page.getByRole('textbox', { name: 'Local file draft' }).fill('A local edit\n');
  await page.getByRole('button', { name: 'Review patch' }).click();
  await expectVisible(page.getByText(/\+A local edit/));
  await back.click();
  failStatus = false;
  await page.getByRole('button', { name: 'Retry plugin status' }).click();
  await page.getByRole('button', { name: /^Gmail / }).click();
  await page.getByRole('button', { name: 'Approve & read inbox headers' }).click();
  await expectVisible(page.getByText(/Read-only inbox fixture/));
  await back.click();
  await page.getByRole('button', { name: /^Vercel / }).click();
  const team = page.getByLabel('Team slug (optional)');
  await team.fill('not/a-team');
  const projectRead = page.getByRole('button', { name: 'Approve & read projects' });
  assert.equal(await projectRead.isDisabled(), true);
  await team.fill('example-team');
  await projectRead.click();
  await expectVisible(page.getByText(/team-project-fixture/));
  vercelRevoked = true;
  await projectRead.click();
  await expectVisible(page.getByRole('button', { name: 'Connect Vercel' }));
  await expectVisible(page.getByText(/connection expired or was revoked/));
  assert.deepEqual(reads, ['api', 'repo-overview', 'repo-files', 'repo-file', 'inbox', 'projects', 'projects']);
  await back.click();
  await page.getByRole('button', { name: /^Image Studio / }).click();
  await page.getByRole('button', { name: 'AI images', exact: true }).click();
  await page.getByLabel('Image prompt').fill('The launch fixture.');
  await page.getByLabel('Studio access code').fill(fixtureCode);
  assert.equal(postCount, 0);
  await page.getByRole('button', { name: 'Approve & generate' }).click();
  await expectVisible(page.getByRole('img', { name: 'Your generated AI image' }));
  assert.equal(postCount, 1);
  await close(page);
  await page.locator('input[type=file]').setInputFiles({ name: 'vision-fixture.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expectVisible(page.getByRole('img', { name: 'Preview of vision-fixture.png' }));
  await ask(page, 'What is drawn here?');
  await expectVisible(page.getByRole('dialog', { name: 'Review image upload' }));
  assert.equal(postCount, 1);
  await page.getByLabel('Studio access code').fill(fixtureCode);
  await page.getByRole('button', { name: 'Approve & analyze' }).click();
  await expectVisible(page.getByText('Fixture image description.', { exact: true }));
  assert.equal(postCount, 2);
  console.log(`Provider fixtures ${width}px: Google/GitHub consent, API/GitHub workbench, Gmail/Vercel reads and reconnect, hosted image and vision approval.`);
  await page.close();
}
async function emailProofFor(email, purpose, codes) {
  for (const file of await readdir(mailDir)) {
    const message = JSON.parse(await readFile(resolve(mailDir, file), 'utf8'));
    if (message.to !== email) continue;
    if (codes) {
      const label = purpose === 'signup' ? 'verification' : 'password reset';
      const proof = message.text.match(new RegExp(`${label} code is ([0-9]{6})\\.`))?.[1];
      if (proof) return proof;
    } else if (message.text.includes(`/#${purpose}=`)) {
      const link = message.text.match(new RegExp(`https?://[^\\s]+/#${purpose}=[\\w-]{43}`))?.[0];
      assert.equal(new URL(link).origin, live);
      return link;
    }
  }
  throw new Error('The local fixture mail was not captured. Check XYVORA_LOCAL_MAIL_DIR.');
}
async function openEmailStep(page, email, purpose, codes) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill(email);
  await dialog.getByRole('button', { name: `Email ${purpose === 'signup' ? 'verification' : 'reset'} ${codes ? 'code' : 'link'}` }).click();
  await expectVisible(dialog.getByText(purpose === 'signup' ? /If this address can be used/ : /If this address has a password account/));
  const proof = await emailProofFor(email, purpose, codes);
  if (codes) {
    await expectVisible(page.getByRole('dialog', { name: 'Check your email' }));
    const code = dialog.getByLabel(purpose === 'signup' ? 'Verification code' : 'Reset code', { exact: true });
    await expectVisible(code);
    assert.equal(await code.getAttribute('autocomplete'), 'one-time-code');
    assert.equal(await code.evaluate((input) => input === document.activeElement), true);
    await code.fill(proof);
    assert.equal(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true, 'Email code form must fit its dialog');
  } else {
    await page.goto(proof);
    await expectVisible(page.getByRole('dialog', { name: purpose === 'signup' ? 'Set your Xyvora password' : 'Choose a new password' }));
    assert.equal(new URL(page.url()).hash, '');
  }
}
async function enterPassword(page, password, label) {
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name=password]').fill(password);
  await dialog.locator('input[name=confirm]').fill(password);
  await dialog.getByRole('button', { name: label, exact: true }).click();
}
async function login(page, email, password) {
  const dialog = page.getByRole('dialog');
  if (!await dialog.isVisible()) await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.getByLabel('Email', { exact: true }).fill(email);
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Sign in with password' }).click();
  await expectVisible(page.getByRole('button', { name: 'Your account', exact: true }));
}
async function checkAccount(primary, width) {
  const page = await primary.newPage();
  const unique = randomUUID().slice(0, 8);
  const email = `launch-${unique}@example.invalid`;
  const password = 'launch-fixture-test-password', next = 'launch-replacement-test-password';
  const saved = `/calc 100+${width}`;
  await page.goto(live + '/');
  const status = await (await page.request.get(`${live}/api/account`)).json();
  assert.equal(status.passwords, true, 'The account preview needs the local platform');
  const codes = status.emailVerification === 'code';
  const signIn = page.locator('.topbar').getByRole('button', { name: 'Sign in', exact: true });
  await expectVisible(signIn.locator('span'));
  await signIn.click();
  await expectVisible(page.getByRole('dialog', { name: 'Sign in to Xyvora' }));
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await field(page).waitFor();
  await ask(page, `/calc 7+${width}`); // belongs only to this browser's guest history
  await page.keyboard.press('Control+Shift+N');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expectVisible(page.getByRole('dialog', { name: 'Create a Xyvora account' }));
  assert.equal(await dialog.getByRole('button', { name: 'Sign up', exact: true }).getAttribute('aria-pressed'), 'true');
  await openEmailStep(page, email, 'signup', codes);
  await enterPassword(page, password, 'Create account');
  await expectVisible(page.getByRole('button', { name: 'Your account' }));
  assert.equal(await page.getByRole('button', { name: `/calc 7+${width}`, exact: true, includeHidden: true }).count(), 0);
  await ask(page, saved);
  await expectVisible(page.getByRole('article', { name: 'Calculator response' }));
  await page.locator('.workspace-profile small').getByText('Cloud history', { exact: true }).waitFor({ state: 'attached' });
  const dark = page.getByRole('button', { name: 'Switch to dark theme' });
  if (await dark.isVisible()) await dark.click();
  await (await sidebarButton(page, 'Workspace settings')).click();
  await page.getByLabel('Default reply mode').selectOption('instant');
  await close(page);
  await (await sidebarButton(page, /^Memory/)).click();
  for (let index = 1; index <= 9; index++) {
    await dialog.getByRole('button', { name: 'Add note' }).click();
    await dialog.getByRole('textbox', { name: `Memory note ${index}`, exact: true }).fill(`Fixture ${index}`);
  }
  await dialog.getByLabel('Use saved notes in replies').check();
  await dialog.getByRole('button', { name: 'Save memory' }).click();
  await page.getByText('Memory saved.', { exact: true }).waitFor();

  const second = await makeContext(width === 1440 ? 390 : 1440);
  try {
    const device = await second.newPage();
    await device.goto(live + '/');
    await login(device, email, password);
    await device.getByRole('button', { name: `Reply mode: Instant`, exact: true }).waitFor();
    assert.equal(await device.locator('html').getAttribute('data-theme'), 'dark');
    await device.getByRole('button', { name: saved, exact: true, includeHidden: true }).waitFor({ state: 'attached' });
    await (await sidebarButton(device, /Search chats/)).click();
    await device.getByRole('dialog').getByRole('button', { name: saved, exact: true }).click();
    await expectVisible(device.getByRole('article', { name: 'Calculator response' }));
    await (await sidebarButton(device, /^Memory/)).click();
    assert.equal(await device.getByRole('textbox', { name: 'Memory note 9' }).inputValue(), 'Fixture 9');
    await close(device);

    await (await sidebarButton(page, 'Background tasks')).click();
    await page.getByLabel('Task prompt').fill(`Outline a short fictional project for device ${width}.`);
    await page.getByRole('button', { name: 'Start background reply' }).click();
    await expectVisible(page.getByText(`Outline a short fictional project for device ${width}.`, { exact: true }));
    await page.goto(live + '/analytics'); // dequeue and run independent of this tab
    await page.getByText(/^Updated /).waitFor();
    assert.ok(Number(await page.locator('#metric-accounts').textContent()) >= 1);
    await page.goto(live + '/cookies');
    await page.getByRole('button', { name: /Allow analytics/i }).click();
    await page.getByText('Optional analytics is on in this browser.', { exact: true }).waitFor();
    await page.goto(live + '/analytics');
    await page.getByText(/^Updated /).waitFor();
    await page.waitForFunction(() => Number(document.querySelector('#metric-today')?.textContent) >= 1, null, { timeout: 15_000 }).catch(async () => {
      await page.getByRole('button', { name: 'Refresh' }).click();
      await page.waitForFunction(() => Number(document.querySelector('#metric-today')?.textContent) >= 1);
    });
    assert.equal(await page.locator('#visits-chart .visit-bar').count(), 30);
    await (await sidebarButton(device, 'Background tasks')).click();
    await device.getByText(/Preview sample · not a live model/).waitFor();
    await close(device);

    await page.goto(live + '/');
    await page.getByRole('button', { name: 'Your account' }).click();
    await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: saved, exact: true, includeHidden: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: `/calc 7+${width}`, exact: true, includeHidden: true }).count(), 1);
    await dialog.getByRole('button', { name: 'Forgot password?' }).click();
    await openEmailStep(page, email, 'reset', codes);
    await enterPassword(page, next, 'Save new password');
    await page.getByText('Password changed. Use your new password to sign in.', { exact: true }).waitFor();
    await device.reload();
    await expectVisible(device.getByRole('button', { name: 'Sign in', exact: true }));
    await login(page, email, next);
    await page.getByRole('button', { name: saved, exact: true, includeHidden: true }).waitFor({ state: 'attached' });
    await page.getByRole('button', { name: 'Your account' }).click();
    await dialog.getByRole('button', { name: 'Delete account', exact: true }).click();
    await dialog.getByRole('button', { name: 'Delete permanently' }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  } finally { await second.close(); }
  console.log(`Account ${width}px (${codes ? 'email codes' : 'email links'}): verified signup, cross-device sign-in/chat/preferences/9 notes, persisted queue, analytics, sign-out/reset and deletion.`);
}

try {
  for (const width of [1440, 390]) {
    const context = await makeContext(width);
    try { await checkGuest(await context.newPage(), width); await checkAccount(context, width); await checkProviderFixtures(context, width); }
    finally { await context.close(); }
  }
  assert.deepEqual(errors, [], 'Browser console/page errors');
} finally { await browser.close(); }
