import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { accountConfig, digest, handleAccount, projectContextFor } from '../server/account.ts';
import { handleChat } from '../server/chat.ts';
import { withAccountScope } from '../server/projects.ts';
import type { PlatformDb } from '../server/database.ts';
import { LIBRARY_PAGE, LIBRARY_MAX_TURNS } from '../shared/library.ts';
import type { LibraryPage } from '../shared/library.ts';
import { emptyProject } from '../shared/projects.ts';
import type { Thread } from '../shared/history.ts';
import { platformOrigin as origin, platformPost } from './platform-fixture.ts';

const projectPath = '/api/account?section=projects';
const libraryPath = '/api/account?section=library';
const legacyPath = '/api/account?section=history';
const draft = { ...emptyProject(), name: 'Field notes', instructions: 'Answer as a checklist.', color: 'teal', icon: 'book' };
const thread = (id: string, now: number, projectId?: string): Thread => ({ id, title: `Conversation ${id}`, mode: 'chat', updatedAt: now, projectId,
  turns: [{ id: 't01', prompt: 'Notes from this week', answers: [{ model: 'xyvora', state: 'finished', source: 'server', content: `Cherry orchard record ${id}` }] }] });

test('projects and normalized history are private, bounded, restart-safe, and backwards compatible until cutover', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const name of ['001_platform', '002_launch', '003_server_access', '004_projects', '005_conversation_library', '004_projects', '005_conversation_library', '006_session_management', '006_session_management']) {
    await db.exec(await readFile(new URL(`../database/${name}.sql`, import.meta.url), 'utf8'));
  }
  for (const role of ['anon', 'authenticated', 'service_role', 'xyvora_worker']) {
    await db.exec(`set role ${role}`);
    for (const table of ['xyvora_projects', 'xyvora_project_files', 'xyvora_library', 'xyvora_chats']) await assert.rejects(db.query(`select 1 from ${table}`), { code: '42501' });
    await db.exec('reset role');
  }
  const alice = randomUUID(), bob = randomUUID();
  for (const owner of [alice, bob]) await db.query(`insert into xyvora_accounts (id,provider,subject,name,created_ms) values ($1,'google',$2,'Fixture',0)`, [owner, owner]);
  async function session(owner: string) {
    const secret = randomBytes(32).toString('base64url');
    await db.query('insert into xyvora_sessions (digest,account_id,expires_ms) values ($1,$2,$3)', [digest(secret), owner, Date.now() + 60_000]);
    return { Cookie: `__Host-xyvora-session=${secret}`, 'X-Xyvora-Account': owner };
  }
  const [a, a2, b] = await Promise.all([session(alice), session(alice), session(bob)]);
  await db.exec('set role xyvora_app');
  const scoped: PlatformDb = {
    query: async (sql, params) => (await db.query(sql, params)).rows as never[],
    transaction: (run) => db.transaction((tx) => run({ query: async (sql, params) => (await tx.query(sql, params)).rows as never[] })),
  };
  const config = accountConfig({ XYVORA_ACCOUNT_ORIGIN: origin, XYVORA_ENABLE_PROJECTS: '1', XYVORA_ENABLE_LIBRARY: '1', XYVORA_ENABLE_SESSIONS: '1' }, scoped)!;
  const get = (path: string, headers: Record<string, string> = a) => handleAccount(new Request(origin + path, { headers }), config, { limit: false });
  const post = (path: string, body: object, headers: Record<string, string> = a) => handleAccount(platformPost(path, body, headers), config, { limit: false });
  assert.equal((await get(projectPath, {})).status, 401);
  assert.equal((await get(libraryPath, {})).status, 401);
  assert.equal((await post(projectPath, { action: 'create', project: draft }, { ...a, Origin: 'https://foreign.invalid' })).status, 403);
  assert.equal((await post(projectPath, { action: 'create', project: { ...draft, name: '\u0000' } })).status, 400);
  const created = await post(projectPath, { action: 'create', project: draft });
  assert.equal(created.status, 200);
  assert.match(created.headers.get('cache-control') ?? '', /private, no-store/);
  const { project } = await created.json();
  const upload = await post(projectPath, { action: 'upload-text', id: project.id, name: 'orchard.txt', text: 'The Limerick orchard has 47 pear trees. The trailhead is closed on weekdays.', truncated: false });
  assert.equal(upload.status, 200);
  const { file } = await upload.json();
  const projectUrl = `${projectPath}&project=${project.id}`;
  assert.equal((await get(`${projectUrl}&file=${file.id}`, b)).status, 404);
  assert.equal((await get(projectUrl, { ...b, 'X-Xyvora-Account': alice })).status, 409);
  assert.equal((await get(`${projectPath}&q=Limerick`, b)).status, 200);
  assert.deepEqual((await (await get(`${projectPath}&q=Limerick`, b)).json()).files, []);
  assert.deepEqual((await (await get(`${projectPath}&q=Limerick`, a2)).json()).files.map(({ id }: { id: string }) => id), [file.id]);
  const rich = await (await get(`${projectUrl}&file=${file.id}`, a2)).json();
  assert.match(rich.file.text, /47 pear trees/);
  assert.equal((await post(projectPath, { action: 'update', id: project.id, updatedAt: project.updatedAt, project: draft })).status, 409);
  assert.equal((await post(projectPath, { action: 'delete', id: project.id, updatedAt: project.updatedAt, confirm: 'DELETE' }, b)).status, 404);

  const projectRequest = (headers: Record<string, string>, includeFiles = true) => platformPost('/api/chat', { messages: [{ role: 'user', content: 'How many pear trees in the orchard?' }], projectId: project.id, projectFiles: includeFiles }, headers);
  let received = '', promptToSearch = '';
  const opts = { projectContext: projectContextFor(config), generate: async (_: unknown, _signal: AbortSignal, write: (text: string) => void, evidence: { project?: string }) => {
    received = evidence.project ?? ''; write('A model response, not a production fixture reply.');
  }, search: async (query: string) => { promptToSearch = query; return [{ title: 'Search evidence', url: 'https://example.org/' }]; } };
  assert.equal((await handleChat(projectRequest({}, true), opts)).status, 401);
  assert.equal((await handleChat(projectRequest(b), opts)).status, 404);
  assert.equal((await handleChat(projectRequest({ ...a, Origin: 'http://wrong.invalid' }), opts)).status, 403);
  const sse = await (await handleChat(projectRequest(a2), opts)).text();
  assert.match(sse, /\[DONE\]/);
  assert.match(received, /Answer as a checklist/);
  assert.match(received, /47 \[pear\] \[trees\]/);
  assert.match(received, /untrusted reference data/);
  const excluded = await handleChat(projectRequest(a, false), opts); await excluded.text();
  assert.match(received, /checklist/);
  assert.doesNotMatch(received, /pear trees/);
  await (await handleChat(platformPost('/api/chat', { messages: [{ role: 'user', content: '/search orchard' }], projectId: project.id, projectFiles: true }, a), opts)).text();
  assert.equal(promptToSearch, 'orchard');
  assert.match(received, /Limerick/);

  const old = thread('old', 1, project.id);
  const legacy = await post(legacyPath, { action: 'sync', revision: null, chats: [old] });
  assert.equal(legacy.status, 200, 'Pre-cutover legacy write');
  const legacyStamp = (await legacy.json()).revision;
  const first = await get(libraryPath, a2);
  assert.equal(first.status, 200);
  const initial = await first.json() as LibraryPage;
  assert.equal(initial.total, 1);
  assert.equal(initial.entries[0].chat.projectId, project.id);
  assert.deepEqual(initial.entries[0].chat.turns, []);
  assert.equal((await get(legacyPath)).status, 409, 'No stale empty history shown');
  assert.equal((await post(legacyPath, { action: 'sync', revision: legacyStamp, chats: [thread('stale', 2)] })).status, 409);
  await assert.rejects(scoped.query(`update xyvora_cloud_history set chats='[]' where account_id=$1`, [alice]), { code: '55000' });
  assert.equal((await get(`${libraryPath}&id=old`, b)).status, 404);
  const restored = await (await get(`${libraryPath}&id=old`)).json();
  assert.equal(restored.entry.chat.turns[0].answers[0].content, old.turns[0].answers[0].content);

  await withAccountScope(scoped, alice, async (tx) => {
    // Seed at the DB boundary to exercise indexed pagination, independently of mutation latency.
    await tx.query(`insert into xyvora_chats (account_id,id,revision,title,mode,pinned,updated_ms,turns)
      select $1,'test-'||n,gen_random_uuid(),'Example '||n,'chat',n=700,10+n,$2::jsonb from generate_series(1, 1050) n`, [alice, JSON.stringify(thread('seed', 0).turns)]);
    await assert.rejects(tx.query('select 1 from xyvora_projects where account_id=$1 and id=$2 for update nowait', [bob, project.id]).then((rows) => {
      if (!rows.length) throw new Error('owner filter');
    }), /owner filter/);
  });
  assert.deepEqual(await scoped.query('select id from xyvora_chats'), [], 'Owner GUC is not retained after commit');
  await assert.rejects(withAccountScope(scoped, alice, async () => { throw new Error('rollback test'); }), /rollback test/);
  assert.deepEqual(await scoped.query('select id from xyvora_project_files'), [], 'Owner GUC is not retained after rollback');
  const page1 = await (await get(libraryPath)).json() as LibraryPage;
  assert.equal(page1.total, 1051);
  assert.equal(page1.entries.length, LIBRARY_PAGE);
  assert.equal(page1.entries[0].chat.id, 'test-700');
  assert.ok(page1.next);
  const page2 = await (await get(`${libraryPath}&older=${page1.next}`)).json() as LibraryPage;
  assert.ok(page2.entries.every(({ chat }) => !page1.entries.some((each) => each.chat.id === chat.id)));
  assert.equal((await get(`${libraryPath}&older=broken`)).status, 400);
  const matches = await (await get(`${libraryPath}&q=Cherry%20orchard%20record%20old`)).json() as LibraryPage;
  assert.equal(matches.entries[0]?.chat.id, 'old');
  assert.equal(matches.entries[0]?.match?.turnId, 't01');
  assert.match(matches.entries[0]?.match?.text ?? '', /\[Cherry\].*\[orchard\]/);
  assert.deepEqual((await (await get(`${libraryPath}&q=Cherry`, b)).json()).entries, []);
  const saved = await post(libraryPath, { action: 'save', id: old.id, chat: { ...old, title: 'Renamed', archived: true, favorite: true }, expected: restored.entry.revision });
  assert.equal(saved.status, 200);
  const changed = await saved.json();
  assert.equal(changed.entry.chat.title, 'Renamed');
  const repeat = await post(libraryPath, { action: 'save', id: old.id, chat: { ...old, title: 'Renamed', archived: true, favorite: true }, expected: restored.entry.revision });
  assert.equal(repeat.status, 200, 'A lost confirmation can replay the same save');
  const stale = await post(libraryPath, { action: 'remove', id: old.id, expected: restored.entry.revision }, a2);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).entry.chat.title, 'Renamed');
  const many = { ...thread('many', 10), turns: Array.from({ length: LIBRARY_MAX_TURNS + 1 }, (_, n) => ({ ...old.turns[0], id: `turn${n}` })) };
  assert.equal((await post(libraryPath, { action: 'save', id: 'many', expected: null, chat: many })).status, 400);
  assert.equal((await (await get(`${libraryPath}&filter=archive`, a2)).json()).entries[0].chat.id, 'old');
  assert.equal((await (await get(`${libraryPath}&filter=favorite`, a2)).json()).entries[0].chat.id, 'old');
  const refreshed = await (await get(projectUrl)).json();
  assert.equal((await post(projectPath, { action: 'delete', id: project.id, confirm: 'DELETE', updatedAt: refreshed.project.updatedAt })).status, 200);
  assert.equal((await get(`${projectUrl}&file=${file.id}`)).status, 404);
  assert.equal((await (await get(`${libraryPath}&id=old`)).json()).entry.chat.projectId, undefined, 'Project removal detaches chats without deleting their content');
  assert.equal((await post(libraryPath, { action: 'clear', confirm: 'DELETE', revision: initial.revision })).status, 409);
  assert.equal((await post(libraryPath, { action: 'clear', confirm: 'DELETE', revision: changed.revision })).status, 200);
  assert.equal((await (await get(libraryPath)).json()).total, 0);
  const sessions = '/api/account?section=sessions';
  const records = await (await get(sessions)).json();
  assert.equal(records.sessions.length, 2);
  assert.equal(records.sessions[0].current, true);
  assert.doesNotMatch(JSON.stringify(records), /\bdigest\b/);
  assert.equal((await post(sessions, { action: 'revoke', id: records.sessions[1].id }, b)).status, 404);
  assert.equal((await post(sessions, { action: 'revoke', id: records.sessions[0].id })).status, 404);
  assert.equal((await post(sessions, { action: 'revoke-others', confirm: 'REVOKE' })).status, 200);
  assert.equal((await get(libraryPath, a2)).status, 401);
  assert.equal((await post('/api/account', { action: 'delete-account', confirm: 'DELETE' })).status, 200);
  assert.equal((await get(libraryPath, a2)).status, 401);
});
