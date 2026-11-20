import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import type { Connect, Plugin } from 'vite';
import { handleChat } from './server/chat.ts';
import { generateOnServer } from './server/inference.ts';
import { searchWeb } from './server/web-search.ts';
import { handleWorkspace } from './server/workspace.ts';
import { workspaceConfig } from './server/workspace-connections.ts';
import { publicPages } from './server/public-pages.ts';

function apiInDevelopment(realServerModel: boolean, settings: ReturnType<typeof workspaceConfig>): Plugin {
  const middleware: Connect.NextHandleFunction = (incoming, outgoing, next) => {
    const path = incoming.url?.split('?')[0];
    if (path !== '/api/chat' && path !== '/api/workspace') { next(); return; }
    const controller = new AbortController();
    outgoing.once('close', () => { if (!outgoing.writableEnded) controller.abort(); });
    void (async () => {
      const headers = new Headers();
      for (const [key, val] of Object.entries(incoming.headers)) {
        if (val !== undefined) headers.set(key, Array.isArray(val) ? val.join(', ') : val);
      }
      const method = incoming.method ?? 'GET';
      const init: RequestInit & { duplex?: 'half' } = { method, headers, signal: controller.signal };
      if (method !== 'GET' && method !== 'HEAD') {
        init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        init.duplex = 'half';
      }
      const host = headers.get('host') ?? 'localhost';
      const tls = host.endsWith('.e2b.app') || headers.get('x-forwarded-proto') === 'https';
      const request = new Request(`${tls ? 'https' : 'http'}://${host}${incoming.url}`, init);
      const response = path === '/api/workspace' ? await handleWorkspace(request, settings, { limit: false }) : await handleChat(request, {
        generate: realServerModel ? generateOnServer : undefined,
        search: realServerModel ? searchWeb : undefined,
        preview: !realServerModel,
        limit: realServerModel,
      });
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
  return {
    name: 'xyvora-workspace-development',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as { headers: { headers: { key: string; value: string }[] }[] };
  const previewHeaders = Object.fromEntries(vercel.headers[0].headers.map(({ key, value }) => [key, value]));
  return {
    appType: 'mpa',
    build: { rolldownOptions: { input: ['index.html', 'about.html', 'schools.html'].map((file) => fileURLToPath(new URL(`./${file}`, import.meta.url))) } },
    plugins: [publicPages(), react(), apiInDevelopment(env.XYVORA_SERVER_MODELS === '1', workspaceConfig({ ...process.env, ...env }))],
    server: {
      host: '0.0.0.0',
      allowedHosts: ['.e2b.app'],
      fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/*.gguf'] },
    },
    preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app'], headers: previewHeaders },
  };
});
