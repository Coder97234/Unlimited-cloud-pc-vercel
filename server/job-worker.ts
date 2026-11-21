import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { DEFAULT_MODEL } from '../shared/models.ts';
import { wellFormedText } from '../shared/stored-text.ts';
import { readChatEvents } from '../src/lib/stream.ts';
import { handleChat } from './chat.ts';
import type { PlatformDb } from './database.ts';
import { workerHeartbeat } from './worker-health.ts';

const maxAttempts = 3;
const maxAge = 15 * 60_000;
const leaseMillis = 100_000;
const pollMillis = 3_000;
type Chat = Parameters<typeof handleChat>[1];

export async function runQueuedTask(db: PlatformDb, origin: string, chat: Chat, shutdown: AbortSignal) {
  shutdown.throwIfAborted();
  const lease = randomUUID(), now = Date.now();
  await db.query(`update xyvora_jobs set state='error', lease=null, updated_ms=$1,
    result='The task did not finish in time. Start a new task to try again.'
    where state in ('queued','running') and lease_until_ms <= $1 and (attempts >= $2 or created_ms <= $3)`, [now, maxAttempts, now - maxAge]);
  // A durable lease lets another process resume work if this process exits.
  // SKIP LOCKED keeps simultaneous workers from claiming the same row.
  const [job] = await db.query<{ id: string; prompt: string; attempts: number }>(`with candidate as (
    select id from xyvora_jobs where state in ('queued','running') and lease_until_ms <= $1 and runnable_ms <= $1
    and attempts < $4 and created_ms > $5 order by runnable_ms, created_ms limit 1 for update skip locked
  ) update xyvora_jobs j set state='running', attempts=j.attempts+1, lease=$2, lease_until_ms=$3, updated_ms=$1
    from candidate c where j.id=c.id returning j.id,j.prompt,j.attempts`, [now, lease, now + leaseMillis, maxAttempts, now - maxAge]);
  if (!job) return false;
  const stop = new AbortController();
  let checking = false;
  const check = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      if (!(await db.query("select 1 from xyvora_jobs where id=$1 and lease=$2 and state='running' and lease_until_ms>$3", [job.id, lease, Date.now()])).length) stop.abort();
    } catch { /* Lease expiry bounds a database outage. */ }
    finally { checking = false; }
  }, pollMillis);
  check.unref?.();
  try {
    const signal = AbortSignal.any([shutdown, stop.signal, AbortSignal.timeout(75_000)]);
    const reply = await handleChat(new Request(`${origin}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ model: DEFAULT_MODEL, mode: 'normal', messages: [{ role: 'user', content: job.prompt }] }) }), { ...chat, limit: false, search: undefined });
    if (!reply.ok || !reply.body || !reply.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Reply unavailable');
    let text = '';
    await readChatEvents(reply.body, (delta) => { text = (text + delta).slice(0, 12_000); });
    signal.throwIfAborted();
    if (!text.trim()) throw new Error('Empty reply');
    if (reply.headers.get('x-xyvora-source') === 'preview') text = `Preview sample · not a live model\n\n${text}`;
    await db.query(`update xyvora_jobs set state='finished', result=$3, updated_ms=$4, lease=null, lease_until_ms=0
      where id=$1 and lease=$2 and state='running' and lease_until_ms>$4`, [job.id, lease, wellFormedText(text), Date.now()]);
  } catch {
    // No stale worker can replace cancelled/completed results. A worker that
    // can't reach the DB leaves the job reclaimable after the lease expires.
    if (!stop.signal.aborted) {
      const time = Date.now(), retry = job.attempts < maxAttempts;
      await db.query(`update xyvora_jobs set state=$3, updated_ms=$4, result=$5, runnable_ms=$6, lease=null, lease_until_ms=0
        where id=$1 and lease=$2 and state='running' and lease_until_ms>$4`, [job.id, lease, retry ? 'queued' : 'error', time,
        retry ? '' : 'The reply couldn’t finish after several tries. Try a shorter prompt or come back later.', time + 5_000 * (2 ** job.attempts)]).catch(() => undefined);
    }
  } finally { clearInterval(check); }
  return true;
}

export async function workTextQueue(db: PlatformDb, origin: string, chat: Chat, signal: AbortSignal) {
  let beating = false;
  const beat = async () => {
    if (beating || signal.aborted) return;
    beating = true;
    try { await workerHeartbeat(db); }
    catch { if (!signal.aborted) console.warn('[xyvora] Text worker could not update its heartbeat.'); }
    finally { beating = false; }
  };
  await beat();
  const heartbeat = setInterval(() => void beat(), 15_000);
  try {
    while (!signal.aborted) {
      try { await runQueuedTask(db, origin, chat, signal); }
      catch { if (!signal.aborted) console.warn('[xyvora] Text worker could not process the queue.'); }
      if (signal.aborted) break;
      await pause(pollMillis, undefined, { signal }).catch(() => undefined);
    }
  } finally { clearInterval(heartbeat); }
}
