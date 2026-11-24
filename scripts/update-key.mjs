import { readFileSync } from 'node:fs';
import { makeUpdateKey, makeUpdateVerifier } from '../server/update-lock.ts';

const args = process.argv.slice(2);
if (args.length > 1 || args.length === 1 && args[0] !== '--verifier') throw new Error('Usage: npm run --silent update:key -- [--verifier]');
// Read from stdin so neither the password nor the verifier appears in argv.
// Redirect stdout to an ignored, mode-0600 file or a secret manager.
const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
console.log(await (args.length ? makeUpdateVerifier(password) : makeUpdateKey(password)));
