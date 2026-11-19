import { handleChat } from './chat.ts';
import { generateOnServer } from './inference.ts';
import { searchWeb } from './web-search.ts';

export default {
  fetch(request: Request) {
    return handleChat(request, { generate: generateOnServer, search: searchWeb, limit: true });
  },
};
