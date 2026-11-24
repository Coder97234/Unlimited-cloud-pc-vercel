import { DEFAULT_MODE, INSTANT_HISTORY_CHARS } from '../../shared/modes.ts';
import type { ReplyMode } from '../../shared/modes.ts';
import { isHelioModelId } from '../../shared/experience.ts';
import { MAX_CONTEXT, MAX_MESSAGES, withAttachment } from '../../shared/models.ts';
import type { ChatMessage } from '../../shared/models.ts';
import { modelMessage } from '../../shared/skills.ts';
import { restoreThreads } from '../../shared/history.ts';
import type { Thread, Turn } from '../../shared/history.ts';

export type { Answer, Thread, Turn } from '../../shared/history.ts';
export { MAX_THREADS, MAX_TURNS } from '../../shared/history.ts';

const storageKey = 'xyvora.conversations.v1';
const historyKey = (accountId?: string) => accountId ? `${storageKey}.${accountId}` : storageKey;
export function loadThreads(accountId?: string): Thread[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(historyKey(accountId)) ?? '[]');
    return restoreThreads(parsed);
  } catch { return []; }
}

export function storeThreads(threads: Thread[], accountId?: string) {
  try { localStorage.setItem(historyKey(accountId), JSON.stringify(threads)); return true; }
  catch { return false; }
}

export function titleForPrompt(prompt: string) {
  const oneLine = prompt.trim().replace(/\s+/g, ' ');
  return oneLine.length > 47 ? `${oneLine.slice(0, 46).trimEnd()}…` : oneLine;
}

export function buildMessages(previous: Turn[], current: Pick<Turn, 'prompt' | 'attachment' | 'contextOnly'>, mode: ReplyMode = DEFAULT_MODE): ChatMessage[] {
  // Current attachments are sent separately so the server routes on the prompt,
  // not on text that happened to be inside an uploaded file.
  const messages: ChatMessage[] = [{ role: 'user', content: current.prompt }];
  if (current.contextOnly) return messages;
  let length = modelMessage(current.prompt, current.attachment).length;
  for (const turn of previous.slice(-9).reverse()) {
    const answer = turn.answers[0];
    if (turn.contextOnly || !answer || !isHelioModelId(answer.model) || answer.source === 'preview' || answer.source === 'legacy' || answer.source === 'skill' || !answer.content.trim() || answer.state !== 'finished') continue;
    const priorInput = withAttachment(turn.prompt, turn.attachment) + (turn.imageName ? '\n\n[An image was analyzed then; no image pixels are included now.]' : '');
    const text = answer.content.slice(0, MAX_CONTEXT);
    if (mode === 'instant' && priorInput.length + text.length > INSTANT_HISTORY_CHARS) break;
    if (length + priorInput.length + text.length > MAX_CONTEXT || messages.length + 2 > MAX_MESSAGES) break;
    messages.unshift({ role: 'user', content: priorInput }, { role: 'assistant', content: text });
    length += priorInput.length + text.length;
    if (mode === 'instant') break;
  }
  return messages;
}


// A fork is a separate thread. The edit path starts just before the selected
// prompt so the original answer and everything after it stay out of context.
export function forkThread(thread: Thread, turnId: string, kind: 'reply' | 'edit', now = Date.now()): Thread | undefined {
  if (thread.mode !== 'chat') return;
  const index = thread.turns.findIndex((turn) => turn.id === turnId);
  if (index === -1) return;
  if (kind === 'reply' && !thread.turns[index].answers.some(({ state, content }) => state === 'finished' && content.trim())) return;
  return {
    id: crypto.randomUUID(),
    title: `Branch · ${titleForPrompt(thread.title) || 'Untitled chat'}`,
    projectId: thread.projectId,
    mode: 'chat',
    updatedAt: now,
    turns: thread.turns.slice(0, index + (kind === 'reply' ? 1 : 0)),
  };
}

export function forgetThreads(accountId: string) {
  try { localStorage.removeItem(historyKey(accountId)); } catch { /* Local data can be cleared in browser settings. */ }
}
