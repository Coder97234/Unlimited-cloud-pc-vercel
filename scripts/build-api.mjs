import { rolldown } from 'rolldown';

const bundle = await rolldown({
  input: 'server/vercel-chat.ts',
  platform: 'node',
  external: ['node-llama-cpp'],
});
try {
  await bundle.write({ file: 'build/chat.mjs', format: 'esm' });
} finally {
  await bundle.close();
}
