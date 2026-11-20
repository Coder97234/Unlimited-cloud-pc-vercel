import { XYVORA_URL } from '../shared/site.ts';
import { handleAnalytics } from './analytics.ts';
import { productionDb } from './database.ts';
export default { fetch: (request: Request) => handleAnalytics(request, process.env.XYVORA_ACCOUNT_ORIGIN || XYVORA_URL, productionDb(process.env)) };
