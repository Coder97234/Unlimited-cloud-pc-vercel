import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PUBLIC_PAGES } from '../server/public-pages.ts';
import { MODE_IDS } from '../shared/modes.ts';
import { MAX_SEARCH_QUERY } from '../shared/search.ts';
import { ABOUT_PATH, SITE_DESCRIPTION, SITE_LINKS, TEAM, XYVORA_SLOGAN, XYVORA_URL } from '../shared/site.ts';

const target = process.argv[2];
async function read(path, file, expectedType) {
  if (!target) return readFile(`dist/${file}`, 'utf8');
  const response = await fetch(new URL(path, target), { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  const type = response.headers.get('content-type') ?? '';
  assert.equal(response.status, 200, `${path}: expected HTTP 200 without a redirect`);
  assert.match(type, expectedType, `${path}: wrong MIME type`);
  console.log(`XYVORA_HTTP ${path} ${response.status} ${type}`);
  return response.text();
}
const pages = PUBLIC_PAGES;
const sitemap = await read('/sitemap.xml', 'sitemap.xml', /^(?:application|text)\/xml\b/i);
assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
assert.deepEqual(Array.from(sitemap.matchAll(/<loc>([^<]*)<\/loc>/g), (match) => match[1]), pages.map(([path]) => XYVORA_URL + path));
const robots = await read('/robots.txt', 'robots.txt', /^text\/plain\b/i);
assert.ok(robots.includes(`Sitemap: ${XYVORA_URL}/sitemap.xml`));
assert.doesNotMatch(robots, /^Disallow:\s*\/\s*$/m);
for (const [path, file, title, description] of pages) {
  const html = await read(path, file, /^text\/html\b/i);
  assert.ok(html.includes(`rel="canonical" href="${XYVORA_URL}${path}"`), `${path} needs its canonical URL`);
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}|qwen|Roblox Game Development Group/i);
  assert.ok(html.includes(`<title>${title}</title>`), `${path} needs a current title`);
  for (const tag of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
    assert.ok(html.includes(`${tag} content="${description}"`), `${path} needs ${tag}`);
  }
  for (const key of ['og:title', 'og:image', 'og:url', 'twitter:title', 'twitter:image', 'twitter:card']) {
    assert.match(html, new RegExp(`(?:name|property)="${key}" content="[^"<>]+"`), `${path} missing ${key}`);
  }
  const footer = /<footer[^>]*>[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
  assert.deepEqual(Array.from(footer.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g), (match) => match.slice(1)), SITE_LINKS, `${path} footer links`);
  assert.match(html, /src="\/theme\.js"/, `${path} needs the shared theme bootstrap`);
  if (path === '/') {
    assert.ok(html.includes(SITE_DESCRIPTION) && html.includes(XYVORA_SLOGAN));
  } else {
    assert.doesNotMatch(html, /mailto:/i, 'Do not publish unverified employee addresses');
    assert.match(html, /<main[^>]*>[\s\S]*?<h1\b/, `${path} primary content must render without JS`);
  }
  if (path === ABOUT_PATH) for (const { name, role } of TEAM) assert.ok(html.includes(`<h3>${name}</h3><p>${role}</p>`));
}
const spec = JSON.parse(await read('/openapi.json', 'openapi.json', /^application\/json\b/i));
assert.deepEqual(spec.components.schemas.Mode.enum, MODE_IDS);
assert.equal(spec.components.schemas.ChatRequest.properties.searchQuery.maxLength, MAX_SEARCH_QUERY);
assert.ok(spec.paths['/api/chat'].post.responses['200'].content['text/event-stream']);
if (target) {
  const url = new URL('/not-a-public-xyvora-page', target);
  const missing = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  assert.equal(missing.status, 404, 'Unknown public paths should not return the chat homepage');
  await missing.body?.cancel();
}
console.log(`XYVORA_SITE ${pages.length} canonical pages, sitemap, robots, shared footer, theme boot, social metadata, and static team credits passed`);
