export const HOSTED_PROVIDERS = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini', compatible: 'Workspace endpoint' } as const;
export type HostedProvider = keyof typeof HOSTED_PROVIDERS;
export type HostedModel = { provider: HostedProvider; model: string };
export type ModelChoice = 'xyvora' | 'auto' | HostedProvider;
export const isHostedProvider = (value: unknown): value is HostedProvider => typeof value === 'string' && Object.hasOwn(HOSTED_PROVIDERS, value);
export const isModelChoice = (value: unknown): value is ModelChoice => value === 'xyvora' || value === 'auto' || isHostedProvider(value);
export function parseHostedModel(value: unknown): HostedModel | undefined {
  if (!value || typeof value !== 'object') return;
  const { provider, model } = value as Partial<HostedModel>;
  if (isHostedProvider(provider) && typeof model === 'string' && /^[\w.][\w./:-]{0,119}$/.test(model)) return { provider, model };
}
