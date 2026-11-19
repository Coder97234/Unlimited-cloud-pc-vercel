import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GgufFileInfo, GgufInsights, Llama } from 'node-llama-cpp';
import { planBundledQwenMemory } from '../server/qwen-memory.ts';

const path = '/var/task/build/models/qwen-lite.gguf';
const MIB = 1024 * 1024;
const f16 = 1;
const modelOptions = { gpuLayers: 0, useMmap: true };
const contextOptions = { contextSize: 3072, modelGpuLayers: 0, batchSize: 256, sequences: 1,
  flashAttention: 'auto' as const, kvCacheKeyType: f16, kvCacheValueType: f16 };

function fixture(version = '3.22.3', modelSize = 337 * MIB) {
  const simulated = { cpuRam: 1, gpuVram: 0 };
  const native = {
    GgmlType: { F16: f16 },
    getModuleVersion: async () => version,
    GgufInsights: {
      from: async (_file: GgufFileInfo, _backend?: Llama) => ({
        modelSize,
        estimateModelResourceRequirements: () => ({ cpuRam: modelSize, gpuVram: 0 }),
        estimateContextResourceRequirements: () => ({ cpuRam: 32 * MIB, gpuVram: 0 }),
        estimateModelResourceRequirementsV2: async () => simulated,
        estimateContextResourceRequirementsV2: async () => simulated,
      } as unknown as GgufInsights),
    },
  } as unknown as Parameters<typeof planBundledQwenMemory>[0];
  const backend = { gpu: false } as Llama;
  const info = (file = path) => ({ source: { type: 'path', path: file }, metadata: { general: { architecture: 'qwen2' } } } as GgufFileInfo);
  return { native, backend, info, simulated };
}

test('the bundled CPU model uses conservative reservations only for the measured configuration', async () => {
  const { native, backend, info, simulated } = fixture();
  await planBundledQwenMemory(native, backend, path);
  const model = await native.GgufInsights.from(info(), backend);
  assert.deepEqual(await model.estimateModelResourceRequirementsV2(modelOptions), { cpuRam: 512 * MIB, gpuVram: 0 });
  assert.deepEqual(await model.estimateContextResourceRequirementsV2(contextOptions), { cpuRam: 128 * MIB, gpuVram: 0 });
  assert.equal(await model.estimateModelResourceRequirementsV2({ ...modelOptions, useMmap: false }), simulated);
  assert.equal(await model.estimateContextResourceRequirementsV2({ ...contextOptions, contextSize: 4096 }), simulated);
  assert.equal(await model.estimateContextResourceRequirementsV2({ ...contextOptions, sequences: 2 }), simulated);
  assert.equal(await model.estimateContextResourceRequirementsV2({ ...contextOptions, batchSize: 512 }), simulated);
});

test('other weights, backend instances, architectures and library versions keep native simulation', async () => {
  for (const [version, size] of [['3.22.3', 337], ['3.22.3', 500], ['3.22.4', 337]] as const) {
    const { native, backend, info, simulated } = fixture(version, size * MIB);
    await planBundledQwenMemory(native, backend, path);
    for (const [file, instance] of [
      [info('/tmp/qwen.gguf'), backend],
      [info(), { gpu: false } as Llama],
      [{ ...info(), metadata: { general: { architecture: 'llama' } } } as GgufFileInfo, backend],
      ...(version !== '3.22.3' || size > 384 ? [[info(), backend] as const] : []),
    ] as const) {
      const model = await native.GgufInsights.from(file, instance);
      assert.equal(await model.estimateModelResourceRequirementsV2(modelOptions), simulated);
      assert.equal(await model.estimateContextResourceRequirementsV2(contextOptions), simulated);
    }
  }
});
