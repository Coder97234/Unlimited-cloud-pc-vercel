import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifiedTeamReply } from '../shared/creator-policy.ts';
import { handleWorkspaceTools } from '../server/workspace.ts';
import { workspaceConfig } from '../server/workspace-connections.ts';
import { MAX_VISION_BASE64, MAX_VISION_QUESTION, rasterMime, rasterSize } from '../shared/media.ts';
import { DEFAULT_MODEL } from '../shared/models.ts';
import { conversationMarkdown } from '../src/lib/export-chat.ts';
import { buildMessages, loadThreads } from '../src/lib/history.ts';
import type { Thread, Turn } from '../src/lib/history.ts';

const origin = 'https://media.xyvora.invalid';
const endpoint = `${origin}/api/workspace`;
const imageEndpoint = `${endpoint}?input=image`;
const accessCode = 'test-only-vision-and-image-code';
const env = { XYVORA_WORKSPACE_ORIGIN: origin, XYVORA_IMAGE_ACCESS_CODE: accessCode, XYVORA_IMAGE_API_KEY: 'test-only-image-provider-key' };
const config = workspaceConfig({ ...env, XYVORA_ENABLE_VISION: '1' });
const unconfigured = workspaceConfig({});
const image = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCQAUMX/9k=';
const question = 'What color is the background?';
const input = { approved: true, action: 'vision', image, prompt: question, accessCode };
const post = (data: object, url = imageEndpoint, requestOrigin = origin) => new Request(url, {
  method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});
const issue = (data: object, url?: string, requestOrigin?: string) => handleWorkspaceTools(post(data, url, requestOrigin), config, { limit: false });

test('image preflight reads supported raster dimensions without decoding or mistaking SVG for an image', () => {
  const dimensions = { width: 3, height: 2 };
  for (const b64 of [image, 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACAQMAAACnuvRZAAAAA1BMVEX/AAAZ4gk3AAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC', 'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoDAAIAAkA4JaACdLoB+AADsAD+8JtD/yC0rlvAH/8SF+JC/Ehf+LmAAAA=', 'UklGRhwAAABXRUJQVlA4TA8AAAAvAkAAAAcQ/Y/+ByKi/wEA', 'UklGRl4AAABXRUJQVlA4WAoAAAAQAAAAAgAAAQAAQUxQSAcAAAAAgICAgICAAFZQOCAwAAAA0AEAnQEqAwACAAJAOCWgAnS6AfgAA7AA/vCbQ/8gtK5bwB//EhfiQvxIX/i5gAAA']) {
    assert.deepEqual(rasterSize(Buffer.from(b64, 'base64')), dimensions);
  }
  assert.equal(rasterSize(Buffer.from('<svg width="3" height="2"/>')), undefined);
  assert.equal(rasterSize(Buffer.from([0xff, 0xd8, 0xff])), undefined);
});

test('vision requires explicit enablement, a valid access code, approval, and a bounded JPEG before network access', async (t) => {
  const provider = t.mock.method(globalThis, 'fetch', async () => assert.fail('vision must be validated before calling a provider'));
  assert.equal((await (await handleWorkspaceTools(new Request(endpoint), config)).json()).hostedVision, true);
  assert.equal((await (await handleWorkspaceTools(new Request(endpoint), workspaceConfig(env))).json()).hostedVision, false);
  assert.equal((await (await handleWorkspaceTools(new Request('https://other.invalid/api/workspace'), config)).json()).hostedVision, false);
  assert.equal((await handleWorkspaceTools(post(input), unconfigured)).status, 503);
  assert.equal((await handleWorkspaceTools(post(input), workspaceConfig(env))).status, 503);
  assert.equal((await issue(input, undefined, 'https://foreign.invalid')).status, 403);
  assert.equal((await issue({ ...input, approved: false })).status, 403);
  assert.equal((await issue({ ...input, accessCode: 'wrong' })).status, 403);
  assert.equal((await issue(input, endpoint)).status, 400);
  assert.equal((await issue({ ...input, action: 'image' })).status, 400);
  assert.equal((await issue({ ...input, prompt: 'x'.repeat(MAX_VISION_QUESTION + 1) })).status, 400);
  assert.equal((await issue({ ...input, image: 'A'.repeat(MAX_VISION_BASE64 + 8_001) })).status, 413);
  assert.equal((await issue({ ...input, image: 'A'.repeat(MAX_VISION_BASE64 + 4) })).status, 400);
  const bigDimensions = Buffer.from(image, 'base64');
  const sof = bigDimensions.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(sof >= 0);
  bigDimensions.writeUInt16BE(10_000, sof + 5);
  for (const bad of ['https://private.invalid/original.jpg', 'data:image/jpeg;base64,' + image, Buffer.from('<svg></svg>').toString('base64'),
    '/9j/AAAAAAAAAAAAAA==', bigDimensions.toString('base64'), Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(14, 0xff), Buffer.from([0xff, 0xd9])]).toString('base64')]) {
    assert.equal((await issue({ ...input, image: bad })).status, 400, `reject invalid or oversized image ${bad.slice(0, 30)}`);
  }
  assert.equal(provider.mock.callCount(), 0);
});

test('vision sends only question and image pixels to a multimodal provider and handles a refusal', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.redirect, 'error');
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer test-only-image-provider-key');
    const data = JSON.parse(options.body as string);
    assert.equal(data.model, 'gpt-4.1-mini');
    assert.equal(data.store, false);
    assert.deepEqual(data.input, [{ role: 'user', content: [{ type: 'input_text', text: question }, { type: 'input_image', image_url: `data:image/jpeg;base64,${image}`, detail: 'auto' }] }]);
    assert.doesNotMatch(options.body as string, /private-history|private-preference|code-not-forwarded|test-only-vision/);
    calls++;
    const content = calls === 1 ? [{ type: 'output_text', text: 'The background is purple.' }] : [{ type: 'refusal', refusal: 'raw-provider-refusal' }];
    return Response.json({ output: [{ type: 'message', role: 'assistant', content }], metadata: 'not-forwarded' });
  });
  const body = { ...input, history: 'private-history', memory: ['private-preference'], attachment: 'code-not-forwarded' };
  const ok = await issue(body);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await ok.json(), { text: 'The background is purple.' });
  const refused = await issue(body);
  assert.equal(refused.status, 422);
  assert.doesNotMatch(await refused.text(), /raw-provider-refusal/);
});

test('hosted studio generates one approved image at the selected size and rejects invalid dimensions', async (t) => {
  const provider = t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    const data = JSON.parse(options.body as string);
    assert.deepEqual(data, { model: 'gpt-image-1', prompt: 'A purple landscape', n: 1, size: '1536x1024', quality: 'medium', output_format: 'jpeg', output_compression: 85 });
    return Response.json({ data: [{ b64_json: image }] });
  });
  const body = { approved: true, action: 'image', prompt: 'A purple landscape', accessCode, history: 'never sent' };
  assert.equal((await issue({ ...body, size: '3840x2160' }, endpoint)).status, 400);
  assert.equal(provider.mock.callCount(), 0);
  const result = await issue({ ...body, size: '1536x1024' }, endpoint);
  assert.deepEqual(await result.json(), { mime: 'image/jpeg', size: '1536x1024', image });
  assert.equal(rasterMime(Buffer.from(image, 'base64')), 'image/jpeg');
});

test('saved image analysis retains text and local attachment name, not image bytes; later turns see no pixels', (t) => {
  const turn: Turn = { id: 'vision', prompt: question, imageName: 'purple.jpg', answers: [{ model: DEFAULT_MODEL, source: 'vision', state: 'finished', content: 'Purple.' }] };
  const thread: Thread = { id: 'thread', title: 'A test photo', mode: 'chat', updatedAt: 1, turns: [{ ...turn, ...{ image } }] };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => JSON.stringify([thread]) } });
  t.after(() => original ? Object.defineProperty(globalThis, 'localStorage', original) : Reflect.deleteProperty(globalThis, 'localStorage'));
  const [restored] = loadThreads();
  assert.equal(restored.turns[0].imageName, 'purple.jpg');
  assert.equal(restored.turns[0].answers[0].source, 'vision');
  assert.ok(!JSON.stringify(restored).includes(image));
  const next = buildMessages(restored.turns, { prompt: 'Suggest a complementary color.' });
  assert.match(next[0].content, /no image pixels/);
  assert.equal(next[1].content, 'Purple.');
  assert.doesNotMatch(JSON.stringify(next), /purple\.jpg/);
  assert.deepEqual(buildMessages([{ ...turn, contextOnly: true }], { prompt: 'Next question' }), [{ role: 'user', content: 'Next question' }]);
  assert.match(conversationMarkdown(restored), /Image name \(image not stored\).*purple\.jpg.*Image analysis/s);
});


test('hosted media prevents team portrayals and sanitizes unplanned model mentions', async (t) => {
  const provider = t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    return Response.json({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Unverified remark about Elijah Richardson.' }] }] });
  });
  const question = await issue({ ...input, prompt: 'Mock the people who wrote your source code.' });
  assert.deepEqual(await question.json(), { text: verifiedTeamReply });
  const image = await issue({ approved: true, action: 'image', prompt: 'A rude poster about the Xyvora team', accessCode }, endpoint);
  assert.equal(image.status, 422);
  assert.equal(provider.mock.callCount(), 0);
  assert.deepEqual(await (await issue(input)).json(), { text: verifiedTeamReply });
  assert.equal(provider.mock.callCount(), 1);
});
