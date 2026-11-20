import { accountConfig } from './account.ts';
import { handleChat } from './chat.ts';
import { generateOnServer } from './inference.ts';
import { handleJobs } from './jobs.ts';
import { searchWeb } from './web-search.ts';

const chat = { generate: generateOnServer, search: searchWeb, limit: true };
export default {
  async fetch(request: Request) {
    if (new URL(request.url).searchParams.get('work') === 'jobs') {
      const config = accountConfig(process.env);
      if (!config?.background) return handleJobs(request, config, chat, () => {});
      const { waitUntil } = await import('@vercel/functions');
      return handleJobs(request, config, chat, waitUntil);
    }
    return handleChat(request, chat);
  },
};
