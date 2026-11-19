export const MODELS = {
  'qwen-lite': {
    name: 'Qwen 2.5 Lite', maker: 'Alibaba', tag: 'Server', color: 'violet',
    description: 'A small, multilingual model for short questions and everyday chat.',
    gateway: null,
    weights: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct',
  },
  smollm: {
    name: 'SmolLM2 360M', maker: 'Hugging Face', tag: 'Server', color: 'sky',
    description: 'A lightweight English model for simple writing and explanations.',
    gateway: null,
    weights: 'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct',
  },
  qwen: {
    name: 'Qwen 3 32B', maker: 'Alibaba', tag: 'Gateway', color: 'violet',
    description: 'An all-rounder for ideas, explanations, and code.',
    gateway: 'alibaba/qwen-3-32b',
    weights: 'https://huggingface.co/Qwen/Qwen3-32B',
  },
  'gpt-oss': {
    name: 'GPT OSS 20B', maker: 'OpenAI', tag: 'Gateway', color: 'mint',
    description: 'A reasoning model for harder questions and problem-solving.',
    gateway: 'openai/gpt-oss-20b',
    weights: 'https://huggingface.co/openai/gpt-oss-20b',
  },
  mistral: {
    name: 'Mistral Nemo', maker: 'Mistral AI', tag: 'Gateway', color: 'peach',
    description: 'A quick, multilingual model for writing and everyday chat.',
    gateway: 'mistral/mistral-nemo',
    weights: 'https://huggingface.co/mistralai/Mistral-Nemo-Instruct-2407',
  },
} as const;

export type ModelId = keyof typeof MODELS;
export const SERVER_MODELS = ['qwen-lite', 'smollm'] as const;
export type ServerModelId = (typeof SERVER_MODELS)[number];
export const GATEWAY_MODELS = ['qwen', 'gpt-oss', 'mistral'] as const;
export const DEFAULT_MODEL = 'qwen-lite';
export const isModelId = (value: unknown): value is ModelId =>
  typeof value === 'string' && Object.hasOwn(MODELS, value);
export const isServerModel = (value: ModelId): value is ServerModelId => MODELS[value].gateway === null;

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type Availability = 'server' | 'preview' | 'unavailable';
export type ReplySource = 'server' | 'hosted' | 'preview';
export const REPLY_SOURCE_HEADER = 'X-Xyvora-Source';
export const MAX_PROMPT = 6_000;
export const MAX_ATTACHMENT = 8_000;
export const MAX_MESSAGE = 16_000;
export const MAX_CONTEXT = 24_000;
export const MAX_SERVER_CONTEXT = 8_000;
export const MAX_MESSAGES = 19;
export const SYSTEM_PROMPT = 'You are the assistant in Xyvora, an open-model chat workspace. Be helpful, clear, and honest about uncertainty. Answer in the user’s language and use Markdown when useful.';
