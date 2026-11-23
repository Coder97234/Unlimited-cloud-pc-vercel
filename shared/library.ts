import { isThreadId, restoreThreads } from './history.ts';
import type { Thread } from './history.ts';

export const LIBRARY_PAGE = 36;
export const LIBRARY_MAX_CHATS = 5_000;
export const LIBRARY_MAX_TURNS = 120;
export const LIBRARY_MAX_CHAT_BYTES = 1_850_000;
export const LIBRARY_MAX_BYTES = 64_000_000;
export type LibraryEntry = { chat: Thread; revision: string; match?: { turnId: string; text: string } };
export type LibraryPage = { entries: LibraryEntry[]; next: string | null; total: number; revision: string };
export type LibraryFilter = 'recent' | 'all' | 'archive' | 'favorite';

export function parseLibraryChat(raw: unknown): Thread | undefined {
  if (!raw || typeof raw !== 'object') return;
  const original = raw as Partial<Thread>;
  const [chat] = restoreThreads([raw], 1, LIBRARY_MAX_TURNS);
  if (!chat || !chat.turns.length || chat.turns.length !== original.turns?.length || chat.turns.some(({ answers }) => !answers.length)
    || new Set(chat.turns.map(({ id }) => id)).size !== chat.turns.length) return;
  return chat;
}
export function olderCursor(value: unknown): [boolean, number, string] | undefined {
  if (Array.isArray(value) && value.length === 3 && typeof value[0] === 'boolean' && Number.isSafeInteger(value[1]) && isThreadId(value[2])) {
    return [value[0], value[1], value[2]];
  }
}
