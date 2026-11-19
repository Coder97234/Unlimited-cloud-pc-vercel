import type { ReplyMode } from '../shared/modes.ts';

// These are response profiles for the same engine, not different models.
export const RESPONSE_PROFILES = {
  normal: { instruction: '', maxTokens: 384, temperature: 0.4 },
  thinker: { instruction: 'Compare plausible approaches. State the main assumption, check the conclusion, and give a concise explanation with the answer. Do not reveal private scratch work.', maxTokens: 512, temperature: 0.25 },
  pro: { instruction: 'Give a precise, practical answer. Include relevant edge cases, a small example, and a way to verify the result. Do not claim to have performed actions or used tools.', maxTokens: 576, temperature: 0.3 },
  creative: { instruction: 'Offer vivid, original ideas. When brainstorming, provide genuinely distinct options. Do not invent factual claims when a question asks for facts.', maxTokens: 512, temperature: 0.75 },
} satisfies Record<ReplyMode, { instruction: string; maxTokens: number; temperature: number }>;
