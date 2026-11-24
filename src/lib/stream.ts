import type { Effort, HelioModelId, ReplyLanguage } from '../../shared/experience.ts';
import { PUBLIC_CREDENTIALS } from './early-access.ts';
import { parseHostedModel } from '../../shared/hosted-models.ts';
import type { HostedModel } from '../../shared/hosted-models.ts';
import { parseLocalModel } from '../../shared/local-models.ts';
import type { LocalModel } from '../../shared/local-models.ts';
import { brandedStream } from '../../shared/branding.ts';
import type { ReplyMode } from '../../shared/modes.ts';
import { DEFAULT_MODEL, REPLY_SKILL_HEADER, REPLY_SOURCE_HEADER } from '../../shared/models.ts';
import type { ChatMessage, ReplySource, TextAttachment } from '../../shared/models.ts';
import { normalizeSources } from '../../shared/search.ts';
import type { WebSource } from '../../shared/search.ts';
import { isSkillResultId } from '../../shared/skill-catalog.ts';
import type { SkillResultId } from '../../shared/skill-catalog.ts';

export class ChatError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) { super(message); this.code = code; }
}

export async function readChatEvents(body: ReadableStream<Uint8Array>, onText: (delta: string) => void, showServerError = false, onSources?: (sources: WebSource[]) => void, onModel?: (model: HostedModel) => void, onSearching?: () => void, onLocalModel?: (model: LocalModel) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;
  const consume = (raw: string) => {
    const data = raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') { ended = true; return; }
    let payload: { error?: unknown; sources?: unknown; hostedModel?: unknown; localModel?: unknown; searching?: unknown; choices?: { delta?: { content?: unknown }; finish_reason?: string }[] };
    try { payload = JSON.parse(data); }
    catch { throw new ChatError('Xyvora sent an unreadable response. Try again.'); }
    const choice = payload?.choices?.[0];
    if (payload?.error || choice?.finish_reason === 'error') {
      const message = (payload?.error as { message?: unknown } | undefined)?.message;
      throw new ChatError(showServerError && typeof message === 'string' ? message : 'Xyvora couldn’t finish the reply. Try again.');
    }
    if (payload?.searching === true) onSearching?.();
    const model = onModel && parseHostedModel(payload?.hostedModel);
    if (model) onModel?.(model);
    const local = onLocalModel && parseLocalModel(payload?.localModel);
    if (local) onLocalModel?.(local);
    if (Array.isArray(payload?.sources)) onSources?.(normalizeSources(payload.sources));
    if (typeof choice?.delta?.content === 'string') onText(choice.delta.content);
  };
  try {
    while (!ended) {
      const { done, value } = await reader.read();
      if (done) { buffer += decoder.decode(); if (buffer.trim()) consume(buffer); break; }
      buffer += decoder.decode(value, { stream: true });
      let separator: RegExpExecArray | null;
      while (!ended && (separator = /\r?\n\r?\n/.exec(buffer))) {
        consume(buffer.slice(0, separator.index));
        buffer = buffer.slice(separator.index + separator[0].length);
      }
      if (buffer.length > 100_000) throw new ChatError('Xyvora sent an unreadable response. Try again.');
    }
    if (!ended) throw new ChatError('The connection ended before the reply finished. You can try again.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function streamChat(messages: ChatMessage[], signal: AbortSignal, options: {
  mode?: ReplyMode;
  effort?: Effort;
  language?: ReplyLanguage;
  autoSearch?: boolean;
  model?: HelioModelId;
  searchQuery?: string;
  attachment?: TextAttachment;
  memory?: string[];
  project?: { id: string; accountId: string; includeFiles: boolean };
  onText: (delta: string) => void;
  onSource: (source: ReplySource, skill?: SkillResultId) => void;
  onSources: (sources: WebSource[]) => void;
  onLocalModel?: (model: LocalModel) => void;
  onSearching?: () => void;
}) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { project } = options;
  const accountId = project?.accountId;
  const response = await fetch('/api/chat', {
    method: 'POST', credentials: accountId ? 'same-origin' : PUBLIC_CREDENTIALS,
    headers: { 'Content-Type': 'application/json', ...(accountId && { 'X-Xyvora-Account': accountId }) },
    body: JSON.stringify({ model: options.model ?? DEFAULT_MODEL, mode: options.mode, effort: options.effort, language: options.language, autoSearch: options.autoSearch, messages, timeZone, searchQuery: options.searchQuery, attachment: options.attachment, memory: options.memory, ...(project && { projectId: project.id, projectFiles: project.includeFiles }) }), signal,
  });
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await response.json().catch(() => null);
    throw new ChatError(typeof data?.error === 'string' ? data.error : 'The chat server could not respond. Try again.', typeof data?.code === 'string' ? data.code : undefined);
  }
  const source = response.headers.get(REPLY_SOURCE_HEADER);
  const skill = response.headers.get(REPLY_SKILL_HEADER);
  if (source === 'server' || source === 'preview' || source === 'clock' || source === 'skill') options.onSource(source, isSkillResultId(skill) ? skill : undefined);
  const branded = brandedStream(options.onText);
  const filter = source === 'server' || !source;
  await readChatEvents(response.body, filter ? branded.text : options.onText, source !== 'preview', options.onSources, undefined, options.onSearching, options.onLocalModel);
  if (filter) branded.finish();
}
