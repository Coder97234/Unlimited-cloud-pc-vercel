import { checkUpdateLock } from './update-lock.ts';
import { XYVORA_URL } from '../shared/site.ts';
import { handleAnalytics } from './analytics.ts';
import { productionDb } from './database.ts';
export default { fetch: async (request: Request) => await checkUpdateLock(request, process.env, { deployed: true }) ?? handleAnalytics(request, process.env.XYVORA_ACCOUNT_ORIGIN || XYVORA_URL, productionDb(process.env)) };
