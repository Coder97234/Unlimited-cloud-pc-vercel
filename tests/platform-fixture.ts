import { readFile } from 'node:fs/promises';
import type { TestContext } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { PlatformDb } from '../server/database.ts';

export const platformOrigin = 'https://test.xyvora.invalid';
export async function platformFixture(t: TestContext): Promise<PlatformDb> {
  const db = new PGlite();
  t.after(() => db.close());
  const migrations = await Promise.all(['001_platform.sql', '002_launch.sql'].map((file) => readFile(new URL(`../database/${file}`, import.meta.url), 'utf8')));
  for (const migration of [...migrations, ...migrations]) await db.exec(migration);
  return { query: async (sql, params) => (await db.query(sql, params)).rows as never[] };
}
export function platformPost(path: string, body: object, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request(platformOrigin + path, { signal, method: 'POST', headers: { 'Content-Type': 'application/json', Origin: platformOrigin, ...headers }, body: JSON.stringify(body) });
}
export class CookieJar {
  values = new Map<string, string>();
  update(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      if (cookie.includes('Max-Age=0')) this.values.delete(name);
      else this.values.set(name, pair.slice(index + 1));
    }
  }
  headers(id?: string): Record<string, string> { return { Cookie: [...this.values].map((pair) => pair.join('=')).join('; '), ...(id && { 'X-Xyvora-Account': id }) }; }
}
