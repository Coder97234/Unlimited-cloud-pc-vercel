import { randomUUID } from 'node:crypto';
import { isAccountId } from '../shared/account.ts';
import { MAX_JOB_PROMPT } from '../shared/jobs.ts';
import type { BackgroundJob } from '../shared/jobs.ts';
import { DEFAULT_MODEL } from '../shared/models.ts';
import { sameOriginJson, verifiedAccount } from './account.ts';
import type { AccountConfig } from './account.ts';
import { handleChat } from './chat.ts';
import { asObject, boundedJson, ToolError } from './workspace-http.ts';

const ttl = 30 * 86_400_000;
const grace = 115_000;
const running = new Map<string, AbortController>();
let requestWindow = 0;
const hits = new Map<string, number>();
function limitJobs(request: Request) {
  const now = Date.now();
  if (now >= requestWindow) { requestWindow = now + 60_000; hits.clear(); }
  const ip = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) || 'local';
  const ipKey = `ip:${ip}`, perIp = hits.get(ipKey) ?? 0, total = hits.get('all') ?? 0;
  if (perIp >= 80 || total >= 300) throw new ToolError('Too many background task requests. Try again in a minute.', 429);
  hits.set(ipKey, perIp + 1); hits.set('all', total + 1);
}
async function readReply(response: Response, signal: AbortSignal) {
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Reply unavailable');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', done = false, text = '';
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read(); if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      for (let end; (end = pending.indexOf('\n\n')) >= 0;) {
        const event = pending.slice(0, end); pending = pending.slice(end + 2);
        if (!event.startsWith('data:')) continue;
        const data = event.slice(5).trim();
        if (data === '[DONE]') { done = true; break; }
        const message = JSON.parse(data);
        if (message?.error) throw new Error('Reply unavailable');
        const content = message?.choices?.[0]?.delta?.content;
        if (typeof content === 'string') text = (text + content).slice(0, 12_000);
      }
      if (done) break;
      if (pending.length > 100_000) throw new Error('Reply too large');
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  if (!done || !text.trim()) throw new Error('Reply incomplete');
  return (response.headers.get('x-xyvora-source') === 'preview' ? 'Preview sample · not a live model\n\n' : '') + text;
}

type Schedule = (promise: Promise<void>) => void;
export async function handleJobs(request: Request, config: AccountConfig | undefined, chat: Parameters<typeof handleChat>[1], schedule: Schedule) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  const json = (data: object, status = 200) => Response.json(data, { status, headers });
  try {
    if (!config?.background || new URL(request.url).origin !== config.origin) throw new ToolError('Background tasks are not configured here.', 503);
    if (!['POST', 'GET'].includes(request.method)) return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: { ...headers, Allow: 'GET, POST' } });
    if (request.method === 'POST') sameOriginJson(request, config.origin);
    limitJobs(request);
    const user = await verifiedAccount(request, config);
    if (!user) throw new ToolError('Sign in to use background tasks.', 401);
    if (request.headers.get('x-xyvora-account') !== user.id) throw new ToolError('Your account changed. Refresh and try again.', 409);
    const db = config.db, now = Date.now();
    await db.query("update xyvora_jobs set state='error', result='The task did not finish in time. Start a new task to retry.', updated_ms=$2 where account_id=$1 and state='running' and created_ms < $3", [user.id, now, now - grace]);
    if (request.method === 'GET') {
      const rows = await db.query<BackgroundJob>(`select id, prompt, state, result, created_ms as created, updated_ms as updated from xyvora_jobs
        where account_id=$1 and created_ms > $2 order by created_ms desc limit 20`, [user.id, now - ttl]);
      return json({ jobs: rows.map((row) => ({ ...row, created: Number(row.created), updated: Number(row.updated) })) });
    }
    let input;
    try { input = asObject(await boundedJson(request, 10_000)); }
    catch (error) { throw error instanceof ToolError ? error : new ToolError('Send a valid task request.'); }
    if (input.action === 'cancel' || input.action === 'delete') {
      if (!isAccountId(input.id)) throw new ToolError('Choose a saved task.');
      const affected = input.action === 'cancel'
        ? await db.query("update xyvora_jobs set state='cancelled', result='', updated_ms=$3 where id=$1 and account_id=$2 and state='running' returning id", [input.id, user.id, now])
        : await db.query("delete from xyvora_jobs where id=$1 and account_id=$2 and state<>'running' returning id", [input.id, user.id]);
      if (!affected.length) throw new ToolError('That task is no longer available for this action.', 404);
      if (input.action === 'cancel') running.get(input.id)?.abort();
      return json({ ok: true });
    }
    if (input.action !== 'start' || input.approved !== true || typeof input.prompt !== 'string' || input.prompt.trim().length < 1 || input.prompt.length > MAX_JOB_PROMPT) throw new ToolError('Review a task with 1–2,000 characters before starting.');
    const prompt = input.prompt.trim();
    // The first queue supports bounded text replies only. No tools, websites,
    // files, private memory, paid media, or side-effecting action are dispatched.
    if (prompt.startsWith('/search') || prompt.startsWith('/image') || prompt.startsWith('/repo')) throw new ToolError('Background tasks accept text replies only.');
    const id = randomUUID();
    await db.query('delete from xyvora_jobs where account_id=$1 and created_ms < $2', [user.id, now - ttl]);
    if (running.size >= 2) throw new ToolError('The background worker is busy. Try again soon.', 429);
    const controller = new AbortController();
    running.set(id, controller);
    try {
      const rows = await db.query(`insert into xyvora_jobs (id,account_id,prompt,state,created_ms,updated_ms)
        select $1,$2,$3,'running',$4,$4 where not exists (select 1 from xyvora_jobs where account_id=$2 and created_ms>$5)
        on conflict do nothing returning id`, [id, user.id, prompt, now, now - 20_000]);
      if (!rows.length) throw new ToolError('Finish the active task or wait 20 seconds before starting another.', 429);
    } catch (error) { running.delete(id); throw error; }
    schedule((async () => {
      try {
        const signal = AbortSignal.any([AbortSignal.timeout(80_000), controller.signal]);
        const reply = await handleChat(new Request(`${config.origin}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ model: DEFAULT_MODEL, mode: 'normal', messages: [{ role: 'user', content: prompt }] }) }), { ...chat, limit: false, search: undefined });
        const text = await readReply(reply, signal);
        await db.query("update xyvora_jobs set state='finished', result=$2, updated_ms=$3 where id=$1 and state='running'", [id, text, Date.now()]);
      } catch {
        await db.query("update xyvora_jobs set state='error', result='The reply could not finish. Try a shorter prompt or wait until the chat is less busy.', updated_ms=$2 where id=$1 and state='running'", [id, Date.now()]).catch(() => undefined);
      } finally { running.delete(id); }
    })());
    return json({ id, state: 'running' }, 202);
  } catch (error) {
    return json({ error: error instanceof ToolError ? error.message : 'The background task service is unavailable.' }, error instanceof ToolError ? error.status : 503);
  }
}
