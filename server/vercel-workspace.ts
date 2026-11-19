import { handleWorkspace } from './workspace.ts';

export default { fetch: (request: Request) => handleWorkspace(request) };
