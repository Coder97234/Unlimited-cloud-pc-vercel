import { isProvider, publicApiTarget } from '../shared/workspace-tools.ts';
import type { WorkspaceStatus } from '../shared/workspace-tools.ts';
import { connectionStatus, disconnect, equalSecret, finishConnection, readConnection, startConnection, workspaceConfig } from './workspace-connections.ts';
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
  if (!spec) throw new ToolError('Use an HTTPS GitHub repository or latest-release API endpoint. This is not a general URL proxy.');
  const data = await providerJson(spec.endpoint, signal, { headers: { 'User-Agent': 'Xyvora-API-Explorer' } });
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const result = spec.type === 'release'
    ? { name: shortText(data.name), tag: shortText(data.tag_name), publishedAt: shortText(data.published_at, 32), prerelease: data.prerelease === true }
    : { name: shortText(data.full_name), description: shortText(data.description, 550), stars: number(data.stargazers_count), forks: number(data.forks_count),
      openIssues: number(data.open_issues_count), language: shortText(data.language, 80), defaultBranch: shortText(data.default_branch, 120), archived: data.archived === true };
  return { endpoint: spec.endpoint, data: result };
}

async function runImage(request: Request, config: WorkspaceConfig, prompt: unknown, accessCode: unknown) {
  if (!config.image || new URL(request.url).origin !== config.origin) throw new ToolError('Hosted image generation is not set up on this site. Local graphics are available.', 503);
  if (typeof accessCode !== 'string' || accessCode.length > 180 || !equalSecret(accessCode, config.image.accessCode)) throw new ToolError('A valid studio access code is required.', 403);
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1_200) throw new ToolError('Describe the image in 1–1,200 characters.');
  const data = await providerJson('https://api.openai.com/v1/images/generations', request.signal, {
    method: 'POST', headers: { Authorization: `Bearer ${config.image.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt: prompt.trim(), n: 1, size: '1024x1024', quality: 'medium', output_format: 'jpeg', output_compression: 85 }),
  }, { limit: 3_200_000, timeout: 75_000 });
  const image = asObject(Array.isArray(data.data) ? data.data[0] : undefined).b64_json;
  if (typeof image !== 'string' || image.length > 3_100_000 || image.length < 16 || !/^\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new ToolError('The provider did not return a usable image.', 502);
  return { mime: 'image/jpeg', image };
}

export async function handleWorkspace(request: Request, config: WorkspaceConfig = workspaceConfig(process.env), { limit = true } = {}) {
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
        hostedImages: url.origin === config.origin && !!config.image };
      return json(status);
    }
    if (request.method !== 'POST') { headers.set('Allow', 'GET, POST'); throw new ToolError('Method not allowed.', 405); }
    if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new ToolError('Open the Xyvora workspace to use tools.', 403);
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw new ToolError('Send JSON data.', 415);
    let input;
    try { input = asObject(await boundedJson(request, 12_000)); }
    catch (error) { throw error instanceof ToolError ? error : new ToolError('Send a valid JSON tool request.'); }
    const { action, provider, operation, approved } = input;
    if (approved !== true) throw new ToolError('Review and approve the action first.', 403);
    if (limit) rateCheck(request, action === 'image' ? 'image' : 'tool');
    if (action === 'api') {
      if (input.method !== 'GET') throw new ToolError('API Explorer only sends GET requests.');
      return json(await runPublicApi(input.target, request.signal));
    }
    if (action === 'image') return json(await runImage(request, config, input.prompt, input.accessCode));
    if (!isProvider(provider)) throw new ToolError('Unknown account provider.');
    if (action === 'connect') return json({ url: startConnection(request, config, provider, headers) });
    if (action === 'disconnect') return json({ disconnected: true, revoked: await disconnect(request, config, provider, headers) });
    if (action === 'account' && typeof operation === 'string') return json(await readConnection(request, config, provider, operation));
    throw new ToolError('Unknown tool action.');
  } catch (error) {
    const status = error instanceof ToolError ? error.status : 500;
    if (status === 429) headers.set('Retry-After', '60');
    return json({ error: error instanceof ToolError ? error.message : 'The workspace tool did not complete.' }, status);
  }
}
