import type { WorkspaceStatus } from '../../shared/workspace-tools.ts';

export async function getWorkspace(signal: AbortSignal): Promise<WorkspaceStatus> {
  const response = await fetch('/api/workspace', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('The plugin status service is unavailable.');
  return response.json();
}

export async function approveTool<T>(payload: object, signal: AbortSignal): Promise<T> {
  const response = await fetch('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, approved: true }), signal, cache: 'no-store' });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(typeof result?.error === 'string' ? result.error : 'The tool did not return a result.');
  return result;
}
