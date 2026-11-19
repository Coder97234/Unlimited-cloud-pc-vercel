import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { SYSTEM_PROMPT } from '../shared/models.ts';
import { hasExpectedSize, MODEL_WEIGHT, packagedWeightPath } from '../server/model-weights.ts';
import { planBundledQwenMemory } from '../server/qwen-memory.ts';

const contextSize = 3072;
const batchSize = 256;
const round = Math.round;
const mib = 1024 * 1024;
const arg = (key) => process.argv.slice(2).find((value) => value.startsWith(`${key}=`))?.split('=')[1];
const threads = Number(arg('--threads') ?? Math.min(2, availableParallelism()));
assert.ok(threads === 1 || threads === 2, 'Use --threads=1 or --threads=2');
const path = packagedWeightPath();
const variant = arg('--worker');

// Use separate Node processes and alternate the ordering to reduce bias from
// filesystem caching and host load. These are not cold Vercel invocations.
if (!variant) {
  const samples = Number(arg('--samples') ?? 3);
  assert.ok(Number.isInteger(samples) && samples > 0 && samples <= 10, 'Choose 1–10 samples');
  assert.ok(await hasExpectedSize(path, MODEL_WEIGHT), 'Run npm run build:models to stage the verified weights');
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
  };
  const runs = { simulated: [], planned: [] };
  for (let i = 0; i < samples; i++) {
    for (const mode of (i % 2 ? ['planned', 'simulated'] : ['simulated', 'planned'])) {
      const worker = spawnSync(process.execPath, [
        '--disable-warning=ExperimentalWarning', '--experimental-strip-types', import.meta.filename,
        `--threads=${threads}`, `--worker=${mode}`,
      ], { encoding: 'utf8', timeout: 90_000 });
      if (worker.stderr) process.stderr.write(worker.stderr);
      if (worker.error) throw worker.error;
      const line = worker.stdout.trim().split('\n').at(-1);
      assert.equal(worker.status, 0, `Measurement process failed: ${mode}\n${worker.stdout}`);
      const result = JSON.parse(line);
      runs[mode].push(result);
      console.log('XYVORA_QWEN run', JSON.stringify(result));
    }
  }
  const expected = runs.simulated[0].answers;
  for (const run of [...runs.simulated, ...runs.planned]) {
    assert.deepEqual(run.answers, expected, 'The startup plan must not change greedy replies or token counts');
  }
  for (const mode of ['simulated', 'planned']) {
    const select = (label, key) => median(runs[mode].map((run) => run[label][key]));
    console.log('XYVORA_QWEN median', JSON.stringify({ mode, samples, threads,
      importMs: median(runs[mode].map((run) => run.importMs)),
      backendMs: median(runs[mode].map((run) => run.backendMs)),
      loadMs: median(runs[mode].map((run) => run.loadMs)),
      contextMs: median(runs[mode].map((run) => run.contextMs)),
      coldFirstMs: select('fresh', 'firstFromStartupMs'), coldDoneMs: select('fresh', 'doneFromStartupMs'),
      warmFirstMs: select('warm', 'firstMs'), warmDoneMs: select('warm', 'doneMs'),
      prefillFirstMs: select('prefill', 'firstMs'), decodeTokensPerSec: select('decode', 'tokensPerSec'),
      peakRssMiB: median(runs[mode].map((run) => run.peakRssMiB)),
    }));
  }
  assert.ok(Math.min(...runs.planned.map((run) => run.modelEstimateMiB)) >= Math.max(...runs.simulated.map((run) => run.modelEstimateMiB)), 'Model reservation must cover the simulation');
  assert.ok(Math.min(...runs.planned.map((run) => run.contextEstimateMiB)) >= Math.max(...runs.simulated.map((run) => run.contextEstimateMiB)), 'Context reservation must cover the simulation');
} else {
  assert.ok(variant === 'simulated' || variant === 'planned');
  const started = performance.now();
  const native = await import('node-llama-cpp');
  const imported = performance.now();
  const backend = await native.getLlama({ gpu: false, build: 'never', skipDownload: true, maxThreads: threads, logLevel: native.LlamaLogLevel.error });
  if (variant === 'planned') await planBundledQwenMemory(native, backend, path);
  const initialized = performance.now();
  const model = await backend.loadModel({ modelPath: path, gpuLayers: 0, useMmap: true });
  const loaded = performance.now();
  const context = await model.createContext({ contextSize, batchSize, threads });
  try {
    const wrapper = new native.ChatMLChatWrapper();
    const system = { type: 'system', text: SYSTEM_PROMPT };
    const prefix = wrapper.generateContextState({ chatHistory: [system] }).contextText.tokenize(model.tokenizer);
    const sequence = context.getSequence();
    const ready = performance.now();
    const short = 'What is the capital of France? Answer in one short sentence.';
    const inventory = Array.from({ length: 32 }, (_, index) => `Record ${index + 1} | product: Sable notebook | stock: ${(index + 1) * 13} | status: verified`).join('\n');
    const result = { variant, threads, importMs: round(imported - started), backendMs: round(initialized - imported), loadMs: round(loaded - initialized), contextMs: round(ready - loaded), answers: {} };
    for (const [label, prompt, maxTokens] of [
      ['fresh', short, 32], ['warm', short, 32],
      ['decode', 'Give five practical tips for packing light for a weekend trip. Use a numbered list with one sentence per tip.', 96],
      ['prefill', `Use only these sample inventory records:\n${inventory}\nWhat is the stock for Record 24? Answer with only the number.`, 12],
    ]) {
      const history = [system, { type: 'user', text: prompt }, { type: 'model', response: [] }];
      const chat = new native.LlamaChat({ contextSequence: sequence, chatWrapper: wrapper });
      let first, last, text = '', tokens = 0;
      const start = performance.now();
      try {
        await chat.generateResponse(history, { temperature: 0, maxTokens, onToken: (part) => { tokens += part.length; },
          onTextChunk: (part) => { last = performance.now(); if (part.trim()) first ??= last; text += part; } });
      } finally { chat.dispose({ disposeSequence: false }); }
      await sequence.adaptStateToTokens(prefix, false);
      const done = performance.now();
      assert.deepEqual(sequence.contextTokens, prefix.slice(0, sequence.nextTokenIndex));
      assert.ok(first !== undefined && tokens > 0, `${label}: no text`);
      if (label === 'fresh' || label === 'warm') assert.match(text, /paris/i);
      result.answers[label] = { tokens, sha256: createHash('sha256').update(text).digest('hex') };
      result[label] = { firstMs: round(first - start), doneMs: round(done - start), streamMs: round(last - first),
        tokensPerSec: last > first ? round(1000 * (tokens - 1) / (last - first)) : null,
        ...(label === 'fresh' && { firstFromStartupMs: round(first - started), doneFromStartupMs: round(done - started) }),
      };
    }
    const modelMemory = await model.fileInsights.estimateModelResourceRequirementsV2({ gpuLayers: 0, useMmap: true });
    const contextMemory = await model.fileInsights.estimateContextResourceRequirementsV2({
      contextSize, batchSize, modelGpuLayers: 0, sequences: 1, flashAttention: context.flashAttention,
      kvCacheKeyType: native.GgmlType.F16, kvCacheValueType: native.GgmlType.F16,
    });
    result.modelEstimateMiB = Math.ceil(modelMemory.cpuRam / mib);
    result.contextEstimateMiB = Math.ceil(contextMemory.cpuRam / mib);
    result.peakRssMiB = round(process.resourceUsage().maxRSS / 1024);
    console.log(JSON.stringify(result));
  } finally { await context.dispose(); await model.dispose(); }
}
