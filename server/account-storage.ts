import { randomUUID } from 'node:crypto';
import { isAccountId } from '../shared/account.ts';
import { MAX_CLOUD_HISTORY_BYTES, parseCloudThreads } from '../shared/history.ts';
import { parsePreferences } from '../shared/preferences.ts';
import type { PlatformDb } from './database.ts';
import { ToolError } from './workspace-http.ts';

export async function readPreferences(db: PlatformDb, id: string) {
  const [row] = await db.query<{ settings: unknown }>('select settings from xyvora_preferences where account_id=$1', [id]);
  return parsePreferences(row?.settings) ?? {};
}
export async function changePreferences(db: PlatformDb, id: string, value: unknown) {
  const settings = parsePreferences(value);
  if (!settings || !Object.keys(settings).length) throw new ToolError('Choose valid workspace settings.');
  const [row] = await db.query<{ settings: unknown }>(`insert into xyvora_preferences (account_id, settings) values ($1,$2::jsonb)
    on conflict (account_id) do update set settings=xyvora_preferences.settings || excluded.settings returning settings`, [id, JSON.stringify(settings)]);
  return parsePreferences(row.settings) ?? {};
}
export async function readHistory(db: PlatformDb, id: string) {
  const [row] = await db.query<{ revision: string; chats: unknown; migrated: boolean | null }>(`select revision, chats, (to_jsonb(h)->>'migrated')::boolean as migrated from xyvora_cloud_history h where account_id=$1`, [id]);
  if (row?.migrated) throw new ToolError('These chats have moved to the conversation library. Reload Xyvora.', 409);
  const chats = row ? parseCloudThreads(row.chats) : [];
  if (!chats) throw new Error('Invalid saved history');
  return { revision: row?.revision ?? null, chats };
}
export async function changeHistory(db: PlatformDb, id: string, expected: unknown, input: unknown) {
  if (expected !== null && !isAccountId(expected)) throw new ToolError('Reload your chats before saving.');
  const chats = parseCloudThreads(input);
  if (!chats) throw new ToolError('The chat history is invalid.');
  const data = JSON.stringify(chats);
  if (Buffer.byteLength(data) > MAX_CLOUD_HISTORY_BYTES) throw new ToolError('Cloud history is full. Export and remove some conversations before saving.', 413);
  const revision = randomUUID();
  const changed = await (expected === null
    ? db.query('insert into xyvora_cloud_history (account_id, revision, chats) values ($1,$2,$3::jsonb) on conflict do nothing returning revision', [id, revision, data])
    : db.query('update xyvora_cloud_history set revision=$2, chats=$3::jsonb where account_id=$1 and revision=$4 returning revision', [id, revision, data, expected])).catch((error) => {
      if (error?.code === '55000') throw new ToolError('These chats have moved to the conversation library. Reload Xyvora.', 409);
      throw error;
    });
  if (!changed.length) return { conflict: true as const, ...(await readHistory(db, id)) };
  return { revision };
}
