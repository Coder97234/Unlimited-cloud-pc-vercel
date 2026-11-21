import { ACTIVE_MINUTES, REPORT_DAYS, RETENTION_DAYS } from '../shared/analytics.ts';
import type { AnalyticsReport } from '../shared/analytics.ts';
import { digest, sameOriginJson } from './account.ts';
import type { PlatformDb } from './database.ts';
import { asObject, boundedJson, ToolError } from './workspace-http.ts';

const dayMs = 86_400_000;
const snapshots = new WeakMap<PlatformDb, { time: number; value: Promise<AnalyticsReport> }>();
const pruning = new WeakMap<PlatformDb, number>();
const browserId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
let bucket = 0;
const limits = new Map<string, number>();
async function snapshot(db: PlatformDb, now: number): Promise<AnalyticsReport> {
  const today = Math.floor(now / dayMs), start = today - REPORT_DAYS + 1;
  const counts = await db.query<{ utc_day: number; count: string; active: string; browsers: string; returning: string; accounts: string }>(`with recent as (
    select b.utc_day, b.digest from xyvora_browser_days b join xyvora_browsers v using (digest)
    where not v.revoked and b.utc_day between $3 and $2
  ), totals as (select
    (select count(*) from xyvora_browsers where not revoked and last_ms > $1) as active,
    (select count(distinct digest) from recent) as browsers,
    (select count(*) from (select digest from recent group by digest having count(*) >= 2) r) as returning,
    (select count(*) from xyvora_accounts) as accounts
  ) select totals.*, dates.utc_day, coalesce(daily.count, 0) as count
  from totals cross join generate_series($3::int, $2::int) as dates(utc_day)
  left join (select utc_day, count(*) from recent group by utc_day) daily using (utc_day) order by dates.utc_day`,
  [now - ACTIVE_MINUTES * 60_000, today, start]);
  const row = counts[0];
  return { active: Number(row.active), today: Number(counts.at(-1)?.count ?? 0), browsers: Number(row.browsers), returning: Number(row.returning), accounts: Number(row.accounts), updatedAt: new Date(now).toISOString(),
    days: counts.map(({ utc_day, count }) => ({ date: new Date(utc_day * dayMs).toISOString().slice(0, 10), browsers: Number(count) })) };
}
function report(db: PlatformDb, now: number) {
  const last = snapshots.get(db);
  if (last && now >= last.time && now - last.time < 10_000) return last.value;
  const entry = { time: now, value: snapshot(db, now) };
  snapshots.set(db, entry);
  void entry.value.catch(() => { if (snapshots.get(db) === entry) snapshots.delete(db); });
  return entry.value;
}
export async function handleAnalytics(request: Request, origin: string, db?: PlatformDb, { now = Date.now, limit = true } = {}) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const json = (body: object, status = 200) => Response.json(body, { status, headers });
  try {
    if (request.method !== 'GET' && request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: { ...headers, Allow: 'GET, POST' } });
    if (!db || new URL(request.url).origin !== origin) return json({ available: false, reason: 'Usage data is not available right now.' }, request.method === 'GET' ? 200 : 503);
    const time = now(), day = Math.floor(time / dayMs);
    if (request.method === 'GET') return json({ available: true, report: await report(db, time) });
    sameOriginJson(request, origin);
    let body;
    try { body = asObject(await boundedJson(request, 220)); }
    catch (error) { throw error instanceof ToolError ? error : new ToolError('Send a valid analytics request.'); }
    if (typeof body.id !== 'string' || !browserId.test(body.id) || (body.action !== 'forget' && body.action !== 'ping')) throw new ToolError('A browser choice is required.');
    const id = digest(`xyvora-metrics:${body.id}`);
    if (limit) {
      if (time >= bucket) { bucket = time + 60_000; limits.clear(); }
      const ip = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) || 'local';
      const key = `ip:${ip}`, perIp = limits.get(key) ?? 0, total = limits.get('all') ?? 0;
      if (perIp >= 40 || total >= 600) throw new ToolError('Analytics is busy.', 429);
      limits.set(key, perIp + 1); limits.set('all', total + 1);
    }
    if (body.action === 'forget') {
      // Keep only a short-lived revocation marker so an in-flight ping from
      // another tab cannot restore activity after deletion.
      await db.query(`insert into xyvora_browsers (digest, last_ms, revoked) values ($1,$2,true)
        on conflict (digest) do update set last_ms = excluded.last_ms, revoked = true`, [id, time]);
      snapshots.delete(db);
      await db.query('delete from xyvora_browser_days where digest = $1', [id]);
      return new Response(null, { status: 204, headers });
    }
    if (body.consent !== true || request.headers.get('sec-gpc') === '1') throw new ToolError('Analytics requires your permission.', 403);
    if ((pruning.get(db) ?? 0) <= time) {
      pruning.set(db, time + 3_600_000);
      try {
        await db.query('delete from xyvora_browser_days where utc_day < $1', [day - RETENTION_DAYS + 1]);
        await db.query('delete from xyvora_browsers where last_ms < $1 or (revoked and last_ms < $2)', [time - RETENTION_DAYS * dayMs, time - dayMs]);
      } catch (error) { pruning.delete(db); throw error; }
    }
    // Atomic heartbeat: opt-out cannot leave an orphan daily counter.
    await db.query(`with seen as (
      insert into xyvora_browsers (digest, last_ms) values ($1,$2)
      on conflict (digest) do update set last_ms = greatest(xyvora_browsers.last_ms, excluded.last_ms) where not xyvora_browsers.revoked returning digest
    ) insert into xyvora_browser_days (digest, utc_day) select digest, $3 from seen on conflict do nothing`, [id, time, day]);
    return new Response(null, { status: 204, headers });
  } catch (error) {
    const status = error instanceof ToolError ? error.status : 503;
    return json({ available: false, error: error instanceof ToolError ? error.message : 'Analytics storage is temporarily unavailable.' }, status);
  }
}
