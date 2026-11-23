import { checkUpdateLock } from './update-lock.ts';
import { accountConfig, hostedModelsFor, projectContextFor } from './account.ts';
import { handleChat } from './chat.ts';
import { generateOnServer } from './inference.ts';
import { handleJobs } from './jobs.ts';
import { researchWeb, searchWeb } from './web-search.ts';

const chat = { generate: generateOnServer, search: searchWeb, limit: true, research: process.env.XYVORA_ENABLE_RESEARCH === '1' ? researchWeb : undefined };
export default {
  async fetch(request: Request) {
    const blocked = await checkUpdateLock(request, process.env, { deployed: true });
    if (blocked) return blocked;
    if (new URL(request.url).searchParams.get('work') === 'jobs') {
      return handleJobs(request, accountConfig(process.env));
    }
    const account = request.headers.has('x-xyvora-account') ? accountConfig(process.env) : undefined;
    return handleChat(request, account ? { ...chat, projectContext: projectContextFor(account), hosted: hostedModelsFor(account, chat.generate) } : chat);
  },
};
