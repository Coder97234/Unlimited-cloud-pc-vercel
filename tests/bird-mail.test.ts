import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { test } from 'node:test';
import { accountConfig, handleAccount } from '../server/account.ts';
import { accountMailer, birdMailboxMailer } from '../server/account-email.ts';
import type { AccountMail } from '../server/account-email.ts';
import { CookieJar, platformFixture, platformOrigin as origin, platformPost } from './platform-fixture.ts';

const path = '/api/account';
const secret = 'fixture-only-auth-secret-for-bird-codes';
const email = 'bird-test@example.invalid';
const password = 'fixture-password-v1';
const bird = {
  XYVORA_MAIL_PROVIDER: 'bird', XYVORA_BIRD_API_KEY: 'bk_us1_bird-fixture', XYVORA_BIRD_MAILBOX_ID: 'mbx_fixture123',
  XYVORA_ACCOUNT_ORIGIN: origin, XYVORA_AUTH_SECRET: secret, XYVORA_ENABLE_PASSWORDS: '1',
};
const resend = { XYVORA_MAIL_API_KEY: 'resend-fixture', XYVORA_MAIL_FROM: 'accounts@example.invalid' };
const testMail = { to: email, subject: 'Test from my mailbox', text: 'Hello! Sent from my Bird mailbox.' };

test('mail provider selection refuses a placeholder key, unsafe mailbox path, or silent fallback', async () => {
  const db = { query: async (): Promise<never[]> => [] };
  assert.ok(accountMailer(resend));
  assert.ok(accountMailer({ ...resend, ...bird }));
  for (const vars of [{ XYVORA_BIRD_API_KEY: undefined }, { XYVORA_BIRD_API_KEY: 'bk_xxxxxxxxx' },
    { XYVORA_BIRD_API_KEY: 'bk_us1_XXXXXXXXXXXX' }, { XYVORA_BIRD_MAILBOX_ID: 'mbx_invalid/../other' }, { XYVORA_MAIL_PROVIDER: 'unknown' }]) {
    const env = { ...resend, ...bird, ...vars };
    assert.equal(accountMailer(env), undefined);
    const config = accountConfig(env, db);
    const status = await (await handleAccount(new Request(origin + path), config)).json();
    assert.equal(status.passwords, false);
    assert.equal(status.emailVerification, undefined);
    assert.equal((await handleAccount(platformPost(path, { action: 'request-signup', email }), config, { limit: false })).status, 503);
  }
});

test('Bird accepts the case-sensitive BirDApi_Email alias without overriding the standard key', async (t) => {
  const env = { ...bird, XYVORA_BIRD_API_KEY: undefined, BirDApi_Email: ' bk_us1_alias-fixture ' };
  assert.equal(accountMailer({ ...env, XYVORA_MAIL_PROVIDER: undefined }), undefined);
  assert.equal(accountMailer({ ...env, BirDApi_Email: undefined, birdapi_email: env.BirDApi_Email }), undefined);
  const credentials: (string | null)[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    credentials.push(new Request(url, init).headers.get('authorization'));
    return new Response(null, { status: 202 });
  });
  const signal = new AbortController().signal;
  await accountMailer(env)!(testMail, signal);
  await accountMailer({ ...env, XYVORA_BIRD_API_KEY: bird.XYVORA_BIRD_API_KEY })!(testMail, signal);
  assert.deepEqual(credentials, ['Bearer bk_us1_alias-fixture', `Bearer ${bird.XYVORA_BIRD_API_KEY}`]);
});

test('Bird uses a fixed regional endpoint and discards the provider response body', async (t) => {
  const apiKey = 'bk_eu1_bird-fixture';
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    assert.equal(url, 'https://eu1.platform.bird.com/v1/email/mailboxes/mbx_fixture123/messages');
    assert.equal(init?.redirect, 'error');
    const req = new Request(url, init);
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.get('authorization'), `Bearer ${apiKey}`);
    assert.equal(req.headers.get('content-type'), 'application/json');
    assert.deepEqual(await req.json(), { to: [email], subject: testMail.subject, text: testMail.text, category: 'transactional' });
    return Response.json({ internal: `${apiKey} ${email}` }, { status: 403 });
  });
  const send = birdMailboxMailer({ ...bird, XYVORA_BIRD_API_KEY: apiKey })!;
  await assert.rejects(() => send(testMail, AbortSignal.timeout(1_000)), { message: 'Bird did not accept the email (HTTP 403).' });
  assert.equal(fetch.mock.callCount(), 1);
});

test('Bird email codes enable verified signup and one-time password reset without a schema change', async (t) => {
  const db = await platformFixture(t);
  const mail: AccountMail[] = [];
  const work: Promise<void>[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    assert.equal(url, 'https://us1.platform.bird.com/v1/email/mailboxes/mbx_fixture123/messages');
    const req = new Request(url, init);
    assert.equal(req.headers.get('authorization'), `Bearer ${bird.XYVORA_BIRD_API_KEY}`);
    const { to, subject, text } = await req.json();
    assert.deepEqual(to, [email]);
    mail.push({ to: to[0], subject, text });
    return new Response(null, { status: 202 });
  });
  const config = accountConfig(bird, db)!;
  const options = { limit: false, schedule: (promise: Promise<void>) => work.push(promise) };
  const jar = new CookieJar(), second = new CookieJar();
  const post = (action: string, fields: object, cookies = jar) => handleAccount(platformPost(path, { action, ...fields }, cookies.headers()), config, options);
  const status = async (cookies = jar) => (await (await handleAccount(new Request(origin + path, { headers: cookies.headers() }), config, options)).json());
  async function request(action: 'request-signup' | 'request-reset', to = email) {
    const res = await post(action, { email: to });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { accepted: true });
    await Promise.all(work.splice(0));
  }
  const codeFrom = (index: number) => {
    const text = mail[index].text;
    assert.match(text, /expires in 10 minutes and works once/);
    assert.doesNotMatch(text, /#(?:signup|reset)=/);
    return text.match(/code is ([0-9]{6})\./)![1];
  };

  assert.deepEqual(await status(), { providers: [], user: null, passwords: true, background: false, emailVerification: 'code' });
  await request('request-reset');
  assert.equal(mail.length, 0);
  await request('request-signup', 'Bird-test@Example.Invalid');
  const code = codeFrom(0);
  assert.equal(mail[0].subject, 'Your Xyvora AI verification code');
  assert.deepEqual(await db.query('select id from xyvora_accounts'), []);
  const [row] = await db.query<{ digest: string }>('select digest from xyvora_email_links');
  assert.equal(row.digest, createHmac('sha256', secret).update(`email-code\0signup\0${email}\0${code}`).digest('hex'));
  assert.notEqual(row.digest, createHash('sha256').update(code).digest('hex'));
  for (const attempted of [{ email: 'someone-else@example.invalid', code }, { email, code: Number(code) }, { email, code, token: 'a'.repeat(43) }, { email, code, password: 'short' }]) {
    assert.equal((await post('verify-email', { password, ...attempted })).status, 400);
  }
  assert.equal((await post('reset-password', { email, code, password })).status, 400);
  const create = await post('verify-email', { email, code, password });
  assert.equal(create.status, 200);
  jar.update(create);
  assert.equal((await status()).user.email, email);
  assert.equal((await post('verify-email', { email, code, password })).status, 400);
  await request('request-signup');
  assert.equal(mail.length, 1);
  const login = await post('login', { email, password }, second);
  assert.equal(login.status, 200);
  second.update(login);
  assert.equal((await status(second)).user.id, (await status()).user.id);

  await request('request-reset');
  const expired = codeFrom(1);
  const next = 'fixture-password-v2';
  await db.query("update xyvora_email_links set expires_ms=0 where purpose='reset'");
  assert.equal((await post('reset-password', { email, code: expired, password: next })).status, 400);
  await request('request-reset');
  const reset = codeFrom(2);
  assert.equal(mail[2].subject, 'Your Xyvora AI password reset code');
  const attempts = await Promise.all([jar, second].map((cookies) => post('reset-password', { email, code: reset, password: next }, cookies)));
  assert.deepEqual(attempts.map((res) => res.status).sort(), [200, 400]);
  assert.equal((await status()).user, null);
  assert.equal((await status(second)).user, null);
  assert.equal((await post('login', { email, password })).status, 401);
  assert.equal((await post('login', { email, password: next })).status, 200);
});

test('code resend has a cooldown and preserves the durable per-mailbox attempt budget', async (t) => {
  const db = await platformFixture(t);
  const mail: AccountMail[] = [];
  let ip = 0;
  const post = (action: string, fields: object) => {
    const config = accountConfig(bird, db, undefined, async (message) => { mail.push(message); });
    return handleAccount(platformPost(path, { action, ...fields }, { 'X-Vercel-Forwarded-For': `192.0.2.${++ip}` }), config);
  };
  assert.equal((await post('request-signup', { email })).status, 202);
  const first = mail[0].text.match(/code is (\d{6})\./)![1];
  const wrong = String((Number(first) + 1) % 1_000_000).padStart(6, '0');
  assert.equal((await post('request-signup', { email })).status, 202);
  assert.equal(mail.length, 1);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await post('verify-email', { email, code: wrong, password })).status, 400);
  }
  // Advance the send cooldown without advancing the code-attempt window.
  const sendBudget = createHmac('sha256', secret).update(`email-target-signup\0${email}`).digest('hex');
  await db.query('update xyvora_auth_limits set expires_ms=0 where digest=$1', [sendBudget]);
  assert.equal((await post('request-signup', { email })).status, 202);
  const current = mail[1].text.match(/code is (\d{6})\./)![1];
  assert.equal((await post('verify-email', { email: email.toUpperCase(), code: current, password })).status, 429);
  assert.deepEqual(await db.query('select id from xyvora_accounts'), []);
});
