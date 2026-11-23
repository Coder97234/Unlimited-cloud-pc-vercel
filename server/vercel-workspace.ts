import { checkUpdateLock } from './update-lock.ts';
import { handleWorkspace } from './workspace.ts';

export default { fetch: async (request: Request) => await checkUpdateLock(request, process.env, { deployed: true }) ?? handleWorkspace(request) };
