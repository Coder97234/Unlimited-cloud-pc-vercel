import { DEFAULT_EFFORT, EFFORTS } from '../shared/experience.ts';
import type { Effort } from '../shared/experience.ts';
import { ADVANCED_LOCAL_MODEL_ID, isLocalAlias, isLocalRunner, LOCAL_MODEL_IDS, STANDARD_LOCAL_MODEL_IDS } from '../shared/local-models.ts';
import type { LocalModel, LocalModelId, LocalRunner, StandardLocalModelId } from '../shared/local-models.ts';
import { generateHosted } from './hosted-models.ts';
import { InferenceError, localReplyTimeout } from './inference-stream.ts';
import type { RoutedGenerate } from './inference-stream.ts';
import { asObject, boundedJson } from './workspace-http.ts';

type Environment = Record<string, string | undefined>;
type InstalledModel = { id: string; strength: number; digest?: string; thinking?: unknown };
type Pools = Partial<Record<LocalModelId, InstalledModel[]>>;
type Overrides = Partial<Record<StandardLocalModelId, string[]>>;
type Pin = { id: string; digest: string };
type Target = { runner: LocalRunner; origin: string; key: string };
type RunnerOptions = { overrides?: Overrides; byteLimit?: number; maxTokens?: number; pin?: Pin; reserved?: Pin };
export type LocalModels = {
  available: () => Promise<LocalModelId[]>;
  resolve: (choice: LocalModelId) => Promise<RoutedGenerate<LocalModel> | undefined>;
};

const MAX_MODELS = 512;
const REFRESH_MS = 10_000;
// A guard against accidentally installing a lightweight tier here, not a
// quality score. Count actual runner-reported parameters (including MoE).
const ADVANCED_MIN_PARAMETERS = 20_000_000_000;
const digestOf = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined;
const positive = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
const remote = (entry: ReturnType<typeof asObject>) => !!entry.remote_model || !!entry.remote_host;
const includes = (value: unknown, flag: string | boolean) => Array.isArray(value) && value.includes(flag);
const readyStates = new Set(['unloaded', 'loaded', 'loading', 'sleeping', 'downloaded']);

function estimatedParameters(value: unknown) {
  if (typeof value !== 'string' || value.length > 160) return 0;
  const size = /(?:^|[-_: ])(\d{1,3}(?:\.\d{1,3})?)\s*([mb])(?=$|[\W_])/i.exec(value);
  return size ? Number(size[1]) * (size[2].toLowerCase() === 'b' ? 1e9 : 1e6) : 0;
}

function overridesFrom(raw: string): Overrides {
  if (raw.length > 96_000) throw new Error('Local model mapping is too large.');
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid local model mapping.');
  const slots: Overrides = {};
  const seen = new Set<string>();
  for (const [id, names] of Object.entries(parsed)) {
    const level = STANDARD_LOCAL_MODEL_IDS.find((choice) => choice === id);
    if (!level || !Array.isArray(names) || names.length > MAX_MODELS) throw new Error('Invalid standard Helio level.');
    slots[level] = names.map((name: unknown) => {
      if (!isLocalAlias(name) || seen.has(name) || seen.size >= MAX_MODELS) throw new Error('Invalid or duplicate local model alias.');
      seen.add(name);
      return name;
    });
  }
  return slots;
}

function group(models: InstalledModel[], overrides?: Overrides): Pools {
  const pools: Pools = {};
  const ids = new Set<string>(), digests = new Set<string>();
  function unique(model: InstalledModel) {
    if (ids.has(model.id) || model.digest && digests.has(model.digest)) return false;
    ids.add(model.id);
    if (model.digest) digests.add(model.digest);
    return true;
  }
  function add(choice: LocalModelId, model: InstalledModel) { (pools[choice] ??= []).push(model); }
  if (overrides) {
    const lookup = new Map(models.map((model) => [model.id, model]));
    for (const choice of STANDARD_LOCAL_MODEL_IDS) for (const id of overrides[choice] ?? []) {
      const model = lookup.get(id);
      if (model && unique(model)) add(choice, model);
    }
  } else {
    const ordered = models.sort((a, b) => a.strength - b.strength || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).filter(unique);
    const tiers = Math.min(STANDARD_LOCAL_MODEL_IDS.length, ordered.length);
    ordered.forEach((model, index) => add(STANDARD_LOCAL_MODEL_IDS[Math.floor(index * tiers / ordered.length)], model));
  }
  return pools;
}

function runnerTarget(env: Environment, runner: LocalRunner, prefix: 'XYVORA_LOCAL' | 'XYVORA_HELIO5', defaultPort: string): Target | undefined {
  const key = env[`${prefix}_KEY`]?.trim() ?? '';
  if (!/^[\x21-\x7e]{0,512}$/.test(key)) return;
  const gateway = env[`${prefix}_GATEWAY_URL`];
  const port = env[`${prefix}_PORT`];
  if (gateway) {
    // Only an operator-owned, authenticated TLS gateway. Neither the model ID
    // nor anything in the chat controls the destination or paths.
    if (key.length < 32 || port) return;
    try {
      const url = new URL(gateway);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port && url.href === url.origin + '/'
        && /^([a-z0-9-]+\.)+[a-z][a-z0-9-]+$/.test(url.hostname) && !/\.(localhost|local|internal|lan|test|invalid)$/.test(url.hostname)) {
        return { runner, origin: url.origin, key };
      }
    } catch { /* Invalid origin. */ }
    return;
  }
  if (env.VERCEL === '1' || env.VERCEL_ENV) return;
  const loopback = port || defaultPort;
  if (/^\d{1,5}$/.test(loopback) && Number(loopback) > 0 && Number(loopback) <= 65_535) return { runner, origin: `http://127.0.0.1:${Number(loopback)}`, key };
}

function standardOptions(env: Environment, runner: LocalRunner, reserved?: Pin): RunnerOptions | undefined {
  let overrides: Overrides | undefined;
  try { if (env.XYVORA_LOCAL_TIERS?.trim()) overrides = overridesFrom(env.XYVORA_LOCAL_TIERS); }
  catch { return; }
  const byteLimit = Number(env.XYVORA_LOCAL_MAX_MODEL_BYTES || 0);
  if (!Number.isSafeInteger(byteLimit) || byteLimit < 0 || byteLimit && runner !== 'ollama') return;
  const maxTokens = Number(env.XYVORA_LOCAL_MAX_TOKENS || 0);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 0 || maxTokens > EFFORTS.max.hosted) return;
  return { overrides, byteLimit, maxTokens: maxTokens || undefined, reserved };
}

// Preserve an Effort gradient with a small CPU-friendly reply ceiling.
const tokenShare = { low: 0.4, medium: 0.55, high: 0.7, extra: 0.85, max: 1 } satisfies Record<Effort, number>;
const thinkingLevels = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const preferredThinking = { low: 'low', medium: 'medium', high: 'high', extra: 'xhigh', max: 'max' } satisfies Record<Effort, typeof thinkingLevels[number]>;
function localReasoning(effort: Effort, values: unknown) {
  // Send only a level advertised by this installed model. Boolean-only and
  // older models keep their runner default unless they explicitly allow off.
  if (effort === 'low' && includes(values, false)) return { effort: 'none', tokens: 0 };
  const supported = thinkingLevels.filter((level) => includes(values, level));
  const requested = thinkingLevels.indexOf(preferredThinking[effort]);
  const level = supported.findLast((candidate) => thinkingLevels.indexOf(candidate) <= requested) ?? supported[0];
  return { effort: level, tokens: EFFORTS[effort].thinking };
}

export function localModelsFrom(env: Environment, requestFetch: typeof fetch = fetch, now = Date.now): LocalModels | undefined {
  const id = env.XYVORA_HELIO5_MODEL?.trim();
  const digest = digestOf(env.XYVORA_HELIO5_DIGEST?.trim());
  const pin = isLocalAlias(id) && digest ? { id, digest } : undefined;
  const advancedTarget = pin && runnerTarget(env, 'ollama', 'XYVORA_HELIO5', '11435');
  const runner = env.XYVORA_LOCAL_RUNNER;
  const standardTarget = isLocalRunner(runner) && runnerTarget(env, runner, 'XYVORA_LOCAL', runner === 'ollama' ? '11434' : '8080');
  const options = standardTarget && standardOptions(env, standardTarget.runner, advancedTarget ? pin : undefined);
  // Keep the existing per-process limit even when the endpoints are different.
  const capacity = { active: false };
  const standard = standardTarget && options ? modelsOn(standardTarget, options, capacity, requestFetch, now) : undefined;
  const advanced = advancedTarget && pin ? modelsOn(advancedTarget, { pin }, capacity, requestFetch, now) : undefined;
  if (!standard && !advanced) return;
  return {
    async available() {
      const [base, top] = await Promise.all([standard?.available(), advanced?.available()]);
      return [...(base ?? []), ...(top ?? [])];
    },
    async resolve(choice) { return (choice === ADVANCED_LOCAL_MODEL_ID ? advanced : standard)?.resolve(choice); },
  };
}

function modelsOn({ origin, runner, key }: Target, { overrides, byteLimit = 0, maxTokens, pin, reserved }: RunnerOptions,
  capacity: { active: boolean }, requestFetch: typeof fetch, now: () => number): LocalModels {
  const turns = new Map<LocalModelId, number>();
  let cached: Pools = {}, expires = 0, refresh: Promise<Pools> | undefined;

  async function json(path: '/api/status' | '/api/tags' | '/api/show' | '/models', signal: AbortSignal, model?: string) {
    const headers = new Headers({ Accept: 'application/json' });
    if (key) headers.set('Authorization', `Bearer ${key}`);
    if (model) headers.set('Content-Type', 'application/json');
    const response = await requestFetch(origin + path, { redirect: 'error', cache: 'no-store', signal, headers,
      ...(model && { method: 'POST', body: JSON.stringify({ model, verbose: false }) }),
    });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('The local runner did not return model metadata.');
    }
    return asObject(await boundedJson(response, 1_048_576));
  }

  async function verifyOllama(signal: AbortSignal) {
    const status = await json('/api/status', signal);
    if (asObject(status.cloud).disabled !== true) throw new Error('Ollama cloud mode must be off.');
  }

  async function discover(signal: AbortSignal = AbortSignal.timeout(4_000)) {
    const found: InstalledModel[] = [];
    if (runner === 'ollama') {
      await verifyOllama(signal);
      const { models } = await json('/api/tags', signal);
      if (!Array.isArray(models) || models.length > MAX_MODELS) return found;
      for (let offset = 0; offset < models.length && !signal.aborted; offset += 8) {
        await Promise.all(models.slice(offset, offset + 8).map(async (raw: unknown) => {
          const entry = asObject(raw);
          const id = entry.model ?? entry.name;
          const bytes = positive(entry.size);
          // Weightless tags, remote aliases, and embedding-only models never
          // join the pool. Ask for capabilities when /api/tags omits them.
          if (!isLocalAlias(id) || !bytes || byteLimit && bytes > byteLimit || remote(entry) || /(?:-cloud(?=:|$)|:cloud(?:-|$))/i.test(id)) return;
          const digest = digestOf(entry.digest);
          if (pin && (pin.id !== id || pin.digest !== digest) || reserved && (reserved.id === id || reserved.digest === digest)) return;
          if (overrides && !STANDARD_LOCAL_MODEL_IDS.some((choice) => overrides[choice]?.includes(id))) return;
          try {
            const details = !pin && Array.isArray(entry.capabilities) ? entry : await json('/api/show', signal, id);
            if (remote(details) || !includes(details.capabilities, 'completion')) return;
            const parameters = positive(asObject(details.model_info)['general.parameter_count']);
            const thinking = pin ? asObject(details.thinking).values : undefined;
            if (pin && (parameters < ADVANCED_MIN_PARAMETERS || !includes(details.capabilities, 'thinking')
              || Array.isArray(thinking) && !includes(thinking, true) && !thinkingLevels.some((level) => includes(thinking, level)))) return;
            const strength = parameters || estimatedParameters(asObject(entry.details).parameter_size) || estimatedParameters(id) || bytes * 2;
            found.push({ id, strength, digest, thinking });
          } catch { /* Do not advertise an unverified model. */ }
        }));
      }
    } else {
      const { data } = await json('/models', signal);
      if (!Array.isArray(data) || data.length > MAX_MODELS) return found;
      for (const raw of data) {
        const entry = asObject(raw), architecture = asObject(entry.architecture), status = asObject(entry.status), meta = asObject(entry.meta);
        // Only completed local files in the dedicated directory or cache. A
        // preset can point at a download; don't implicitly activate presets.
        if (!isLocalAlias(entry.id) || entry.id === reserved?.id || (entry.source !== 'models_dir' && entry.source !== 'cache') || typeof status.value !== 'string' || !readyStates.has(status.value)
          || status.failed === true || remote(entry) || !includes(architecture.input_modalities, 'text') || !includes(architecture.output_modalities, 'text')
          || ['--embedding', '--embeddings', '--reranking', '--rerank'].some((arg) => includes(status.args, arg))) continue;
        found.push({ id: entry.id, strength: positive(meta.n_params) || estimatedParameters(entry.id) || positive(meta.size) * 2 });
      }
    }
    return found;
  }

  function snapshot(): Promise<Pools> {
    if (now() < expires) return Promise.resolve(cached);
    return refresh ??= discover().then((models): Pools => pin ? { [ADVANCED_LOCAL_MODEL_ID]: models.slice(0, 1) } : group(models, overrides)).catch((): Pools => ({})).then((pools) => {
      cached = pools; expires = now() + REFRESH_MS; return pools;
    }).finally(() => { refresh = undefined; });
  }

  return {
    async available() { const pools = await snapshot(); return LOCAL_MODEL_IDS.filter((choice) => !!pools[choice]?.length); },
    async resolve(choice) {
      const pool = (await snapshot())[choice];
      if (!pool?.length) return;
      return async (messages, signal, write, evidence, chosen) => {
        if (capacity.active) throw new InferenceError('The local models are busy. Wait a moment and try again.');
        capacity.active = true;
        try {
          signal.throwIfAborted();
          let installed: InstalledModel | undefined;
          if (pin) {
            // A cached inventory is good for the selector, but never send a
            // prompt to an alias whose pinned manifest or capabilities changed.
            const current = await discover(AbortSignal.any([signal, AbortSignal.timeout(4_000)]))
              .catch((): InstalledModel[] => []);
            signal.throwIfAborted();
            installed = current[0];
            if (!installed) throw new InferenceError('The pinned Helio 5 model is unavailable. Check the reasoning runner or choose another Helio model.');
          } else {
            if (runner === 'ollama') {
              try { await verifyOllama(AbortSignal.any([signal, AbortSignal.timeout(2_000)])); }
              catch { signal.throwIfAborted(); throw new InferenceError('The local Ollama runner is unavailable or cloud mode is enabled.'); }
            }
            const next = (turns.get(choice) ?? 0) % pool.length;
            turns.set(choice, (next + 1) % pool.length);
            installed = pool[next];
          }
          const model = installed.id;
          const effort = evidence.effort ?? DEFAULT_EFFORT;
          const reasoning = pin ? localReasoning(evidence.task ? 'low' : effort, installed.thinking) : undefined;
          const tokenLimit = maxTokens && Math.max(1, Math.floor(maxTokens * tokenShare[effort]));
          let started = false;
          // Exactly one installed model per turn. No other endpoint tries.
          await generateHosted({ provider: 'compatible', local: true, model, url: origin + '/v1/chat/completions', key, localReasoning: reasoning, localTokenLimit: tokenLimit }, messages, signal, (text) => {
            if (!started && !text.trim()) return;
            if (!started) { started = true; chosen({ runner, id: model }); }
            write(text);
          }, evidence, requestFetch, localReplyTimeout(evidence.effort));
        } catch (error) {
          if (!signal.aborted) expires = 0;
          throw error;
        } finally { capacity.active = false; }
      };
    },
  };
}
