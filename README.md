# Xyvora

[Xyvora](https://xyvora.net) is a chat workspace for open-weight models, built with React and Vite for Vercel. Chat with one model or compare two on the same prompt. Replies stream from `/api/chat`; the browser just renders them. No account, WebGPU, or browser-side model download is needed.

## Run locally

```sh
npm ci --ignore-scripts
npm run dev
```

By default, the local dev server shows clearly labeled sample replies. Set `XYVORA_SERVER_MODELS=1` in `.env.local` (see `.env.example`) to use real server inference locally. That needs a supported `node-llama-cpp` CPU binding. Run `npm run build:models` to prepare the pinned weights in advance, or let the first local request download them from Hugging Face. A local `AI_GATEWAY_API_KEY` enables real Gateway models instead of samples.

## Deploy to Vercel

Use the **xyvora-ai** project with **xyvora.net** as its production domain. The Vite build, Node function, and CPU-only Vercel install are configured in `vercel.json`. Leave existing DNS in place when it is verified.

- **Qwen 2.5 Lite** (Qwen 2.5 0.5B Instruct) and **SmolLM2 360M Instruct** run on the Vercel function CPU with llama.cpp. Both models are Apache-2.0. The Vercel build downloads and verifies the pinned weights and includes them only in the function bundle. The function loads the model from disk and reuses it on a warm instance; it does not fetch the weights when a visitor sends a message. The weights are not in Git or the browser bundle.
- The model files exceed Vercel’s standard function size limit. This deployment uses [Large Functions](https://vercel.com/docs/functions/limitations#large-functions) with Fluid compute and Active CPU. On older projects, set `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` before deploying. `npm run build` still works offline; `npm run build:models` stages the model files separately.
- These are lightweight models for short prompts, not the same models as ChatGPT. Output length and context are limited to keep server CPU usage bounded. Compare streams independent replies from both models.
- **Optional larger models:** after [verifying and enabling AI Gateway](https://vercel.com/docs/ai-gateway/authentication-and-byok) and setting a budget, set `XYVORA_ENABLE_GATEWAY=1` and redeploy. The function can use the request-scoped Vercel OIDC token or a server-side `AI_GATEWAY_API_KEY`. These models are not required for chat or Compare.
- Vercel compute and transfer quotas still apply without Gateway. The API limits input, output, and per-instance traffic. Configure project spend/usage controls and shared rate limiting before operating at public scale.

## Privacy

Chat history is stored in the current browser. To answer, the Xyvora function receives the prompt, a limited amount of recent conversation, and any attached text. It does not persist messages. If a Gateway model is selected, that context is also sent to Vercel AI Gateway and the model provider. Earlier browser-generated replies remain visible locally and are not automatically included as server context.

## Checks

```sh
npm test
npm run build
# Verify real replies from both deployed models (not an availability check):
node --disable-warning=ExperimentalWarning --experimental-strip-types scripts/smoke-chat.mjs https://xyvora.net
```
