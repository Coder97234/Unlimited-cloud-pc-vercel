import { accountConfig, handleAccount } from './account.ts';
export default { fetch: (request: Request) => handleAccount(request, accountConfig(process.env)) };
