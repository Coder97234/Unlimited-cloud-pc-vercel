import { accountConfig } from './account.ts';
import { checkUpdateLock } from './update-lock.ts';
import { handleWorkspace } from './workspace.ts';
import { workspaceConfig } from './workspace-connections.ts';

export default { async fetch(request: Request) {
  const gate = await checkUpdateLock(request, process.env, { deployed: true });
  if (gate) return gate;
  const config = workspaceConfig(process.env);
  return handleWorkspace(request, config, { accounts: config.appConnections ? accountConfig(process.env) : undefined });
} };
