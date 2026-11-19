import { DEFAULT_MODEL, isModelId, isServerModel, MAX_CONTEXT, MAX_MESSAGE, MAX_MESSAGES, MAX_SERVER_CONTEXT } from '../../shared/models.ts';
import type { ChatMessage, ModelId, ReplySource } from '../../shared/models.ts';

export type ChatMode = 'chat' | 'compare';
export type Attachment = { name: string; text: string };
export type Answer = {
  model: ModelId;
  content: string;
  state: 'working' | 'finished' | 'stopped' | 'error';
  source?: ReplySource | 'legacy';
  error?: string;
};
export type Turn = { id: string; prompt: string; attachment?: Attachment; answers: Answer[] };
export type Thread = { id: string; title: string; mode: ChatMode; updatedAt: number; turns: Turn[] };

const storageKey = 'xyvora.conversations.v1';
export const MAX_THREADS = 24;
export const MAX_TURNS = 30;

function restoreAnswer(raw: unknown): Answer | undefined {
  if (!raw || typeof raw !== 'object') return;
  const { model, content, state, source, error, canUseDevice } = raw as Record<string, unknown>;
  const id = model === 'local' ? DEFAULT_MODEL : model;
  if (!isModelId(id) || typeof content !== 'string') return;
  const legacy = model === 'local' || source === 'on-device' || source === 'legacy';
  return {
    model: id, content,
    state: state === 'finished' || state === 'error' ? state : 'stopped',
    source: legacy ? 'legacy' : source === 'preview' || source === 'server' || source === 'hosted' ? source : undefined,
    error: state !== 'error' ? undefined : legacy ? 'This earlier reply did not finish. Retry to send a new request to the server.'
      : canUseDevice === true ? 'That model was unavailable. Retry with an available model.'
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

export function buildMessages(
  previous: Turn[], current: Pick<Turn, 'prompt' | 'attachment'>, lane: number, model: ModelId,
): ChatMessage[] {
  const input = inputText(current);
  const messages: ChatMessage[] = [{ role: 'user', content: input }];
  const budget = isServerModel(model) ? MAX_SERVER_CONTEXT : MAX_CONTEXT;
  let length = input.length;
  for (const turn of previous.slice(-9).reverse()) {
    const answer = turn.answers[lane];
    if (!answer || answer.source === 'preview' || answer.source === 'legacy' || !answer.content.trim() || answer.state !== 'finished') continue;
    const priorInput = inputText(turn);
    const text = answer.content.slice(0, MAX_MESSAGE);
    if (length + priorInput.length + text.length > budget || messages.length + 2 > MAX_MESSAGES) break;
    messages.unshift({ role: 'user', content: priorInput }, { role: 'assistant', content: text });
    length += priorInput.length + text.length;
  }
  return messages;
}
