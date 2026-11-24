export const STANDARD_LOCAL_MODEL_IDS = ['helio-2', 'helio-3', 'helio-4'] as const;
export type StandardLocalModelId = typeof STANDARD_LOCAL_MODEL_IDS[number];
export const ADVANCED_LOCAL_MODEL_ID = 'helio-5';
export const LOCAL_MODEL_IDS = [...STANDARD_LOCAL_MODEL_IDS, ADVANCED_LOCAL_MODEL_ID] as const;
export type LocalModelId = typeof LOCAL_MODEL_IDS[number];
export const isLocalModelId = (value: unknown): value is LocalModelId => LOCAL_MODEL_IDS.some((id) => id === value);

export type LocalRunner = 'ollama' | 'llama.cpp';
export type LocalModel = { runner: LocalRunner; id: string };
export const isLocalRunner = (value: unknown): value is LocalRunner => value === 'ollama' || value === 'llama.cpp';

// Aliases are opaque names, not URLs or absolute paths. Don't return the
// daemon's file paths, launch arguments, host, or configuration to the client.
export const isLocalAlias = (id: unknown): id is string => typeof id === 'string' && /^[\w][\w .:/-]{0,159}$/.test(id) && id.trim() === id
  && !id.includes('://') && !/^[a-z]:\//i.test(id) && !id.split('/').some((part) => part === '.' || part === '..');

export function parseLocalModel(value: unknown): LocalModel | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const { runner, id } = value as Partial<LocalModel>;
  if (isLocalRunner(runner) && isLocalAlias(id)) return { runner, id };
}
