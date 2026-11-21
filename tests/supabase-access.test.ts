import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { accountConfig, handleAccount } from '../server/account.ts';
import type { PlatformDb } from '../server/database.ts';
import { workerHeartbeat } from '../server/worker-health.ts';
import { CookieJar, platformOrigin, platformPost } from './platform-fixture.ts';

const path = '/api/account';
const sql = (name: string) => readFile(new URL(`../database/${name}.sql`, import.meta.url), 'utf8');

test('Supabase-style API grants are removed while the scoped server can sign up and sync', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  for (const migration of ['001_platform', '002_launch']) await db.exec(await sql(migration));
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
    create table public.unrelated_table (id int); grant select on public.unrelated_table to anon;`);
  const migration = await sql('003_server_access');
  await db.exec(migration);
  await db.exec(migration);
  const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>("select relname, relrowsecurity from pg_class where relkind='r' and relname like 'xyvora_%'");
  assert.equal(rows.length, 12);
  assert.ok(rows.every((row) => row.relrowsecurity));
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await db.exec(`set role ${role}`);
    for (const { relname } of rows) await assert.rejects(db.query(`select * from public.${relname}`), { code: '42501' });
    if (role === 'anon') await db.query('select * from public.unrelated_table');
    await db.exec('reset role');
  }

  const connection: PlatformDb = { query: async (query, args) => (await db.query(query, args)).rows as never[] };
  await db.exec('set role xyvora_worker');
  await workerHeartbeat(connection);
  await db.query("update xyvora_jobs set state='running' where false");
  await assert.rejects(db.query('select * from xyvora_accounts'), { code: '42501' });
  await assert.rejects(db.query('delete from xyvora_jobs'), { code: '42501' });
  await db.exec('reset role; set role xyvora_app');
  await assert.rejects(db.query('delete from xyvora_worker_health'), { code: '42501' });

  let mail = '';
  const setup = accountConfig({ XYVORA_ACCOUNT_ORIGIN: platformOrigin, XYVORA_ENABLE_PASSWORDS: '1', XYVORA_ENABLE_BACKGROUND: '1', XYVORA_AUTH_SECRET: 'fixture-only-supabase-auth-secret-'.repeat(2) }, connection, undefined, async ({ text }) => { mail = text; })!;
  const guests = await handleAccount(new Request(platformOrigin + path), setup);
  assert.equal((await guests.json()).passwords, true);
  const email = 'supabase-fixture@example.invalid', password = 'fixture-only-signup-passphrase';
  assert.equal((await handleAccount(platformPost(path, { action: 'request-signup', email }), setup)).status, 202);
  const token = /#signup=([A-Za-z0-9_-]{43})/.exec(mail)?.[1];
  assert.ok(token);
  const verified = await handleAccount(platformPost(path, { action: 'verify-email', token, password }), setup);
  assert.equal(verified.status, 200);
  const jar = new CookieJar(); jar.update(verified);
  const info = await (await handleAccount(new Request(platformOrigin + path, { headers: jar.headers() }), setup)).json();
  assert.equal(info.user.email, email);
  assert.equal(info.background, true);
  const result = await handleAccount(platformPost(`${path}?section=settings`, { action: 'save-settings', settings: { theme: 'dark' } }, jar.headers(info.user.id)), setup);
  assert.deepEqual(await result.json(), { settings: { theme: 'dark' } });
  await db.exec(await sql('maintenance'));
});
