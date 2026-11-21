import type { ConnectionStatus, WorkspaceStatus } from '../../shared/workspace-tools.ts';

export class WorkspaceError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

function isConnection(value: unknown): value is ConnectionStatus {
  return value === 'unconfigured' || value === 'connected' || value === 'disconnected';
}

export async function getWorkspace(signal: AbortSignal): Promise<WorkspaceStatus> {
  const response = await fetch('/api/workspace', { signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]), cache: 'no-store' });
  if (!response.ok) throw new Error('Couldn’t check plugin availability.');
  const value = await response.json().catch(() => null);
  if (!isConnection(value?.connections?.gmail) || !isConnection(value?.connections?.vercel)) throw new Error('Couldn’t check plugin availability.');
  return { connections: { gmail: value.connections.gmail, vercel: value.connections.vercel }, hostedImages: value.hostedImages === true, hostedVision: value.hostedVision === true };
}

export async function approveTool<T>(payload: { action: string; [key: string]: unknown }, signal: AbortSignal): Promise<T> {
  const path = payload.action === 'vision' ? '/api/workspace?input=image' : '/api/workspace';
  const deadline = AbortSignal.timeout(payload.action === 'image' ? 85_000 : payload.action === 'vision' ? 45_000 : 20_000);
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, approved: true }), signal: AbortSignal.any([signal, deadline]), cache: 'no-store' });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw new WorkspaceError(typeof result?.error === 'string' ? result.error : 'The tool did not return a result.', response.status);
    return result;
  } catch (error) {
    if (signal.aborted || error instanceof WorkspaceError) throw error;
    throw new Error(deadline.aborted ? 'The request timed out. Try again.' : 'Couldn’t reach the plugin. Check your connection and try again.');
  }
}
