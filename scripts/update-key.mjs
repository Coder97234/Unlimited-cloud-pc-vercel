import { readFileSync } from 'node:fs';
import { makeUpdateKey } from '../server/update-lock.ts';

// Read from stdin so neither the password nor the verifier appears in argv.
// Redirect stdout to an ignored, mode-0600 file or a secret manager.
const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
console.log(await makeUpdateKey(password));
