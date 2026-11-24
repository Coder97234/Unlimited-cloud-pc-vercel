import { wellFormedText } from './stored-text.ts';

export const HOSTED_PROVIDERS = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini', compatible: 'Workspace endpoint' } as const;
export type HostedProvider = keyof typeof HOSTED_PROVIDERS;
// Variant metadata is read-only history compatibility. It is no longer a
// model selection or a routable ID.
export type ModelVariant = { id: string; version: string; label: string };
export type HostedModel = { provider: HostedProvider; model: string; variant?: ModelVariant };
export type ModelChoice = 'xyvora' | 'auto' | HostedProvider;

export const isHostedProvider = (value: unknown): value is HostedProvider => typeof value === 'string' && Object.hasOwn(HOSTED_PROVIDERS, value);
export const isModelChoice = (value: unknown): value is ModelChoice => value === 'xyvora' || value === 'auto' || isHostedProvider(value);
const isVariantId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,55}$/.test(value);
export const variantName = ({ version, label }: ModelVariant) => `Helio ${version} · ${label}`;

export function parseModelVariant(value: unknown): ModelVariant | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const { id, version, label } = value as Partial<ModelVariant>;
  if (isVariantId(id) && typeof version === 'string' && /^[1-4]\.[1-9]\d{0,2}$/.test(version)
      && typeof label === 'string' && label.length <= 80 && label.trim() && !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(label)) {
    return { id, version, label: wellFormedText(label.trim()) };
  }
}

export function parseHostedModel(value: unknown): HostedModel | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const { provider, model, variant: rawVariant } = value as Partial<HostedModel>;
  const variant = rawVariant === undefined ? undefined : parseModelVariant(rawVariant);
  if (rawVariant !== undefined && !variant) return;
  if (isHostedProvider(provider) && typeof model === 'string' && /^[\w.][\w./:-]{0,119}$/.test(model)
      && !model.includes('://') && !model.split('/').some((part) => part === '.' || part === '..')) return { provider, model, ...(variant && { variant }) };
}
