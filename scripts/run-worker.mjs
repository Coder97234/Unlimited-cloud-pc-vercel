import { accountConfig } from '../server/account.ts';
import { generateOnServer } from '../server/inference.ts';
import { workTextQueue } from '../server/job-worker.ts';
import { workerHeartbeat } from '../server/worker-health.ts';
import { hasExpectedSize, MODEL_WEIGHT, packagedWeightPath } from '../server/model-weights.ts';

const config = accountConfig(process.env);
if (!config?.background) throw new Error('Set XYVORA_DATABASE_URL and XYVORA_ENABLE_BACKGROUND=1 for the text worker.');
if (!await hasExpectedSize(packagedWeightPath(), MODEL_WEIGHT)) throw new Error('Run npm run build:models before starting the text worker.');
let warmed = false;
await generateOnServer([{ role: 'user', content: 'Say hello in one sentence.' }], AbortSignal.timeout(60_000), (text) => { if (text.trim()) warmed = true; }, { mode: 'instant' });
if (!warmed) throw new Error('The text worker could not generate a startup reply.');
// Fail at boot if storage is not reachable or the migrations are missing.
try { await workerHeartbeat(config.db); } catch { throw new Error('Could not open the text queue. Check the database and launch migration.'); }
const shutdown = new AbortController();
process.once('SIGTERM', () => shutdown.abort());
process.once('SIGINT', () => shutdown.abort());
console.log('Xyvora text worker is polling the queue.');
await workTextQueue(config.db, config.origin, { generate: generateOnServer }, shutdown.signal);
