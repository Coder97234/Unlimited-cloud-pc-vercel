import { DEFAULT_MODEL } from '../shared/models.ts';
import { MODEL_WEIGHT, packagedWeightPath, prepareWeights } from '../server/model-weights.ts';

// Deployment artifact only: not in dist/ or Git.
await prepareWeights(MODEL_WEIGHT, packagedWeightPath(), AbortSignal.timeout(180_000));
console.log(`Verified ${DEFAULT_MODEL} (${MODEL_WEIGHT.size} bytes) for the server bundle`);
