import { checkUpdateLock } from './update-lock.ts';
import { waitUntil } from '@vercel/functions';
import { accountConfig, handleAccount } from './account.ts';
export default { fetch: async (request: Request) => await checkUpdateLock(request, process.env, { deployed: true }) ?? handleAccount(request, accountConfig(process.env), { schedule: waitUntil }) };
