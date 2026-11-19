import { access, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('The Vercel CPU function needs the Linux x64 build environment.');
}

// npm installs accelerator variants as optional dependencies on Linux.
// Keep the CPU binding and its shared objects, not unused GPU/ARM binaries.
const scope = 'node_modules/@node-llama-cpp';
await access(join(scope, 'linux-x64', 'bins', 'linux-x64', 'llama-addon.node'));
for (const name of await readdir(scope)) {
  if (name !== 'linux-x64') await rm(join(scope, name), { recursive: true, force: true });
}
