export const MODELS = {
  qwen: {
    name: 'Qwen 3 32B', maker: 'Alibaba', tag: 'Versatile', color: 'violet',
    description: 'An all-rounder for ideas, explanations, and code.',
    gateway: 'alibaba/qwen-3-32b',
    weights: 'https://huggingface.co/Qwen/Qwen3-32B',
  },
  'gpt-oss': {
    name: 'GPT OSS 20B', maker: 'OpenAI', tag: 'Reasoning', color: 'mint',
    description: 'A reasoning model for harder questions and problem-solving.',
    gateway: 'openai/gpt-oss-20b',
    weights: 'https://huggingface.co/openai/gpt-oss-20b',
  },
  mistral: {
    name: 'Mistral Nemo', maker: 'Mistral AI', tag: 'Multilingual', color: 'peach',
    description: 'A quick, multilingual model for writing and everyday chat.',
    gateway: 'mistral/mistral-nemo',
    weights: 'https://huggingface.co/mistralai/Mistral-Nemo-Instruct-2407',
  },
  local: {
    name: 'Qwen On-device', maker: 'Alibaba', tag: 'On-device', color: 'sky',
    description: 'Qwen 2.5 0.5B runs in this browser. Requires WebGPU and a one-time model download.',
    gateway: null,
    weights: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct',
  },
} as const;

export type ModelId = keyof typeof MODELS;
export type HostedModelId = Exclude<ModelId, 'local'>;
export const HOSTED_MODELS = ['qwen', 'gpt-oss', 'mistral'] as const;
export const DEFAULT_MODEL = 'qwen';
export const isModelId = (value: unknown): value is ModelId =>
  typeof value === 'string' && Object.hasOwn(MODELS, value);
export const isHostedModel = (value: unknown): value is HostedModelId =>
  isModelId(value) && MODELS[value].gateway !== null;

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type Availability = 'hosted' | 'preview' | 'on-device';
export const MAX_PROMPT = 6_000;
export const MAX_ATTACHMENT = 8_000;
export const MAX_MESSAGE = 16_000;
export const MAX_CONTEXT = 24_000;
export const MAX_MESSAGES = 19;
export const SYSTEM_PROMPT = 'You are the assistant in Xyvora, an open-model chat workspace. Be helpful, clear, and honest about uncertainty. Answer in the user’s language and use Markdown when useful.';
