import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import type { Connect, Plugin } from 'vite';
import { handleChat } from './server/chat.ts';
import { bundledModelAvailable, generateOnServer } from './server/inference.ts';
import { localModelsFrom } from './server/local-models.ts';
import { searxngSearch } from './server/searxng.ts';
import { handleWorkspace } from './server/workspace.ts';
import { handleAnalytics } from './server/analytics.ts';
import { productionDb } from './server/database.ts';
import { localPlatformDb } from './server/local-database.ts';
import { handleJobs } from './server/jobs.ts';
import { workTextQueue } from './server/job-worker.ts';
import type { SendAccountMail } from './server/account-email.ts';
import { accountConfig, handleAccount, hostedModelsFor, projectContextFor } from './server/account.ts';
import type { AccountConfig } from './server/account.ts';
import { workspaceConfig } from './server/workspace-connections.ts';
import { XYVORA_URL } from './shared/site.ts';
import { checkUpdateLock, updateCacheHeaders, updateLocked } from './server/update-lock.ts';
import { PUBLIC_PAGES, publicPages } from './server/public-pages.ts';

function apiInDevelopment(env: Record<string, string | undefined>): Plugin {
  const realServerModel = env.XYVORA_SERVER_MODELS === '1';
  const local = env.XYVORA_LOCAL_PLATFORM === '1';
  const db = local ? localPlatformDb(env.XYVORA_LOCAL_PLATFORM_DIR) : productionDb(env);
  // Test the selected email flow without ever sending mail in local platform mode.
  const identityEnv = local ? { XYVORA_ENABLE_PASSWORDS: '1', XYVORA_ENABLE_BACKGROUND: '1', XYVORA_ENABLE_PROJECTS: '1', XYVORA_ENABLE_SESSIONS: '1', XYVORA_ENABLE_LIBRARY: env.XYVORA_ENABLE_LIBRARY === '0' ? '0' : '1', XYVORA_MAIL_PROVIDER: env.XYVORA_MAIL_PROVIDER,
    XYVORA_AUTH_SECRET: env.XYVORA_AUTH_SECRET || randomBytes(32).toString('hex') } : env;
  const localMail: SendAccountMail | undefined = local ? async (message, signal) => {
    const dir = env.XYVORA_LOCAL_MAIL_DIR || '.cache/xyvora-platform-mail';
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(`${dir}/${randomUUID()}.json`, JSON.stringify(message), { mode: 0o600, flag: 'wx', signal });
  } : undefined;
  const search = searxngSearch(env);
  const localModels = localModelsFrom(env);
  const chatOptions = async () => ({ generate: realServerModel && await bundledModelAvailable() ? generateOnServer : undefined,
    localModels, search, research: search, preview: !realServerModel, limit: realServerModel || !!localModels });
  async function chatForRequest(request: Request, accounts?: AccountConfig) {
    const chat = await chatOptions();
    return handleChat(request, { ...chat, projectContext: projectContextFor(accounts), hosted: hostedModelsFor(accounts, chat.generate) });
  }
  const deployed = env.VERCEL === '1' || !!env.VERCEL_ENV;
  const locked = updateLocked(env, deployed);
  const settings = workspaceConfig(env);
  const middleware: Connect.NextHandleFunction = (incoming, outgoing, next) => {
    const path = incoming.url?.split('?')[0];
    const api = path === '/api/chat' || path === '/api/workspace' || path === '/api/account' || path === '/api/analytics';
    if (!locked && !api) { next(); return; }
    const controller = new AbortController();
    outgoing.once('close', () => { if (!outgoing.writableEnded) controller.abort(); });
    void (async () => {
      const headers = new Headers();
      for (const [key, val] of Object.entries(incoming.headers)) {
        if (val !== undefined) headers.set(key, Array.isArray(val) ? val.join(', ') : val);
      }
      const method = incoming.method ?? 'GET';
      const init: RequestInit & { duplex?: 'half' } = { method, headers, signal: controller.signal };
      if (method !== 'GET' && method !== 'HEAD' && (api || path === '/_xyvora/unlock' || path === '/_xyvora/relock')) {
        init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        init.duplex = 'half';
      }
      const host = headers.get('host') ?? 'localhost';
      const tls = host.endsWith('.e2b.app') || headers.get('x-forwarded-proto') === 'https';
      const request = new Request(`${tls ? 'https' : 'http'}://${host}${incoming.url}`, init);
      const url = new URL(request.url);
      const gate = locked ? await checkUpdateLock(request, env, { deployed, ip: incoming.socket.remoteAddress }) : undefined;
      if (locked && !gate) Object.entries(updateCacheHeaders).forEach(([name, value]) => outgoing.setHeader(name, value));
      if (!api && !gate) { next(); return; }
      const localOrigin = local && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.e2b.app')) ? url.origin : undefined;
      const accounts = local && !localOrigin ? undefined : accountConfig(identityEnv, db, localOrigin, localMail);
      const response = gate ?? (path === '/api/account' ? await handleAccount(request, accounts)
        : path === '/api/analytics' ? await handleAnalytics(request, accounts?.origin ?? env.XYVORA_ACCOUNT_ORIGIN ?? XYVORA_URL, accounts?.db)
        : path === '/api/workspace' ? await handleWorkspace(request, settings, { limit: !local, accounts })
        : url.searchParams.get('work') === 'jobs' ? await handleJobs(request, accounts)
        : await chatForRequest(request, accounts));
      outgoing.statusCode = response.status;
      response.headers.forEach((value, key) => { if (key !== 'set-cookie') outgoing.setHeader(key, value); });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) outgoing.setHeader('Set-Cookie', cookies);
      if (response.body) {
        await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), outgoing);
      } else outgoing.end();
    })().catch(() => {
      if (outgoing.destroyed) return;
      if (outgoing.headersSent) { outgoing.destroy(); return; }
      outgoing.writeHead(500, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ error: 'The development API could not respond.' }));
    });
  };
  function startLocalWorker(httpServer: { once: (event: 'close', stop: () => void) => unknown } | null) {
    if (!local || !db) return;
    const controller = new AbortController();
    httpServer?.once('close', () => controller.abort());
    void chatOptions().then((chat) => workTextQueue(db, XYVORA_URL, chat, controller.signal));
  }
  return {
    name: 'xyvora-workspace-development',
    configureServer(server) { server.middlewares.use(middleware); startLocalWorker(server.httpServer); },
    configurePreviewServer(server) { server.middlewares.use(middleware); startLocalWorker(server.httpServer); },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as { headers: { headers: { key: string; value: string }[] }[] };
  const previewHeaders = Object.fromEntries(vercel.headers[0].headers.map(({ key, value }) => [key, value]));
  return {
    appType: 'mpa',
    define: { __XYVORA_EARLY_ACCESS__: JSON.stringify(updateLocked(env, env.VERCEL === '1' || !!env.VERCEL_ENV)) },
    build: { rolldownOptions: { input: PUBLIC_PAGES.map(([, file]) => fileURLToPath(new URL(`./${file}`, import.meta.url))) } },
    plugins: [publicPages(), react(), apiInDevelopment(env)],
    server: {
      host: '0.0.0.0',
      allowedHosts: ['.e2b.app'],
      fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.cache/**', '**/*.gguf'] },
    },
    preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app'], headers: previewHeaders },
  };
});
