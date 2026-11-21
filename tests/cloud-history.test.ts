import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { accountConfig, digest, handleAccount } from '../server/account.ts';
import { mergeChatHistory, parseCloudThreads } from '../shared/history.ts';
import type { Thread } from '../shared/history.ts';
import { memoryForSend, parseMemory } from '../shared/memory.ts';
import { platformFixture, platformOrigin as origin, platformPost } from './platform-fixture.ts';

const thread = (id: string, content: string): Thread => ({ id, title: id, mode: 'chat', updatedAt: 100, turns: [
  { id: 'turn', prompt: 'A question', answers: [{ model: 'xyvora', state: 'finished', source: 'skill', content }] },
] });

test('cloud copy merging preserves independent edits and deletions, not overlapping changes', () => {
  const a = thread('a', 'Old answer.'), b = thread('b', 'Unchanged.'), c = thread('c', 'New on second device.');
  const local = thread('a', 'Local change.');
  const remote = thread('a', 'Remote change.');
  assert.deepEqual(mergeChatHistory([a, b], [local, b], [c, a])?.map(({ id }) => id).sort(), ['a', 'c']);
  assert.equal(mergeChatHistory([a, b], [local, b], [remote, b]), null);
  assert.equal(mergeChatHistory([a, b], [local, b], [b]), null);
  assert.equal(parseCloudThreads([a, a]), undefined);
});

test('verified devices share cloud chats, settings and >8 memory notes, with revision checks and account deletion', async (t) => {
  const db = await platformFixture(t);
  const config = accountConfig({ XYVORA_ACCOUNT_ORIGIN: origin }, db)!;
  const account = randomUUID(), stranger = randomUUID();
  for (const id of [account, stranger]) await db.query(`insert into xyvora_accounts (id,provider,subject,name,created_ms) values ($1,'github',$2,'Fixture',$3)`, [id, id, Date.now()]);
  const session = async (id: string) => {
    const token = randomBytes(32).toString('base64url');
    await db.query('insert into xyvora_sessions (digest,account_id,expires_ms) values ($1,$2,$3)', [digest(token), id, Date.now() + 60_000]);
    return { Cookie: `__Host-xyvora-session=${token}`, 'X-Xyvora-Account': id };
  };
  const [a, b, other] = await Promise.all([session(account), session(account), session(stranger)]);
  const handle = (request: Request) => handleAccount(request, config, { limit: false });
  const path = (section: string) => `/api/account${section ? `?section=${section}` : ''}`;
  const get = (section: string, headers = a) => handle(new Request(origin + path(section), { headers }));
  const post = (section: string, headers: Record<string, string>, body: object) => handle(platformPost(path(section), body, headers));

  assert.deepEqual(await (await get('history', b)).json(), { revision: null, chats: [] });
  const chat = thread('one', '**15.21**');
  const save = await post('history', a, { action: 'sync', revision: null, chats: [{ ...chat, imageBytes: 'not-allowed' }] });
  assert.equal(save.status, 200);
  const { revision } = await save.json();
  const second = await (await get('history', b)).json();
  assert.equal(second.revision, revision);
  assert.equal(second.chats[0].turns[0].answers[0].content, '**15.21**');
  assert.doesNotMatch(JSON.stringify(second), /imageBytes/);
  const stale = await post('history', b, { action: 'sync', revision: null, chats: [] });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).conflict, true);
  assert.deepEqual(await (await get('history', other)).json(), { revision: null, chats: [] });
  assert.equal((await get('history', { ...other, 'X-Xyvora-Account': account })).status, 409);
  assert.equal((await post('history', { ...a, Origin: 'https://external.invalid' }, { action: 'sync', revision, chats: [] })).status, 403);
  const settings = await Promise.all([post('settings', a, { action: 'save-settings', settings: { theme: 'dark' } }), post('settings', b, { action: 'save-settings', settings: { mode: 'instant' } })]);
  assert.ok(settings.every((response) => response.ok));
  assert.deepEqual((await (await get('', b)).json()).settings, { theme: 'dark', mode: 'instant' });
  const profile = { enabled: true, notes: Array.from({ length: 14 }, (_, index) => `Note ${index + 1}`) };
  assert.equal(parseMemory(profile), undefined);
  assert.equal(memoryForSend(profile, false, false)?.length, 8);
  assert.equal((await post('memory', a, { action: 'save-memory', profile })).status, 200);
  assert.deepEqual((await (await get('memory', b)).json()).profile, profile);
  const cleared = await post('history', a, { action: 'sync', revision, chats: [] });
  assert.equal(cleared.status, 200);
  assert.deepEqual((await (await get('history', b)).json()).chats, []);
  assert.equal((await post('', b, { action: 'delete-account', confirm: 'DELETE' })).status, 200);
  for (const table of ['xyvora_cloud_history', 'xyvora_preferences', 'xyvora_memory', 'xyvora_sessions']) assert.equal((await db.query(`select 1 from ${table} where account_id=$1`, [account])).length, 0);
  assert.equal((await get('history', a)).status, 401);
  assert.equal((await (await get('', other)).json()).user.id, stranger);
});
