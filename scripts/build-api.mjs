import { rolldown } from 'rolldown';

for (const route of ['chat', 'workspace', 'account', 'analytics']) {
  const bundle = await rolldown({ input: `server/vercel-${route}.ts`, platform: 'node', external: ['node-llama-cpp', 'pg', '@vercel/functions'] });
  try { await bundle.write({ file: `build/${route}.mjs`, format: 'esm' }); }
  finally { await bundle.close(); }
}
