import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { PlatformDb } from './database.ts';

export function localPlatformDb(directory = '.cache/xyvora-platform'): PlatformDb {
  let database: Promise<PGlite> | undefined;
  function open() {
    database ??= (async () => {
      const path = resolve(directory);
      await mkdir(path, { recursive: true });
      const db = new PGlite(path);
      for (const file of ['001_platform.sql', '002_launch.sql', '003_server_access.sql', '004_projects.sql', '005_conversation_library.sql', '006_session_management.sql']) await db.exec(await readFile(`database/${file}`, 'utf8'));
      return db;
    })();
    return database;
  }
  return {
    async query(sql, params) { return (await (await open()).query(sql, params)).rows as never[]; },
    async transaction(work) {
      return (await open()).transaction(async (tx) => {
        await tx.exec('set local role xyvora_app');
        return work({ query: async (sql, params) => (await tx.query(sql, params)).rows as never[] });
      });
    },
  };
}
