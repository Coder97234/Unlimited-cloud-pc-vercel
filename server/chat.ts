import { EFFORTS, isEffort, isReplyLanguage } from '../shared/experience.ts';
import type { HelioModelId, ReplyLanguage } from '../shared/experience.ts';
import { ADVANCED_LOCAL_MODEL_ID, isLocalModelId } from '../shared/local-models.ts';
import type { LocalModel } from '../shared/local-models.ts';
import type { LocalModels } from './local-models.ts';
import { DEFAULT_MODE, isReplyMode, modeContext, MODE_IDS } from '../shared/modes.ts';
import { isModelChoice } from '../shared/hosted-models.ts';
import type { HostedModel, ModelChoice } from '../shared/hosted-models.ts';
import { isProjectId, projectPrompt } from '../shared/projects.ts';
import type { ProjectContext } from '../shared/projects.ts';
import { ToolError } from './workspace-http.ts';
import { checkedCreatorStream, mentionsCreator, verifiedTeamReply } from '../shared/creator-policy.ts';
import { brandedStream } from '../shared/branding.ts';
import { ASSISTANT_PROFILE, DEFAULT_MODEL, MAX_ATTACHMENT, MAX_CONTEXT, MAX_MESSAGES, MAX_PROMPT, REPLY_SKILL_HEADER, REPLY_SOURCE_HEADER, withAttachment } from '../shared/models.ts';
import type { Availability, ChatMessage, ReplySource, TextAttachment } from '../shared/models.ts';
import { allowsSearchToggle, automaticSearchQuery, explicitSearchQuery, isResearchPrompt, MAX_SEARCH_QUERY, normalizeSources } from '../shared/search.ts';
import { parseMemoryNotes, preferencesContext } from '../shared/memory.ts';
import { readSkillCommand, SKILL_IDS, skillAvailable } from '../shared/skill-catalog.ts';
import type { SkillResultId } from '../shared/skill-catalog.ts';
import { modelMessage, runInstantSkill, teamAnswerSkill } from '../shared/skills.ts';
import { clockReply, contextualClock, validTimeZone } from './clock.ts';
import { inferenceStream, localReplyTimeout } from './inference-stream.ts';
import type { RoutedGenerate, ServerGenerate } from './inference-stream.ts';
import { previewResponse } from './preview.ts';
import type { SearchService } from './searxng.ts';

const MAX_BODY_BYTES = 85_000;
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-store, no-transform',
  'X-Content-Type-Options': 'nosniff',
};

function reply(body: BodyInit, source: ReplySource, skill?: SkillResultId) {
  return new Response(body, { headers: { ...SSE_HEADERS, [REPLY_SOURCE_HEADER]: source, ...(skill && { [REPLY_SKILL_HEADER]: skill }) } });
}

// A complete SSE reply needs no generation timer, heartbeat, or native import.
function instantReply(content: string, source: 'skill' | 'clock', skill: SkillResultId) {
  return reply(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, source, skill);
}

class InvalidInput extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function json(value: object, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new InvalidInput('Your message is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new InvalidInput('A message is required.');
  const decoder = new TextDecoder();
  let total = 0;
  let raw = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new InvalidInput('Your message is too large.', 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
    return JSON.parse(raw + decoder.decode());
  } catch (error) {
    if (error instanceof InvalidInput) throw error;
    throw new InvalidInput('Send a valid JSON chat request.');
  } finally { reader.releaseLock(); }
}

function parseAttachment(value: unknown): TextAttachment | undefined {
  if (value === undefined) return;
  if (value === null || typeof value !== 'object') throw new InvalidInput('Send a valid text attachment.');
  const { name, text } = value as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim() || name.length > 120 || /[\x00-\x1f\x7f]/.test(name)
    || typeof text !== 'string' || !text.trim() || text.includes('\0')) throw new InvalidInput('Send a valid text attachment.');
  if (text.length > MAX_ATTACHMENT) throw new InvalidInput(`Attachments can be at most ${MAX_ATTACHMENT} characters.`, 413);
  return { name, text };
}

export function parseChat(input: unknown) {
  if (typeof input !== 'object' || input === null) throw new InvalidInput('A message is required.');
  const { model = DEFAULT_MODEL, mode = DEFAULT_MODE, messages, timeZone = 'UTC', effort, language, autoSearch, searchQuery, attachment: rawAttachment, memory: rawMemory, projectId, projectFiles } = input as Record<string, unknown>;
  // Accept requests from the preceding client during rollout, but never advertise the old ID.
  if (!isModelChoice(model) && !isLocalModelId(model) && model !== 'qwen-lite') throw new InvalidInput('Send a supported Xyvora model ID.');
  if (!isReplyMode(mode)) throw new InvalidInput('Select a supported reply mode.');
  if (effort !== undefined && !isEffort(effort)) throw new InvalidInput('Select a supported effort level.');
  if (language !== undefined && !isReplyLanguage(language)) throw new InvalidInput('Choose a supported reply language.');
  if (autoSearch !== undefined && typeof autoSearch !== 'boolean') throw new InvalidInput('Set automatic search on or off.');
  if (!validTimeZone(timeZone)) throw new InvalidInput('Send a valid IANA time zone, or omit it to use UTC.');
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES || messages.length % 2 === 0) {
    throw new InvalidInput('Send a conversation ending with a user message.');
  }
  let total = 0;
  const cleaned = messages.map((message, index): ChatMessage => {
    const role = index % 2 === 0 ? 'user' : 'assistant';
    if (message?.role !== role || typeof message.content !== 'string' || !message.content.trim()) {
      throw new InvalidInput('Conversation roles or messages are invalid.');
    }
    const content = message.content.trim();
    total += content.length;
    if (total > MAX_CONTEXT) throw new InvalidInput('This conversation is too long. Shorten your prompt or attachment and try again.', 413);
    return { role, content };
  });
  const prompt = cleaned.at(-1)!.content;
  if (prompt.length > MAX_PROMPT) throw new InvalidInput('Your message is too long. Shorten the prompt and try again.', 413);
  const attachment = parseAttachment(rawAttachment);
  const memory = rawMemory === undefined ? [] : parseMemoryNotes(rawMemory);
  if (!memory) throw new InvalidInput('Send valid, bounded memory notes.');
  const rawQuery = explicitSearchQuery(prompt) ?? (searchQuery !== undefined && allowsSearchToggle(prompt) ? searchQuery : undefined);
  let query: string | undefined;
  if (rawQuery !== undefined) {
    if (typeof rawQuery !== 'string' || rawQuery.length > MAX_SEARCH_QUERY || !rawQuery.trim()) {
      throw new InvalidInput(`Enter a web search query of 1–${MAX_SEARCH_QUERY} characters.`);
    }
    query = rawQuery.replace(/\s+/g, ' ').trim();
  }
  if (projectId !== undefined && (!isProjectId(projectId) || typeof projectFiles !== 'boolean')) throw new InvalidInput('Choose a valid project.');
  if (projectId === undefined && projectFiles !== undefined) throw new InvalidInput('Choose a project before using project files.');
  return { ...(typeof projectId === 'string' && { project: { id: projectId, includeFiles: projectFiles === true } }),
    ...(model !== DEFAULT_MODEL && model !== 'qwen-lite' && { model }), messages: modeContext(cleaned, mode), timeZone, query, mode, ...(effort && { effort }), ...(language && { language }), ...(autoSearch === true && { autoSearch }), ...(memory.length && { memory }), ...(attachment && { attachment }) };
}

// Best-effort limit per function instance; this is not a shared public quota.
const windowMs = 60_000;
const ipWindows = new Map<string, { until: number; used: number; searches: number }>();
let globalWindow = { until: 0, used: 0, searches: 0 };
function mayRequest(ip: string, search: boolean) {
  const now = Date.now();
  if (globalWindow.until <= now) {
    globalWindow = { until: now + windowMs, used: 0, searches: 0 };
    for (const [key, record] of ipWindows) if (record.until <= now) ipWindows.delete(key);
  }
  if (globalWindow.used >= 90 || (search && globalWindow.searches >= 30)) return false;
  const record = ipWindows.get(ip) ?? { until: now + windowMs, used: 0, searches: 0 };
  if (record.until <= now) { record.until = now + windowMs; record.used = 0; record.searches = 0; }
  if (record.used >= 14 || (search && record.searches >= 6)) return false;
  record.used += 1;
  if (search) { record.searches += 1; globalWindow.searches += 1; }
  ipWindows.set(ip, record);
  globalWindow.used += 1;
  return true;
}

interface ChatOptions {
  preview?: boolean;
  limit?: boolean;
  generate?: ServerGenerate;
  search?: SearchService;
  research?: SearchService;
  now?: () => Date;
  hosted?: (request: Request, model: Exclude<ModelChoice, 'xyvora'>) => Promise<RoutedGenerate<HostedModel>>;
  localModels?: LocalModels;
  projectContext?: (request: Request, id: string, query: string, includeFiles: boolean) => Promise<ProjectContext>;
}

export async function handleChat(request: Request, options: ChatOptions = {}): Promise<Response> {
  if (request.method === 'GET') {
    const local = await options.localModels?.available() ?? [];
    const canGenerate = !!options.generate || local.length > 0;
    const sample = !!options.preview && !options.generate;
    const availability: Availability = canGenerate ? 'server' : sample ? 'preview' : 'unavailable';
    const models: HelioModelId[] = options.generate || sample ? [DEFAULT_MODEL, ...local] : local;
    const webSearch = !!(options.search && canGenerate);
    return json({ assistant: ASSISTANT_PROFILE, availability, ...(sample && canGenerate && { sampleModels: [DEFAULT_MODEL] }),
      ...(options.research && canGenerate && { research: true }), models, webSearch, modes: MODE_IDS,
      skills: SKILL_IDS.filter((id) => skillAvailable(id, canGenerate, webSearch)) });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
  if (request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Use the Xyvora workspace to chat.' }, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'Use application/json.' }, 415);

  let input: ReturnType<typeof parseChat>;
  try { input = parseChat(await readBody(request)); }
  catch (error) {
    if (error instanceof InvalidInput) return json({ error: error.message }, error.status);
    return json({ error: 'Could not read this message.' }, 400);
  }
  if (request.signal.aborted) return new Response(null, { status: 499 });
  const prompt = input.messages.at(-1)!.content;
  const automatic = !input.query && input.autoSearch && !input.project && !input.attachment ? automaticSearchQuery(prompt) : undefined;
  const query = input.query ?? automatic;
  const ip = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) || 'unknown';
  if (options.limit && !mayRequest(ip, !!query)) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429, { 'Retry-After': '60' });

  let hosted: RoutedGenerate<HostedModel> | undefined;
  let local: RoutedGenerate<LocalModel> | undefined;
  // The Helio IDs never pass through account/provider routing (even if the
  // optional legacy hosted API happens to be active on this deployment).
  if (isLocalModelId(input.model)) {
    local = await options.localModels?.resolve(input.model);
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (!local) return json({
      error: input.model === ADVANCED_LOCAL_MODEL_ID ? 'Helio 5 needs a configured advanced reasoning model. Choose another Helio model.'
        : `Helio ${input.model.slice(-1)} has no available local model. Choose another Helio model.`,
      code: 'MODEL_UNAVAILABLE',
    }, 503);
  } else if (input.model) {
    if (!options.hosted) return json({ error: 'Hosted models are unavailable in this workspace.' }, 503);
    try { hosted = await options.hosted(request, input.model); }
    catch (error) { return json({ error: error instanceof ToolError ? error.message : 'Could not authorize the selected model.' }, error instanceof ToolError ? error.status : 503); }
  }
  let project: string | undefined;
  if (input.project) {
    if (!options.projectContext) return json({ error: 'Project context is unavailable.' }, 503);
    try {
      const context = await options.projectContext(request, input.project.id, prompt, input.project.includeFiles);
      const safe = {
        instructions: mentionsCreator(context.instructions) ? '' : context.instructions,
        excerpts: context.excerpts.filter(({ name, text }) => !mentionsCreator(`${name}\n${text}`)),
      };
      if (options.generate || local || hosted) project = projectPrompt(safe);
    } catch (error) {
      return json({ error: error instanceof ToolError ? error.message : 'Could not load the project. Try again.' }, error instanceof ToolError ? error.status : 503);
    }
  }
  if (request.signal.aborted) return new Response(null, { status: 499 });
  const now = options.now?.() ?? new Date();
  const team = teamAnswerSkill(prompt);
  if (team || (input.query && mentionsCreator(input.query))) return instantReply(team?.text ?? verifiedTeamReply, 'skill', 'about');
  if (!input.query) {
    const skill = runInstantSkill(prompt, input.attachment?.text);
    if (skill) return instantReply(skill.text, 'skill', skill.id);
    const clock = clockReply(prompt, input.timeZone, now, input.language);
    if (clock) return instantReply(clock, 'clock', 'time');
  }

  if (input.attachment && mentionsCreator(`${input.attachment.name}\n${input.attachment.text}`)) return instantReply(verifiedTeamReply, 'skill', 'about');
  const modelPrompt = input.query ? withAttachment(prompt, input.attachment) : modelMessage(prompt, input.attachment);
  // Drop older pairs through any explicit creator reference, so a new unrelated
  // request doesn't inherit a prior roleplay instruction or personal attack.
  let from = 0;
  for (let i = 0; i + 2 < input.messages.length; i += 2) {
    if (mentionsCreator(`${input.messages[i].content}\n${input.messages[i + 1].content}`)) from = i + 2;
  }
  const messages = input.messages.slice(from);
  if (modelPrompt !== prompt) {
    const historyLength = messages.slice(0, -1).reduce((sum, message) => sum + message.content.length, 0);
    if (historyLength + modelPrompt.length > MAX_CONTEXT) return json({ error: 'This conversation is too long. Shorten your prompt or attachment and try again.' }, 413);
    messages[messages.length - 1] = { role: 'user', content: modelPrompt };
  }

  const { generate } = options;
  const report = !!input.query && isResearchPrompt(prompt);
  const search = report ? options.research : options.search;
  if (input.query && (!search || (!generate && !local && !hosted))) return json({ error: 'Live web search is not available in this environment.', code: 'SEARCH_UNAVAILABLE' }, 503);
  if (!generate && !local && !hosted) {
    if (options.preview) return reply(previewResponse(modelPrompt, request.signal, input.mode, input.language), 'preview');
    return json({ error: 'Xyvora replies are unavailable. Please try again.', code: 'MODEL_UNAVAILABLE' }, 503);
  }

  if (automatic && !search) return instantReply(searchMessage('offline', input.language), 'skill', 'search');

  const task: 'translate' | undefined = !input.query && readSkillCommand(prompt)?.id === 'translate' ? 'translate' : undefined;
  const notes = input.memory?.filter((note) => !mentionsCreator(note));
  const preferences = !task && notes?.length
    ? preferencesContext(notes, MAX_CONTEXT - messages.reduce((sum, message) => sum + message.content.length, 0))
    : undefined;

  const deadline = local ? localReplyTimeout(input.effort) : input.effort ? EFFORTS[input.effort].timeout : undefined;
  return reply(inferenceStream(async (signal, output) => {
    if (query && search) output.searching();
    const sources = query && search ? normalizeSources((await search(query, signal, input.language)).filter(({ title, excerpt }) => !mentionsCreator(`${title}\n${excerpt ?? ''}`))) : undefined;
    if (sources) {
      output.sources(sources.map(({ title, url, provider, evidence }) => ({ title, url, provider, ...(evidence && { evidence }) })));
      if (sources.length === 0) {
        output.text(searchMessage('empty', input.language));
        return;
      }
    }
    const stop = new AbortController();
    const checked = checkedCreatorStream(output.text, () => stop.abort());
    const branded = brandedStream(checked.text);
    try {
      const context = { sources, task, report, project: task ? undefined : project,
        ...(preferences && !mentionsCreator(preferences) && { preferences }),
        clock: task ? undefined : contextualClock(prompt, input.timeZone, now), mode: input.mode, effort: input.effort, language: input.language };
      const cancellation = AbortSignal.any([signal, stop.signal]);
      if (local) await local(messages, cancellation, branded.text, context, output.localModel);
      else if (hosted) await hosted(messages, cancellation, branded.text, context, output.model);
      else await generate!(messages, cancellation, branded.text, context);
    } catch (error) {
      if (!stop.signal.aborted || signal.aborted) throw error;
    }
    branded.finish();
    checked.finish();
  }, request.signal, deadline === undefined ? undefined : deadline + (query ? 5_000 : 0)), 'server');
}

const searchMessages = {
  en: { offline: 'I can’t verify that here because live web search isn’t configured. Share a public source if you’d like me to help interpret it.', empty: 'I couldn’t find relevant web results. Try a more specific query or share a public source.' },
  es: { offline: 'No puedo verificarlo porque la búsqueda web no está disponible aquí. Puedes compartir una fuente pública.', empty: 'No encontré resultados relevantes. Prueba una consulta más específica o comparte una fuente pública.' },
  fr: { offline: 'Je ne peux pas le vérifier : la recherche web n’est pas disponible ici. Vous pouvez partager une source publique.', empty: 'Je n’ai pas trouvé de résultats pertinents. Précisez la recherche ou partagez une source publique.' },
  de: { offline: 'Ich kann das hier ohne Websuche nicht überprüfen. Du kannst eine öffentliche Quelle teilen.', empty: 'Ich habe keine passenden Ergebnisse gefunden. Suche genauer oder teile eine öffentliche Quelle.' },
  pt: { offline: 'Não posso verificar isso porque a busca na web não está disponível aqui. Você pode compartilhar uma fonte pública.', empty: 'Não encontrei resultados relevantes. Tente uma consulta mais específica ou compartilhe uma fonte pública.' },
};
const searchMessage = (key: 'offline' | 'empty', language?: ReplyLanguage) => searchMessages[language && language !== 'auto' ? language : 'en'][key];
