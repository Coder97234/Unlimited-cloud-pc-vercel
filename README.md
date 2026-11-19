# Xyvora

Xyvora is a chat workspace for open-weight language models, built with React and Vite for deployment on Vercel. Chat with one model or compare two answers to the same prompt. Conversations and appearance settings are stored in the current browser; no account is needed.

## Run locally

```sh
npm ci
npm run dev
```

Without a key, the local development server shows a clearly labeled, scripted interface preview. For real hosted replies, set `AI_GATEWAY_API_KEY` in `.env.local` (see `.env.example`), or deploy to a Vercel project with AI Gateway access and OIDC enabled.

**Qwen On-device** runs the Qwen 2.5 0.5B model using WebLLM on a compatible WebGPU browser. It downloads the model files on first use and does not send prompts to an AI provider. Hosted model choices use Qwen 3 32B, GPT OSS 20B, or Mistral Nemo through Vercel AI Gateway. They are not bundled in this repository.

## Deploy to Vercel

- Framework: **Vite**. Build: `npm run build`. Output: `dist` (set in `vercel.json`).
- Use the **xyvora-ai** project and add **xyvora.net** as its production domain if not already assigned. Follow the DNS records shown by Vercel; don't replace records for unrelated services.
- The `/api/chat` function uses the project’s short-lived Vercel OIDC token at runtime. If required, set `AI_GATEWAY_API_KEY` as a **server-side** project environment variable and redeploy. The team needs AI Gateway access and model credits. `XYVORA_DISABLE_HOSTED=1` disables cloud inference for a browser-only deployment.
- A public hosted endpoint consumes the project's AI Gateway quota. The API limits models, input size, and output length and applies per-instance throttling. Configure a project spend limit and a shared edge rate limit before running it at public scale.

Hosted prompts, recent conversation turns, and attached text are sent to Vercel AI Gateway and the selected model provider. No messages are stored on the Xyvora server. Avoid sharing sensitive information with hosted models.

## Checks

```sh
npm test
npm run build
```
