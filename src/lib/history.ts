import { DEFAULT_MODEL, MAX_CONTEXT, MAX_MESSAGES, MODEL_NAME } from '../../shared/models.ts';
import type { ChatMessage, ReplySource } from '../../shared/models.ts';
import { MAX_SEARCH_QUERY, normalizeSources } from '../../shared/search.ts';
import type { WebSource } from '../../shared/search.ts';

// These names are retained for the local archive only. The API accepts Qwen 2.5.
export const SAVED_MODEL_NAMES = {
  [DEFAULT_MODEL]: MODEL_NAME, smollm: 'SmolLM2 360M', qwen: 'Qwen 3 32B', 'gpt-oss': 'GPT OSS 20B', mistral: 'Mistral Nemo',
} as const;
export type SavedModelId = keyof typeof SAVED_MODEL_NAMES;
export type ChatMode = 'chat' | 'compare';
export type Attachment = { name: string; text: string };
export type Answer = {
  model: SavedModelId;
  content: string;
  state: 'working' | 'finished' | 'stopped' | 'error';
  source?: ReplySource | 'legacy';
  sources?: WebSource[];
  error?: string;
};
export type Turn = { id: string; prompt: string; attachment?: Attachment; searchQuery?: string; answers: Answer[] };
export type Thread = { id: string; title: string; mode: ChatMode; updatedAt: number; turns: Turn[] };

const storageKey = 'xyvora.conversations.v1';
export const MAX_THREADS = 24;
export const MAX_TURNS = 30;

function restoreAnswer(raw: unknown): Answer | undefined {
  if (!raw || typeof raw !== 'object') return;
  const { model, content, state, source, error, sources } = raw as Record<string, unknown>;
  const id = model === 'local' ? DEFAULT_MODEL : model;
  if (typeof id !== 'string' || !Object.hasOwn(SAVED_MODEL_NAMES, id) || typeof content !== 'string') return;
  const legacy = id !== DEFAULT_MODEL || model === 'local' || source === 'on-device' || source === 'legacy' || source === 'hosted';
  return {
    model: id as SavedModelId, content,
    state: state === 'finished' || state === 'error' ? state : 'stopped',
    source: legacy ? 'legacy' : source === 'preview' || source === 'server' || source === 'clock' ? source : undefined,
    sources: normalizeSources(sources),
    error: state !== 'error' ? undefined : legacy ? 'This earlier reply did not finish. You can retry the prompt with Qwen 2.5 in chat.'
      : typeof error === 'string' ? error : 'The reply did not finish. Try again.',
  };
}

export function loadThreads(): Thread[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((thread) => thread && typeof thread.id === 'string' && typeof thread.title === 'string'
      && (thread.mode === 'chat' || thread.mode === 'compare') && Array.isArray(thread.turns))
      .slice(0, MAX_THREADS)
      .map((thread: Thread) => ({
        ...thread,
        turns: thread.turns.filter((turn) => turn && typeof turn.id === 'string' && typeof turn.prompt === 'string' && Array.isArray(turn.answers))
          .slice(-MAX_TURNS).map((turn) => ({
            ...turn,
            searchQuery: typeof turn.searchQuery === 'string' ? turn.searchQuery.trim().slice(0, MAX_SEARCH_QUERY) || undefined : undefined,
            attachment: turn.attachment && typeof turn.attachment.text === 'string' && typeof turn.attachment.name === 'string'
              ? turn.attachment : undefined,
            answers: turn.answers.map(restoreAnswer).filter((answer): answer is Answer => answer !== undefined),
          })),
      }));
  } catch { return []; }
}

export function storeThreads(threads: Thread[]) {
  try { localStorage.setItem(storageKey, JSON.stringify(threads)); return true; }
  catch { return false; }
}

export function titleForPrompt(prompt: string) {
  const oneLine = prompt.trim().replace(/\s+/g, ' ');
  return oneLine.length > 47 ? `${oneLine.slice(0, 46).trimEnd()}…` : oneLine;
}

function inputText(turn: Pick<Turn, 'prompt' | 'attachment'>) {
  return turn.attachment
    ? `${turn.prompt}\n\nAttached text file (${turn.attachment.name}):\n${turn.attachment.text}`
    : turn.prompt;
}

export function buildMessages(previous: Turn[], current: Pick<Turn, 'prompt' | 'attachment'>): ChatMessage[] {
  const input = inputText(current);
  const messages: ChatMessage[] = [{ role: 'user', content: input }];
  let length = input.length;
  for (const turn of previous.slice(-9).reverse()) {
    const answer = turn.answers[0];
    if (!answer || answer.model !== DEFAULT_MODEL || answer.source === 'preview' || answer.source === 'legacy' || !answer.content.trim() || answer.state !== 'finished') continue;
    const priorInput = inputText(turn);
    const text = answer.content.slice(0, MAX_CONTEXT);
    if (length + priorInput.length + text.length > MAX_CONTEXT || messages.length + 2 > MAX_MESSAGES) break;
    messages.unshift({ role: 'user', content: priorInput }, { role: 'assistant', content: text });
    length += priorInput.length + text.length;
  }
  return messages;
}
