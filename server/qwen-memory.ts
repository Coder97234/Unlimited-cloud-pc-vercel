import type { GgufInsights, Llama } from 'node-llama-cpp';

const MIB = 1024 * 1024;
const PINNED_BACKEND = '3.22.3';
type Native = Pick<typeof import('node-llama-cpp'), 'GgufInsights' | 'GgmlType' | 'getModuleVersion'>;

// 3.22.3 loads a second model (including its tokenizer) to simulate memory
// usage, then simulates our fixed context as well. For our verified, small CPU
// bundle we can give the allocator conservative estimates instead. Keep its
// RAM check, reservations, and tracking of actual allocations enabled.
export async function planBundledQwenMemory(native: Native, backend: Llama, weightPath: string) {
  if (backend.gpu !== false || await native.getModuleVersion().catch(() => null) !== PINNED_BACKEND) return;
  const factory = native.GgufInsights;
  const from = factory.from;
  factory.from = async (fileInfo, llama) => {
    const insights = await from(fileInfo, llama);
    if (llama === backend && fileInfo.source?.type === 'path' && fileInfo.source.path === weightPath
      && fileInfo.metadata.general.architecture === 'qwen2' && insights.modelSize <= 384 * MIB) {
      useCpuEstimates(insights, native.GgmlType.F16);
    }
    return insights;
  };
}

function useCpuEstimates(insights: GgufInsights, f16: number) {
  const modelEstimate = insights.estimateModelResourceRequirementsV2.bind(insights);
  insights.estimateModelResourceRequirementsV2 = async (options) => {
    if (options.gpuLayers !== 0 || options.useMmap !== true) return modelEstimate(options);
    const { cpuRam, gpuVram } = insights.estimateModelResourceRequirements(options);
    return { cpuRam: Math.max(cpuRam, 512 * MIB), gpuVram };
  };

  const contextEstimate = insights.estimateContextResourceRequirementsV2.bind(insights);
  insights.estimateContextResourceRequirementsV2 = async (options) => {
    if (options.modelGpuLayers !== 0 || options.contextSize !== 3072 || options.batchSize !== 256
      || options.sequences !== 1 || options.isEmbeddingContext || options.swaFullCache
      || options.flashAttention !== 'auto' || options.useMmap === false
      || options.kvCacheKeyType !== f16 || options.kvCacheValueType !== f16) return contextEstimate(options);
    const { cpuRam, gpuVram } = insights.estimateContextResourceRequirements({ ...options, flashAttention: false });
    return { cpuRam: Math.max(cpuRam, 128 * MIB), gpuVram };
  };
}
