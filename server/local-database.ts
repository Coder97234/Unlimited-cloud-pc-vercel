import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { PlatformDb } from './database.ts';

export function localPlatformDb(directory = '.cache/xyvora-platform'): PlatformDb {
  let database: Promise<PGlite> | undefined;
  return { async query(sql, params) {
    database ??= (async () => {
      const path = resolve(directory);
      await mkdir(path, { recursive: true });
      const db = new PGlite(path);
      await db.exec(await readFile('database/001_platform.sql', 'utf8'));
      return db;
    })();
    return (await (await database).query(sql, params)).rows as never[];
  } };
}
