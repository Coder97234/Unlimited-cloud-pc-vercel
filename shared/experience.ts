import type { ModelVariant } from './hosted-models.ts';
import { DEFAULT_MODEL } from './models.ts';
import { ADVANCED_LOCAL_MODEL_ID, isLocalModelId } from './local-models.ts';
import type { LocalModelId } from './local-models.ts';

export const EFFORTS = {
  low: { label: 'Low', native: 96, hosted: 260, timeout: 22_000, thinking: 0, hint: 'Give the direct answer briefly.' },
  medium: { label: 'Medium', native: 384, hosted: 950, timeout: 38_000, thinking: 128, hint: '' },
  high: { label: 'High', native: 512, hosted: 1_450, timeout: 58_000, thinking: 384, hint: 'Check key assumptions before giving the answer.' },
  extra: { label: 'Extra', native: 640, hosted: 2_300, timeout: 78_000, thinking: 1_024, hint: 'Check assumptions and briefly explain how to verify the result.' },
  max: { label: 'Max', native: 768, hosted: 3_600, timeout: 105_000, thinking: 2_048, hint: 'Check your conclusion against the evidence, note important caveats, and give a well-supported answer.' },
} as const;
export type Effort = keyof typeof EFFORTS;
export const EFFORT_IDS = Object.keys(EFFORTS) as Effort[];
export const DEFAULT_EFFORT: Effort = 'medium';
export const isEffort = (value: unknown): value is Effort => typeof value === 'string' && Object.hasOwn(EFFORTS, value);

export const LANGUAGES = {
  en: { name: 'English', locale: 'en-US' }, es: { name: 'Español', locale: 'es-ES' }, fr: { name: 'Français', locale: 'fr-FR' },
  de: { name: 'Deutsch', locale: 'de-DE' }, pt: { name: 'Português', locale: 'pt-BR' },
} as const;
export type Language = keyof typeof LANGUAGES;
export type ReplyLanguage = Language | 'auto';
export const isLanguage = (value: unknown): value is Language => typeof value === 'string' && Object.hasOwn(LANGUAGES, value);
export type LanguagePreference = ReplyLanguage | 'interface';
export const isReplyLanguage = (value: unknown): value is ReplyLanguage => value === 'auto' || isLanguage(value);

export function replyGuidance(effort?: Effort, language?: ReplyLanguage) {
  return [effort && EFFORTS[effort].hint, language === 'auto' ? 'Reply in the language of the latest user message unless the user asks for a translation.'
    : language && `Default reply language: ${LANGUAGES[language].name}. Write in this language unless this is a translation task.`].filter(Boolean).join(' ');
}

// Keep the archive keys stable. The API accepts only these public aliases
// from the composer; engine names are resolved by the server.
export const MODEL_TIERS = {
  advanced: { name: 'Helio 5', detail: 'Advanced reasoning', choice: ADVANCED_LOCAL_MODEL_ID },
  apex: { name: 'Helio 4', detail: 'Complex tasks', choice: 'helio-4' },
  studio: { name: 'Helio 3', detail: 'Higher capability', choice: 'helio-3' },
  core: { name: 'Helio 2', detail: 'Balanced capability', choice: 'helio-2' },
  quick: { name: 'Helio 1', detail: 'Lightweight', choice: DEFAULT_MODEL },
} as const;
export type ModelTier = keyof typeof MODEL_TIERS;
export type HelioModelId = typeof DEFAULT_MODEL | LocalModelId;
export const MODEL_TIERS_ORDER = Object.keys(MODEL_TIERS) as ModelTier[];
export const isHelioModelId = (value: unknown): value is HelioModelId => value === DEFAULT_MODEL || isLocalModelId(value);
export const isModelTier = (value: unknown): value is ModelTier => typeof value === 'string' && Object.hasOwn(MODEL_TIERS, value);
const tierForRank = { 1: 'quick', 2: 'core', 3: 'studio', 4: 'apex' } as const;
// Earlier saved catalog replies can reopen at their original Helio level.
export const variantTier = ({ version }: ModelVariant): ModelTier => tierForRank[Number(version[0]) as keyof typeof tierForRank] ?? 'quick';
const LOCAL_MODEL_TIERS = { 'helio-2': 'core', 'helio-3': 'studio', 'helio-4': 'apex', [ADVANCED_LOCAL_MODEL_ID]: 'advanced' } satisfies Record<LocalModelId, ModelTier>;
export const choiceTier = (model: LocalModelId): ModelTier => LOCAL_MODEL_TIERS[model];
export type RankedModel = { tier: ModelTier; name: string; detail: string; available: boolean; choice: HelioModelId };
export const rankedModels = (available: readonly HelioModelId[]): RankedModel[] => MODEL_TIERS_ORDER.map((tier) => ({
  tier, ...MODEL_TIERS[tier], available: available.includes(MODEL_TIERS[tier].choice),
}));
