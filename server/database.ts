import type pg from 'pg';

export type SqlValues = (string | number | boolean | null)[];
export interface PlatformDb {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: SqlValues): Promise<T[]>;
}
let pooled: { url: string; db: PlatformDb } | undefined;

export function productionDb(env: Record<string, string | undefined>): PlatformDb | undefined {
  const url = env.XYVORA_DATABASE_URL?.trim();
  if (!url) return;
  if (pooled?.url === url) return pooled.db;
  let pending: Promise<pg.Pool> | undefined;
  const db: PlatformDb = { async query(sql, values) {
    if (!/^postgres(?:ql)?:\/\//i.test(url)) throw new Error('Use a PostgreSQL URL for XYVORA_DATABASE_URL.');
    // Chat and unconfigured deployments do not initialize a driver or pool.
    pending ??= import('pg').then(({ default: driver }) => {
      const sharedPooler = new URL(url).hostname.endsWith('.pooler.supabase.com');
      // Supavisor multiplexes sessions; the scoped role sets statement_timeout
      // in 003_server_access.sql instead of sending an unsupported startup GUC.
      const pool = new driver.Pool({ connectionString: url, max: sharedPooler ? 1 : 3,
        idleTimeoutMillis: 8_000, connectionTimeoutMillis: 3_000, ...(sharedPooler ? {} : { statement_timeout: 5_000 }),
        query_timeout: 6_000, allowExitOnIdle: true });
      pool.on('error', () => console.error('[xyvora] The platform database connection closed.'));
      return pool;
    });
    return (await (await pending).query(sql, values)).rows;
  } };
  pooled = { url, db };
  return db;
}
