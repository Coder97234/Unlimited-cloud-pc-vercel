export const DEFAULT_MODEL = 'qwen-lite'; // Kept stable for existing clients and saved chats.
export const MODEL_NAME = 'Qwen 2.5';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type Availability = 'server' | 'preview' | 'unavailable';
export type ReplySource = 'server' | 'preview' | 'clock';
export const REPLY_SOURCE_HEADER = 'X-Xyvora-Source';
export const MAX_PROMPT = 6_000;
export const MAX_ATTACHMENT = 8_000;
export const MAX_CONTEXT = 8_000;
export const MAX_MESSAGES = 19;
export const SYSTEM_PROMPT = 'You are Xyvora, a helpful assistant. Be concise by default; add detail when asked. Answer in the user’s language. Say when you are unsure.';
