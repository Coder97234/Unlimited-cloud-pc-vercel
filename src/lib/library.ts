import { isAccountId } from '../../shared/account.ts';
import { isThreadId, restoreThreads } from '../../shared/history.ts';
import type { Thread } from '../../shared/history.ts';
import { LIBRARY_MAX_TURNS, LIBRARY_PAGE, parseLibraryChat } from '../../shared/library.ts';
import type { LibraryEntry, LibraryFilter, LibraryPage } from '../../shared/library.ts';
import { accountHistoryChangeKey, accountJson, notifyAccountChange } from './account.ts';

const endpoint = '?section=library';
function parseEntry(raw: unknown, summary = false): LibraryEntry {
  const value = raw as Partial<LibraryEntry> | undefined;
  const chat = summary && value?.chat && Array.isArray(value.chat.turns) && !value.chat.turns.length
    ? restoreThreads([value.chat], 1, LIBRARY_MAX_TURNS)[0] : parseLibraryChat(value?.chat);
  if (!isAccountId(value?.revision) || !chat) throw new Error('Could not read the saved conversation.');
  return { chat, revision: value.revision, ...(isThreadId(value.match?.turnId) && typeof value.match.text === 'string' && { match: { turnId: value.match.turnId, text: value.match.text.slice(0, 260) } }) };
}
function version(value: { revision?: unknown; total?: unknown } | undefined) {
  if (!value || !isAccountId(value.revision) || typeof value.total !== 'number' || !Number.isSafeInteger(value.total) || value.total < 0) throw new Error('Could not verify the conversation library version.');
  return { revision: value.revision, total: value.total };
}
export async function listLibrary(id: string, signal: AbortSignal, options: { older?: string; q?: string; project?: string; filter?: LibraryFilter } = {}): Promise<LibraryPage> {
  const params = new URLSearchParams();
  for (const [key, item] of Object.entries(options)) if (item) params.set(key, item);
  const data = await accountJson(`${endpoint}${params.size ? `&${params}` : ''}`, signal, undefined, id);
  if (!Array.isArray(data.entries) || data.entries.length > LIBRARY_PAGE || (data.next !== null && typeof data.next !== 'string')) throw new Error('Could not read the conversation list.');
  return { ...version(data), next: data.next, entries: data.entries.map((item: unknown) => parseEntry(item, true)) };
}
export async function openLibraryChat(id: string, chat: string, signal: AbortSignal) {
  if (!isThreadId(chat)) throw new Error('Choose a valid conversation.');
  const data = await accountJson(`${endpoint}&id=${encodeURIComponent(chat)}`, signal, undefined, id);
  return parseEntry(data.entry);
}
export async function saveLibraryChat(id: string, chatId: string, before: LibraryEntry | undefined, chat: Thread | undefined, signal: AbortSignal) {
  const original = before?.chat;
  const revision = before?.revision ?? null;
  // Both a full chat and an unloaded sidebar entry can be renamed. Avoid
  // resending stored turns for a title-only edit, but preserve other changes.
  const rename = chat && original && chat.turns === original.turns
    && chat.mode === original.mode && chat.projectId === original.projectId && chat.pinned === original.pinned
    && chat.archived === original.archived && chat.favorite === original.favorite;
  if (chat && !chat.turns.length && !rename) throw new Error('Open this conversation before editing its contents.');
  const data = await accountJson(endpoint, signal, rename
    ? { action: 'rename', id: chatId, expected: revision, title: chat.title }
    : { action: chat ? 'save' : 'remove', id: chatId, expected: revision, chat }, id);
  const result = { ...version(data), entry: data.entry === null ? null : parseEntry(data.entry), conflict: data.conflict === true };
  if (!result.conflict) notifyAccountChange(accountHistoryChangeKey(id));
  return result;
}
export async function clearLibrary(id: string, revision: string, signal: AbortSignal) {
  const data = await accountJson(endpoint, signal, { action: 'clear', confirm: 'DELETE', revision }, id);
  if (data.cleared !== true) throw new Error('Could not confirm that the library was cleared.');
  notifyAccountChange(accountHistoryChangeKey(id));
  return version(data);
}
