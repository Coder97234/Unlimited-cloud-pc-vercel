import { isProvider, publicApiTarget, WORKSPACE_PLUGINS_ENABLED } from '../shared/workspace-tools.ts';
import type { WorkspaceStatus } from '../shared/workspace-tools.ts';
import { MAX_VISION_BASE64 } from '../shared/media.ts';
import { readRepository } from './repositories.ts';
import { runImage, runVision } from './media.ts';
import { clearConnection, connectionStatus, disconnect, finishConnection, readConnection, startConnection, workspaceConfig } from './workspace-connections.ts';
import type { WorkspaceConfig } from './workspace-connections.ts';
import { asObject, boundedJson, providerJson, shortText, ToolError } from './workspace-http.ts';

const windowSize = 60_000;
let until = 0;
const hits = new Map<string, number>();
function rateCheck(request: Request, lane: 'tool' | 'image') {
  const now = Date.now();
  if (now >= until) { hits.clear(); until = now + windowSize; }
  const key = `${lane}:${request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) || 'unknown'}`;
  const global = `${lane}:all`;
  const current = hits.get(key) ?? 0, total = hits.get(global) ?? 0;
  if (current >= (lane === 'image' ? 2 : 12) || total >= (lane === 'image' ? 4 : 80)) throw new ToolError('Too many requests. Try again in a minute.', 429);
  hits.set(key, current + 1);
  hits.set(global, total + 1);
}

async function runPublicApi(target: unknown, signal: AbortSignal) {
  const spec = typeof target === 'string' ? publicApiTarget(target.trim()) : undefined;
  if (!spec) throw new ToolError('Use a supported GitHub or npm HTTPS endpoint. This is not a general URL proxy.');
  const data = await providerJson(spec.endpoint, signal, { headers: { 'User-Agent': 'Xyvora-API-Explorer' } });
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const result = spec.type === 'npm'
    ? { name: shortText(data.name, 150), version: shortText(data.version, 40), description: shortText(data.description, 550), license: shortText(data.license, 100) }
    : spec.type === 'release'
    ? { name: shortText(data.name), tag: shortText(data.tag_name), publishedAt: shortText(data.published_at, 32), prerelease: data.prerelease === true }
    : { name: shortText(data.full_name), description: shortText(data.description, 550), stars: number(data.stargazers_count), forks: number(data.forks_count),
      openIssues: number(data.open_issues_count), language: shortText(data.language, 80), defaultBranch: shortText(data.default_branch, 120), archived: data.archived === true };
  return { endpoint: spec.endpoint, data: result };
}

export async function handleWorkspace(request: Request, config?: WorkspaceConfig, options?: { limit?: boolean }) {
  if (!WORKSPACE_PLUGINS_ENABLED) {
    return Response.json({ error: 'Workspace plugins are paused.' }, {
      status: 404,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' },
    });
  }
  return handleWorkspaceTools(request, config, options);
}

// Kept independently testable while the public route is paused.
export async function handleWorkspaceTools(request: Request, config: WorkspaceConfig = workspaceConfig(process.env), { limit = true } = {}) {
  const url = new URL(request.url);
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  const json = (value: object, status = 200) => Response.json(value, { status, headers });
  try {
    if (request.method === 'GET') {
      if (['code', 'state', 'error'].some((name) => url.searchParams.has(name))) {
        if (limit) rateCheck(request, 'tool');
        return await finishConnection(request, config, headers);
      }
      const status: WorkspaceStatus = { connections: { gmail: connectionStatus(request, config, 'gmail'), vercel: connectionStatus(request, config, 'vercel') },
        hostedImages: url.origin === config.origin && !!config.image, hostedVision: url.origin === config.origin && config.image?.vision === true };
      return json(status);
    }
    if (request.method !== 'POST') { headers.set('Allow', 'GET, POST'); throw new ToolError('Method not allowed.', 405); }
    if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new ToolError('Open the Xyvora workspace to use tools.', 403);
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw new ToolError('Send JSON data.', 415);
    const photo = url.searchParams.get('input') === 'image';
    if (photo && (url.origin !== config.origin || !config.image?.vision)) throw new ToolError('Image analysis is unavailable.', 503);
    let input;
    try { input = asObject(await boundedJson(request, photo ? MAX_VISION_BASE64 + 8_000 : 12_000)); }
    catch (error) { throw error instanceof ToolError ? error : new ToolError('Send a valid JSON tool request.'); }
    const { action, provider, operation, approved } = input;
    if (approved !== true) throw new ToolError('Review and approve the action first.', 403);
    if ((action === 'vision') !== photo) throw new ToolError('Use the Image Studio analysis form for image input.');
    if (limit) rateCheck(request, action === 'image' || photo ? 'image' : 'tool');
    if (photo) return json(await runVision(request, config, input));
    if (action === 'repository') return json(await readRepository(input, request.signal));
    if (action === 'api') {
      if (input.method !== 'GET') throw new ToolError('API Explorer only sends GET requests.');
      return json(await runPublicApi(input.target, request.signal));
    }
    if (action === 'image') return json(await runImage(request, config, input));
    if (!isProvider(provider)) throw new ToolError('Unknown account provider.');
    if (action === 'connect') return json({ url: startConnection(request, config, provider, headers) });
    if (action === 'disconnect') return json({ disconnected: true, revoked: await disconnect(request, config, provider, headers) });
    if (action === 'account' && typeof operation === 'string') {
      try { return json(await readConnection(request, config, provider, operation, input.teamSlug)); }
      catch (error) {
        if (error instanceof ToolError && error.status === 401) {
          clearConnection(provider, headers);
          throw new ToolError('The connection expired or was revoked. Connect it again to continue.', 401);
        }
        throw error;
      }
    }
    throw new ToolError('Unknown tool action.');
  } catch (error) {
    const status = error instanceof ToolError ? error.status : 500;
    if (status === 429) headers.set('Retry-After', '60');
    return json({ error: error instanceof ToolError ? error.message : 'The workspace tool did not complete.' }, status);
  }
}
