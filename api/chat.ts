import { handleChat } from '../server/chat.ts';
import { generateOnServer } from '../server/inference.ts';

export default {
  fetch(request: Request) {
    // A Vercel OIDC token alone does not imply the team can use AI Gateway.
    // Only offer the larger models when the operator explicitly enables them.
    let token: string | undefined;
    if (process.env.XYVORA_ENABLE_GATEWAY === '1') {
      const runtimeToken = process.env.VERCEL === '1' ? request.headers.get('x-vercel-oidc-token') : null;
      token = process.env.AI_GATEWAY_API_KEY || runtimeToken || process.env.VERCEL_OIDC_TOKEN;
    }
    return handleChat(request, { generate: generateOnServer, token, limit: true });
  },
};
