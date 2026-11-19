import { SERVER_MODELS } from '../shared/models.ts';
import { MODEL_WEIGHTS, packagedWeightPath, prepareWeights } from '../server/model-weights.ts';

// Deployment artifact only: not in dist/ or Git.
await Promise.all(SERVER_MODELS.map(async (id) => {
  const spec = MODEL_WEIGHTS[id];
  await prepareWeights(spec, packagedWeightPath(id), AbortSignal.timeout(180_000));
  console.log(`Verified ${id} (${spec.size} bytes) for the server bundle`);
}));
