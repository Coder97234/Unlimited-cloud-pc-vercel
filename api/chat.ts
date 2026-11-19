import { handleChat } from '../server/chat.ts';

export default {
  fetch(request: Request) {
    const token = process.env.XYVORA_DISABLE_HOSTED === '1'
      ? undefined
      : process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
    return handleChat(request, { token, limit: true });
  },
};
