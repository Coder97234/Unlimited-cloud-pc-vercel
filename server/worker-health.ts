import type { PlatformDb } from './database.ts';

export async function workerIsOnline(db: PlatformDb) {
  const rows = await db.query("select 1 from xyvora_worker_health where id='text' and last_ms > $1", [Date.now() - 45_000]);
  return rows.length > 0;
}
export async function workerHeartbeat(db: PlatformDb) {
  await db.query(`insert into xyvora_worker_health (id,last_ms) values ('text',$1)
    on conflict (id) do update set last_ms=greatest(xyvora_worker_health.last_ms, excluded.last_ms)`, [Date.now()]);
}
