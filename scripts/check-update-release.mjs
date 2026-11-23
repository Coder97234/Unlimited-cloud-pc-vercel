import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import middleware from '../server/vercel-middleware.ts';
import { updateKeyConfigured, updateLocked } from '../server/update-lock.ts';

const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
assert.equal(config.proxy?.entrypoint, 'middleware.js');
assert.equal(config.proxy.matcher, undefined, 'Do not exclude assets or API routes from the gate.');
if (updateLocked(process.env, true)) {
  if (!updateKeyConfigured(process.env)) throw new Error('Configure a valid sensitive XYVORA_UPDATE_KEY before releasing the locked site.');
  const origin = 'https://release-check.invalid';
  const front = await middleware(new Request(origin, { headers: { Accept: 'text/html' } }));
  assert.equal(front.headers.get('x-xyvora-update'), 'locked');
  assert.equal(front.headers.get('x-middleware-next'), null);
  assert.match(await front.text(), /This website has been locked for an update\./);
  for (const path of ['/assets/check.js', '/brand/xyvora-orbit.svg', '/api/chat', '/api/account', '/api/analytics', '/api/workspace']) {
    const denied = await middleware(new Request(origin + path));
    assert.equal(denied.status, 423, path);
    assert.equal(denied.headers.get('x-middleware-next'), null, path);
    assert.match(denied.headers.get('cache-control') ?? '', /no-store/, path);
  }
  console.log('XYVORA_UPDATE build gate and secret format verified; direct asset and API reads locked');
} else console.log('XYVORA_UPDATE public release explicitly selected');
