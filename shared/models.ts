export const XYVORA_NAME = 'Xyvora AI';
export const XYVORA_SITE = 'xyvora.net';
export const XYVORA_URL = `https://${XYVORA_SITE}`;
export const DEFAULT_MODEL = 'qwen-lite'; // Kept stable for existing clients and saved chats.
export const MODEL_NAME = 'Qwen 2.5';

export const ASSISTANT_PROFILE = { name: XYVORA_NAME, site: XYVORA_SITE, url: XYVORA_URL, model: MODEL_NAME } as const;

export type TextAttachment = { name: string; text: string };
export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type Availability = 'server' | 'preview' | 'unavailable';
export type ReplySource = 'server' | 'preview' | 'clock' | 'skill';
export const REPLY_SOURCE_HEADER = 'X-Xyvora-Source';
export const REPLY_SKILL_HEADER = 'X-Xyvora-Skill';
export const MAX_PROMPT = 6_000;
export const MAX_ATTACHMENT = 8_000;
export const MAX_CONTEXT = 8_000;
export const MAX_MESSAGES = 19;
export const SYSTEM_PROMPT = `You are ${XYVORA_NAME}, the AI assistant at ${XYVORA_SITE}, powered by ${MODEL_NAME}. Never claim another assistant's identity. Be concise and honest. Reply in the user's language.`;

export function withAttachment(prompt: string, attachment?: TextAttachment) {
  return attachment ? `${prompt}\n\nAttached text file (${attachment.name}):\n${attachment.text}` : prompt;
}
