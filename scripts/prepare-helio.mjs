import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { prepareWeights } from '../server/model-weights.ts';
import { HELIO_CPU_PROFILE } from './helio-profile.mjs';

const [option, value, ...extra] = process.argv.slice(2);
if (option !== undefined && (option !== '--from-dir' || !value || extra.length)) {
  throw new Error('Usage: npm run build:helio -- [--from-dir directory-with-complete-GGUFs]');
}
const destination = resolve('.cache/xyvora-helio/models');
const stop = new AbortController();
for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => stop.abort(new Error('Helio setup canceled.')));
for (const [tier, { alias, ...spec }] of Object.entries(HELIO_CPU_PROFILE)) {
  const file = `${alias}.gguf`;
  console.log(`Preparing ${tier}: ${file}`);
  // Offline installs can import complete GGUFs with the same integrity and
  // atomic publish checks as a download. The app never calls this script.
  const fromDisk = value ? async (_url, { signal }) =>
    new Response(Readable.toWeb(createReadStream(resolve(value, file), { signal }))) : undefined;
  await prepareWeights(spec, resolve(destination, file), AbortSignal.any([stop.signal, AbortSignal.timeout(1_800_000)]), fromDisk);
  console.log(`Verified ${tier}: ${spec.size} bytes`);
}
console.log(`Weights ready in ${destination}. Start your offline llama.cpp runner (docs/local-inference.md).`);
