import { handleChat } from '../server/chat.ts';

export default {
  fetch(request: Request) {
    // Vercel supplies the short-lived runtime token on the function request.
    // VERCEL_OIDC_TOKEN is the build/local token, not a production runtime env var.
    const runtimeToken = process.env.VERCEL === '1' ? request.headers.get('x-vercel-oidc-token') : null;
    const token = process.env.XYVORA_DISABLE_HOSTED === '1'
      ? undefined
      : process.env.AI_GATEWAY_API_KEY || runtimeToken || process.env.VERCEL_OIDC_TOKEN;
    return handleChat(request, { token, limit: true });
  },
};
