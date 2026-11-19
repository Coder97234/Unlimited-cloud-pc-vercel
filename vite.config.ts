import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import type { Connect, Plugin } from 'vite';
import { handleChat } from './server/chat.ts';
import { generateOnServer } from './server/inference.ts';

function chatInDevelopment(token: string | undefined, realServerModels: boolean): Plugin {
  const middleware: Connect.NextHandleFunction = (incoming, outgoing, next) => {
    if (incoming.url?.split('?')[0] !== '/api/chat') { next(); return; }
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
      const request = new Request('https://dev.xyvora.invalid/api/chat', init);
      const response = await handleChat(request, {
        token,
        generate: realServerModels ? generateOnServer : undefined,
        preview: !realServerModels && !token,
        limit: realServerModels || !!token,
      });
      outgoing.statusCode = response.status;
      response.headers.forEach((value, key) => outgoing.setHeader(key, value));
      if (response.body) {
        await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), outgoing);
      } else outgoing.end();
    })().catch(() => {
      if (outgoing.destroyed) return;
      if (outgoing.headersSent) { outgoing.destroy(); return; }
      outgoing.writeHead(500, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ error: 'The development chat route could not respond.' }));
    });
  };
  return {
    name: 'xyvora-chat-development',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), chatInDevelopment(env.AI_GATEWAY_API_KEY, env.XYVORA_SERVER_MODELS === '1')],
    server: {
      host: '0.0.0.0',
      allowedHosts: ['.e2b.app'],
      fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/*.gguf'] },
    },
    preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
  };
});
