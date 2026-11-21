import { randomUUID } from 'node:crypto';
import { isAccountId } from '../shared/account.ts';
import { MAX_JOB_PROMPT } from '../shared/jobs.ts';
import { wellFormedText } from '../shared/stored-text.ts';
import type { BackgroundJob } from '../shared/jobs.ts';
import { sameOriginJson, verifiedAccount } from './account.ts';
import type { AccountConfig } from './account.ts';
import { workspaceIntent } from '../shared/workspace-tools.ts';
import { explicitSearchQuery } from '../shared/search.ts';
import { workerIsOnline } from './worker-health.ts';
import { asObject, boundedJson, ToolError } from './workspace-http.ts';

const ttl = 30 * 86_400_000;
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
export async function handleJobs(request: Request, config: AccountConfig | undefined) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  const json = (data: object, status = 200) => Response.json(data, { status, headers });
  try {
    if (!config?.background || new URL(request.url).origin !== config.origin) throw new ToolError('Background tasks are unavailable.', 503);
    if (!['POST', 'GET'].includes(request.method)) return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: { ...headers, Allow: 'GET, POST' } });
    if (request.method === 'POST') sameOriginJson(request, config.origin);
    limitJobs(request);
    const user = await verifiedAccount(request, config);
    if (!user) throw new ToolError('Sign in to use background tasks.', 401);
    if (request.headers.get('x-xyvora-account') !== user.id) throw new ToolError('Your account changed. Refresh and try again.', 409);
    const db = config.db, now = Date.now();
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
        ? await db.query("update xyvora_jobs set state='cancelled', result='', updated_ms=$3 where id=$1 and account_id=$2 and state in ('queued','running') returning id", [input.id, user.id, now])
        : await db.query("delete from xyvora_jobs where id=$1 and account_id=$2 and state not in ('queued','running') returning id", [input.id, user.id]);
      if (!affected.length) throw new ToolError('That task is no longer available for this action.', 404);
      return json({ ok: true });
    }
    if (input.action !== 'start' || input.approved !== true || typeof input.prompt !== 'string' || input.prompt.trim().length < 1 || input.prompt.length > MAX_JOB_PROMPT) throw new ToolError('Review a task with 1–2,000 characters before starting.');
    const prompt = wellFormedText(input.prompt.trim());
    // This worker dispatches text generation only; don't enqueue commands
    // that require access to other services or the browser's local tools.
    if (explicitSearchQuery(prompt) !== undefined || workspaceIntent(prompt) || /^\/remember(?:\s|$)/i.test(prompt)) throw new ToolError('Background tasks accept text replies only.');
    if (!await workerIsOnline(db)) throw new ToolError('Background tasks are temporarily paused. Try again shortly.', 503);
    const id = randomUUID();
    await db.query('delete from xyvora_jobs where account_id=$1 and created_ms < $2', [user.id, now - ttl]);
    const rows = await db.query(`insert into xyvora_jobs (id,account_id,prompt,state,created_ms,updated_ms,runnable_ms)
      select $1,$2,$3,'queued',$4,$4,$4
      where not exists (select 1 from xyvora_jobs where account_id=$2 and created_ms>$5)
      and (select count(*) from xyvora_jobs where state in ('queued','running')) < 100
      on conflict do nothing returning id`, [id, user.id, prompt, now, now - 20_000]);
    if (!rows.length) throw new ToolError('A task is already active or the queue is busy. Try again shortly.', 429);
    return json({ id, state: 'queued' }, 202);
  } catch (error) {
    return json({ error: error instanceof ToolError ? error.message : 'The background task service is unavailable.' }, error instanceof ToolError ? error.status : 503);
  }
}
