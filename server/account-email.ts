import { createHash, createHmac, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { EMAIL_CODE_LENGTH, EMAIL_CODE_MINUTES, EMAIL_RESEND_SECONDS } from '../shared/account.ts';
import type { EmailPurpose, PublicAccount } from '../shared/account.ts';
import { wellFormedText } from '../shared/stored-text.ts';
import type { PlatformDb } from './database.ts';
import { providerJson, ToolError } from './workspace-http.ts';

export type AccountMail = { to: string; subject: string; text: string };
export type SendAccountMail = (message: AccountMail, signal: AbortSignal) => Promise<void>;
export type PasswordAccount = PublicAccount & { credential_version: number };
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const newToken = () => randomBytes(32).toString('base64url');

export function emailAddress(input: unknown) {
  if (typeof input !== 'string' || input.length > 254) return;
  const email = input.trim().toLowerCase();
  const [name, domain] = email.split('@');
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(email)
    || !domain || name.includes('..') || name.startsWith('.') || name.endsWith('.')) return;
  return email;
}

type Env = Record<string, string | undefined>;

export function birdMailboxMailer(env: Env): SendAccountMail | undefined {
  const key = env.XYVORA_BIRD_API_KEY?.trim() || env.BirDApi_Email?.trim();
  const mailbox = env.XYVORA_BIRD_MAILBOX_ID?.trim();
  if (!key || !/^bk_[a-z0-9_-]{8,512}$/i.test(key) || /^bk_(?:(?:us1|eu1)_)?x+$/i.test(key)
    || !mailbox || !/^mbx_[a-z0-9]{1,64}$/i.test(mailbox)) return;
  // Only Bird's regional hosts can receive this key. The mailbox ID is configured on the server.
  const host = key.startsWith('bk_eu1_') ? 'eu1.platform.bird.com' : 'us1.platform.bird.com';
  return async ({ to, subject, text }, signal) => {
    const response = await fetch(`https://${host}/v1/email/mailboxes/${mailbox}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: [to], subject, text, category: 'transactional' }),
      redirect: 'error', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(7_000)]),
    }).catch(() => { throw new ToolError('Could not reach the Bird mailbox.', 502); });
    // A successful response is an acknowledgement, not proof of inbox delivery.
    // The provider's response may echo the message; never expose or log it.
    await response.body?.cancel().catch(() => undefined);
    if (response.status !== 202) throw new ToolError(`Bird did not accept the email (HTTP ${response.status}).`, 502);
  };
}

export function accountMailer(env: Env): SendAccountMail | undefined {
  const provider = env.XYVORA_MAIL_PROVIDER?.trim();
  if (provider === 'bird') return birdMailboxMailer(env);
  if (provider && provider !== 'resend') return;
  const key = env.XYVORA_MAIL_API_KEY?.trim();
  const from = emailAddress(env.XYVORA_MAIL_FROM);
  if (!key || !from) return;
  return async ({ to, subject, text }, signal) => {
    await providerJson('https://api.resend.com/emails', signal, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `Xyvora AI <${from}>`, to: [to], subject, text }),
    }, { timeout: 7_000 });
  };
}

// Durable budgets apply even when the invocation starts on a fresh instance.
// HMAC the counter labels; never keep the entered email or source IP here.
export async function authBudget(db: PlatformDb, secret: string, name: string, key: string, max: number, ttl: number) {
  const now = Date.now();
  const digest = createHmac('sha256', secret).update(`${name}\0${key}`).digest('hex');
  const [row] = await db.query<{ count: number }>(`insert into xyvora_auth_limits (digest,count,expires_ms) values ($1,1,$2)
    on conflict (digest) do update set count=case when xyvora_auth_limits.expires_ms<=$3 then 1 else xyvora_auth_limits.count+1 end,
    expires_ms=case when xyvora_auth_limits.expires_ms<=$3 then $2 else xyvora_auth_limits.expires_ms end
    where xyvora_auth_limits.expires_ms<=$3 or xyvora_auth_limits.count<$4 returning count`, [digest, now + ttl, now, max]);
  return !!row;
}
let runningHashes = 0;
async function passwordDigest(password: string, salt: string) {
  if (runningHashes >= 3) throw new ToolError('Sign-in is busy. Try again in a moment.', 429);
  runningHashes++;
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  } finally { runningHashes--; }
}
function validPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 12 && password.length <= 128 && wellFormedText(password) === password;
}
export async function passwordLogin(db: PlatformDb, secret: string, input: Record<string, unknown>, limit: boolean): Promise<PasswordAccount> {
  const fallback = typeof input.email === 'string' && /^[a-z0-9][a-z0-9_-]{2,23}$/i.test(input.email.trim()) ? input.email.trim().toLowerCase() : undefined;
  const email = emailAddress(input.email) ?? fallback; // older username accounts may still sign in
  const password = input.password;
  if (!email || typeof password !== 'string' || !password.length || password.length > 128) throw new ToolError('Email or password was incorrect.', 401);
  if (limit && !await authBudget(db, secret, 'password', email, 15, 15 * 60_000)) throw new ToolError('Too many sign-in attempts. Try again later.', 429);
  const [row] = await db.query<PasswordAccount & { password_hash: string }>(`select id, name, email, password_hash, credential_version from xyvora_accounts where provider='password' and subject=$1`, [email]);
  const [salt, saved] = row?.password_hash?.split(':') ?? ['0'.repeat(36), '0'.repeat(128)];
  const key = await passwordDigest(password, salt);
  const expected = Buffer.from(saved ?? '', 'hex');
  if (!row || expected.length !== key.length || !timingSafeEqual(key, expected)) throw new ToolError('Email or password was incorrect.', 401);
  return { id: row.id, name: row.name, email: row.email, credential_version: row.credential_version };
}

type EmailAuth = { db: PlatformDb; authSecret: string; emailVerification: 'link' | 'code' };
const codeWindow = EMAIL_CODE_MINUTES * 60_000;
const codePattern = new RegExp(`^[0-9]{${EMAIL_CODE_LENGTH}}$`);
const sourceIp = (request: Request) => request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) || 'local';
// A short code must not be guessable offline from its database digest. Bind it
// to the same normalized address and purpose on issuance and redemption.
const codeDigest = (secret: string, purpose: EmailPurpose, email: string, code: string) =>
  createHmac('sha256', secret).update(`email-code\0${purpose}\0${email}\0${code}`).digest('hex');

export async function sendEmailChallenge({ db, origin, authSecret, emailVerification }: EmailAuth & { origin: string }, send: SendAccountMail, request: Request,
  purpose: EmailPurpose, raw: unknown, { limit, schedule }: { limit: boolean; schedule?: (work: Promise<void>) => void }) {
  const email = emailAddress(raw);
  if (!email) throw new ToolError('Enter a valid email address.');
  if (limit && !await authBudget(db, authSecret, 'email-ip', sourceIp(request), 12, 60 * 60_000)) throw new ToolError('Too many email requests. Try again later.', 429);
  // Don't reveal if a password account exists or if this mailbox is throttled.
  if (limit && !await authBudget(db, authSecret, `email-target-${purpose}`, email, 1, EMAIL_RESEND_SECONDS * 1_000)) return;
  const byCode = emailVerification === 'code';
  const proof = byCode ? String(randomInt(10 ** EMAIL_CODE_LENGTH)).padStart(EMAIL_CODE_LENGTH, '0') : newToken();
  const digest = byCode ? codeDigest(authSecret, purpose, email, proof) : hashToken(proof);
  // Reuse the existing link table and its expiry/cleanup. A new request
  // replaces the previous challenge for this address and purpose.
  const [row] = await db.query(`insert into xyvora_email_links (digest,purpose,email,expires_ms)
    select $1,$2,$3,$4 where (exists (select 1 from xyvora_accounts where provider='password' and subject=$3)) = ($2='reset')
    on conflict (purpose,email) do update set digest=excluded.digest, expires_ms=excluded.expires_ms returning digest`,
  [digest, purpose, email, Date.now() + (byCode ? codeWindow : 30 * 60_000)]);
  if (!row) return;
  const signup = purpose === 'signup';
  const subject = byCode ? `Your Xyvora AI ${signup ? 'verification' : 'password reset'} code`
    : signup ? 'Finish creating your Xyvora AI account' : 'Reset your Xyvora AI password';
  const text = byCode
    ? `Your Xyvora AI ${signup ? 'verification' : 'password reset'} code is ${proof}.\n\nEnter it at ${origin}. It expires in ${EMAIL_CODE_MINUTES} minutes and works once. If you didn’t request it, you can ignore this message.`
    : `Open this link to ${signup ? 'verify your email and choose a password' : 'choose a new password'}:\n\n${origin}/#${purpose}=${proof}\n\nThis link expires in 30 minutes and works once. If you didn’t request it, you can ignore this message.`;
  const deliver = async () => {
    try {
      // Decouple Vercel response timing from delivery. Never expose the proof
      // or provider response to the requester or in logs.
      await send({ to: email, subject, text }, AbortSignal.timeout(9_000));
    } catch { console.warn('[xyvora] Account email delivery could not be confirmed.'); }
  };
  if (schedule) schedule(deliver());
  else await deliver();
}

export async function redeemEmailChallenge({ db, authSecret, emailVerification }: EmailAuth, request: Request, purpose: EmailPurpose, input: Record<string, unknown>, limit: boolean) {
  const { token, code, password } = input;
  const byCode = emailVerification === 'code' && token === undefined;
  const invalid = () => new ToolError(byCode ? 'This code is incorrect or expired. Request a new one if it expired.' : 'This email link is invalid or expired. Request a new one.');
  if (!validPassword(password)) throw new ToolError('Use a password between 12 and 128 characters.');
  let digest: string;
  if (byCode) {
    const email = emailAddress(input.email);
    if (!email || typeof code !== 'string' || !codePattern.test(code)) throw invalid();
    // Budgets persist across invocations and stay in place even after a resend.
    if (limit && (!await authBudget(db, authSecret, 'email-code-ip', sourceIp(request), 30, codeWindow)
      || !await authBudget(db, authSecret, `email-code-target-${purpose}`, email, 5, codeWindow))) {
      throw new ToolError(`Too many code attempts. Wait ${EMAIL_CODE_MINUTES} minutes and request a new code.`, 429);
    }
    digest = codeDigest(authSecret, purpose, email, code);
  } else {
    // A valid outstanding link can still be redeemed after switching to Bird.
    if (code !== undefined || typeof token !== 'string' || !tokenPattern.test(token)) throw invalid();
    digest = hashToken(token);
  }
  // Avoid expensive password hashing for requests without a valid proof.
  if (!(await db.query('select 1 from xyvora_email_links where digest=$1 and purpose=$2 and expires_ms>$3', [digest, purpose, Date.now()])).length) throw invalid();
  const salt = randomBytes(18).toString('hex');
  const key = await passwordDigest(password, salt);
  const saved = `${salt}:${key.toString('hex')}`;
  const consume = `delete from xyvora_email_links where digest=$1 and purpose=$2 and expires_ms>$3 returning email`;
  if (purpose === 'signup') {
    const [user] = await db.query<PasswordAccount>(`with link as (${consume}) insert into xyvora_accounts (id,provider,subject,name,email,password_hash,created_ms)
      select $5,'password',email,split_part(email,'@',1),email,$4,$3 from link on conflict (provider,subject) do nothing returning id,name,email,credential_version`,
    [digest, purpose, Date.now(), saved, randomUUID()]);
    if (!user) throw invalid();
    return user;
  }
  const [changed] = await db.query(`with link as (${consume}), updated as (
    update xyvora_accounts a set password_hash=$4, credential_version=a.credential_version+1 from link
      where a.provider='password' and a.subject=link.email returning a.id
    ), revoked as (delete from xyvora_sessions s using updated u where s.account_id=u.id)
    select id from updated`, [digest, purpose, Date.now(), saved]);
  if (!changed) throw invalid();
}
