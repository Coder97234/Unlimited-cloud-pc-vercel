import { brandAnswer } from '../../shared/branding.ts';
import { DEFAULT_MODE, INSTANT_HISTORY_CHARS, isReplyMode } from '../../shared/modes.ts';
import type { ReplyMode } from '../../shared/modes.ts';
import { DEFAULT_MODEL, MAX_ATTACHMENT, MAX_CONTEXT, MAX_MESSAGES, withAttachment } from '../../shared/models.ts';
import type { ChatMessage, ReplySource, TextAttachment } from '../../shared/models.ts';
import { MAX_SEARCH_QUERY, normalizeSources } from '../../shared/search.ts';
import type { WebSource } from '../../shared/search.ts';
import { isSkillResultId } from '../../shared/skill-catalog.ts';
import type { SkillResultId } from '../../shared/skill-catalog.ts';
import { modelMessage } from '../../shared/skills.ts';

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
  source?: ReplySource | 'legacy';
  skill?: SkillResultId;
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
  const { model, content, state, source, skill, error, sources, replyMode } = raw as Record<string, unknown>;
  const id = model === 'local' || model === 'qwen-lite' ? DEFAULT_MODEL : model;
  if ((id !== DEFAULT_MODEL && !archiveIds.some((old) => old === id)) || typeof content !== 'string') return;
  const legacy = id !== DEFAULT_MODEL || model === 'local' || source === 'on-device' || source === 'legacy' || source === 'hosted';
  return {
    model: id as SavedModelId, content: brandAnswer(content), replyMode: isReplyMode(replyMode) ? replyMode : DEFAULT_MODE,
    state: state === 'finished' || state === 'error' ? state : 'stopped',
    source: legacy ? 'legacy' : source === 'preview' || source === 'server' || source === 'clock' || source === 'skill' ? source : undefined,
    skill: !legacy && isSkillResultId(skill) ? skill : undefined,
    sources: normalizeSources(sources),
    error: state !== 'error' ? undefined : legacy ? 'This earlier reply did not finish. You can retry the prompt in a new chat.'
      : typeof error === 'string' ? brandAnswer(error) : 'The reply did not finish. Try again.',
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
              ? { name: turn.attachment.name.slice(0, 120).replace(/[\x00-\x1f\x7f]/g, ' ').trim() || 'attachment.txt', text: turn.attachment.text.slice(0, MAX_ATTACHMENT) } : undefined,
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

export function buildMessages(previous: Turn[], current: Pick<Turn, 'prompt' | 'attachment'>, mode: ReplyMode = DEFAULT_MODE): ChatMessage[] {
  // Current attachments are sent separately so the server routes on the prompt,
  // not on text that happened to be inside an uploaded file.
  const messages: ChatMessage[] = [{ role: 'user', content: current.prompt }];
  let length = modelMessage(current.prompt, current.attachment).length;
  for (const turn of previous.slice(-9).reverse()) {
    const answer = turn.answers[0];
    if (!answer || answer.model !== DEFAULT_MODEL || answer.source === 'preview' || answer.source === 'legacy' || answer.source === 'skill' || !answer.content.trim() || answer.state !== 'finished') continue;
    const priorInput = withAttachment(turn.prompt, turn.attachment);
    const text = answer.content.slice(0, MAX_CONTEXT);
    if (mode === 'instant' && priorInput.length + text.length > INSTANT_HISTORY_CHARS) break;
    if (length + priorInput.length + text.length > MAX_CONTEXT || messages.length + 2 > MAX_MESSAGES) break;
    messages.unshift({ role: 'user', content: priorInput }, { role: 'assistant', content: text });
    length += priorInput.length + text.length;
    if (mode === 'instant') break;
  }
  return messages;
}
