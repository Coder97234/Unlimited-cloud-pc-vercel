import { brandAnswer } from './branding.ts';
import { wellFormedText } from './stored-text.ts';
import { DEFAULT_MODE, isReplyMode } from './modes.ts';
import type { ReplyMode } from './modes.ts';
import { DEFAULT_MODEL, MAX_ATTACHMENT, MAX_PROMPT } from './models.ts';
import type { ReplySource, TextAttachment } from './models.ts';
import { MAX_SEARCH_QUERY, normalizeSources } from './search.ts';
import type { WebSource } from './search.ts';
import { isSkillResultId } from './skill-catalog.ts';
import type { SkillResultId } from './skill-catalog.ts';

// Retain the old archive IDs for migration without turning them into labels.
const archiveIds = ['smollm', 'qwen', 'gpt-oss', 'mistral'] as const;
export type SavedModelId = typeof DEFAULT_MODEL | typeof archiveIds[number];
export type ChatMode = 'chat' | 'compare';
export type Attachment = TextAttachment;
export type Answer = {
  model: SavedModelId;
  content: string;
  replyMode?: ReplyMode;
  state: 'working' | 'finished' | 'stopped' | 'error';
  source?: ReplySource | 'legacy' | 'vision';
  skill?: SkillResultId;
  sources?: WebSource[];
  error?: string;
};
export type Turn = { id: string; prompt: string; attachment?: Attachment; imageName?: string; searchQuery?: string; contextOnly?: true; answers: Answer[] };
export type Thread = { id: string; title: string; mode: ChatMode; updatedAt: number; turns: Turn[] };

export const MAX_THREADS = 24;
export const MAX_TURNS = 30;

function restoreAnswer(raw: unknown): Answer | undefined {
  if (!raw || typeof raw !== 'object') return;
  const { model, content, state, source, skill, error, sources, replyMode } = raw as Record<string, unknown>;
  const id = model === 'local' || model === 'qwen-lite' ? DEFAULT_MODEL : model;
  if ((id !== DEFAULT_MODEL && !archiveIds.some((old) => old === id)) || typeof content !== 'string') return;
  const legacy = id !== DEFAULT_MODEL || model === 'local' || source === 'on-device' || source === 'legacy' || source === 'hosted';
  return {
    model: id as SavedModelId, content: safeText(brandAnswer(content), 36_000), replyMode: isReplyMode(replyMode) ? replyMode : DEFAULT_MODE,
    state: state === 'finished' || state === 'error' ? state : 'stopped',
    source: legacy ? 'legacy' : source === 'preview' || source === 'server' || source === 'clock' || source === 'skill' || source === 'vision' ? source : undefined,
    skill: !legacy && isSkillResultId(skill) ? skill : undefined,
    sources: normalizeSources(sources),
    error: state !== 'error' ? undefined : legacy ? 'This earlier reply did not finish. You can retry the prompt in a new chat.'
      : typeof error === 'string' ? safeText(brandAnswer(error), 500) : 'The reply did not finish. Try again.',
  };
}

const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
const safeText = (text: string, max: number) => wellFormedText(text.slice(0, max));
export const MAX_CLOUD_HISTORY_BYTES = 2_000_000;
export type CloudHistory = { revision: string | null; chats: Thread[] };

export function restoreThreads(parsed: unknown): Thread[] {
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((thread) => thread && validId(thread.id) && typeof thread.title === 'string'
    && (thread.mode === 'chat' || thread.mode === 'compare') && Array.isArray(thread.turns))
    .slice(0, MAX_THREADS)
    .map((thread: Thread) => ({
      id: thread.id, title: safeText(thread.title, 100), mode: thread.mode, updatedAt: Number.isFinite(thread.updatedAt) ? thread.updatedAt : 0,
      turns: thread.turns.filter((turn) => turn && validId(turn.id) && typeof turn.prompt === 'string' && Array.isArray(turn.answers))
        .slice(-MAX_TURNS).map((turn) => ({
          id: turn.id, prompt: safeText(turn.prompt, MAX_PROMPT),
          contextOnly: turn.contextOnly === true ? true : undefined,
          imageName: typeof turn.imageName === 'string' ? safeText(turn.imageName, 100).replace(/[\x00-\x1f\x7f]/g, ' ').trim() || undefined : undefined,
          searchQuery: typeof turn.searchQuery === 'string' ? safeText(turn.searchQuery.trim(), MAX_SEARCH_QUERY) || undefined : undefined,
          attachment: turn.attachment && typeof turn.attachment.text === 'string' && typeof turn.attachment.name === 'string'
            ? { name: safeText(turn.attachment.name, 120).replace(/[\x00-\x1f\x7f]/g, ' ').trim() || 'attachment.txt', text: safeText(turn.attachment.text, MAX_ATTACHMENT) } : undefined,
          answers: turn.answers.slice(0, thread.mode === 'compare' ? 4 : 1).map(restoreAnswer).filter((answer): answer is Answer => answer !== undefined),
        })),
    }));
}

export function parseCloudThreads(value: unknown): Thread[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_THREADS) return;
  const chats = restoreThreads(value);
  if (chats.length !== value.length || new Set(chats.map(({ id }) => id)).size !== chats.length) return;
  for (const chat of chats) {
    if (!chat.turns.length || chat.turns.some(({ answers }) => !answers.length)
      || new Set(chat.turns.map(({ id }) => id)).size !== chat.turns.length) return;
  }
  return chats;
}

// Merge independent edits, but never undo a deletion or overwrite a chat that
// was edited on another device. null means the UI needs a user's resolution.
export function mergeChatHistory(base: Thread[], local: Thread[], remote: Thread[]): Thread[] | null {
  const clean = (list: Thread[]) => new Map(restoreThreads(list).map((thread) => [thread.id, thread]));
  const before = clean(base), yours = clean(local), latest = clean(remote);
  const same = (a?: Thread, b?: Thread) => JSON.stringify(a) === JSON.stringify(b);
  for (const id of new Set([...before.keys(), ...yours.keys()])) {
    const old = before.get(id), changed = yours.get(id), cloud = latest.get(id);
    if (same(changed, old)) continue;
    if (!same(cloud, old) && !same(cloud, changed)) return null;
    if (changed) latest.set(id, changed);
    else latest.delete(id);
  }
  if (latest.size > MAX_THREADS) return null;
  return [...latest.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
