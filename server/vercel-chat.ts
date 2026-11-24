import { checkUpdateLock } from './update-lock.ts';
import { accountConfig, hostedModelsFor, projectContextFor } from './account.ts';
import { handleChat } from './chat.ts';
import { bundledModelAvailable, generateOnServer } from './inference.ts';
import { handleJobs } from './jobs.ts';
import { localModelsFrom } from './local-models.ts';
import { searxngSearch } from './searxng.ts';

// Reuse the inventory and concurrency guard across requests in a warm function.
const localModels = localModelsFrom(process.env);

export default {
  async fetch(request: Request) {
    const blocked = await checkUpdateLock(request, process.env, { deployed: true });
    if (blocked) return blocked;
    if (new URL(request.url).searchParams.get('work') === 'jobs') {
      return handleJobs(request, accountConfig(process.env));
    }
    const search = searxngSearch(process.env);
    const chat = { generate: await bundledModelAvailable() ? generateOnServer : undefined, localModels, search, limit: true, research: search };
    const account = request.headers.has('x-xyvora-account') ? accountConfig(process.env) : undefined;
    return handleChat(request, account ? { ...chat, projectContext: projectContextFor(account), hosted: hostedModelsFor(account, chat.generate) } : chat);
  },
};
