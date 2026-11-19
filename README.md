# Xyvora

[Xyvora](https://xyvora.net) is a Qwen 2.5 chat workspace built with React and Vite. Replies stream from `/api/chat`; no WebGPU, browser model download, or account is needed. Earlier comparisons remain readable in local history but cannot start new replies.

- **Web search:** Enable the **Web search** chip for one prompt, or type `/search` followed by your query. Qwen answers using retrieved excerpts and shows the original source links. The [Wiby](https://wiby.me/json/) and [English Wikipedia](https://www.mediawiki.org/wiki/API:REST_API/Reference#Search_pages) indexes are keyless and rate-limited. They do not cover every site or guarantee breaking news. A lookup that fails is not presented as a sourced answer.
- **Time and date:** Ask “What time is it?”, “What is today’s date?”, or “What time is it in Tokyo?” The server clock answers directly without running the model. Local questions use the browser's IANA time zone; API requests without one use UTC.

## Run locally

```sh
npm ci --ignore-scripts
npm run dev
```

The local interface preview uses labeled sample replies and a real clock. Set `XYVORA_SERVER_MODELS=1` in `.env.local` for live Qwen inference and Web search. This needs a supported `node-llama-cpp` CPU binding and outbound access to the model/search hosts. Run `npm run build:models` to stage the pinned weights before the first request, or let the first local live request download them.

## Deploy to Vercel

Use the **xyvora-ai** project with **xyvora.net** as its production domain. `vercel.json` configures the Vite build, the Node function, and the CPU-only install. No Gateway credentials or other models are used.

- The build verifies a compact Q4_0 GGUF of Apache-2.0 [Qwen 2.5 0.5B Instruct](https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF), pinned to a revision and checksum. Only the Qwen file ships with the server, not with the client or in Git. The function maps the weights locally and reuses its native inference context and only the fixed system-prompt prefix. Request, clock, and web tokens are discarded between requests. Up to two CPU threads are used when available.
- The artifact exceeds the standard bundle limit; use [Large Functions](https://vercel.com/docs/functions/limitations#large-functions) with Fluid compute and Active CPU. Older projects may need `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`. `npm run build` works without downloading the weights; `npm run build:models` stages them separately.
- Vercel compute/transfer limits and the search provider's rate limits still apply. The API limits requests, lookup duration, context, and output. Use project spend controls and shared rate limits before operating at public scale.

## Privacy

Chat history stays in the browser. The server receives the prompt, limited recent context, any attached text, and the browser time zone to answer a chat request; it does not persist the chat. Only an explicitly requested search sends its search terms to Wiby and Wikipedia, not history, attachments, or your time zone. Do not include private information in a search. Source links provide attribution, including to Wikipedia contributors and [CC BY-SA licensing](https://en.wikipedia.org/wiki/Wikipedia:Copyrights).

## Checks

```sh
npm test
npm run build
node --experimental-strip-types scripts/smoke-chat.mjs https://xyvora.net --benchmark
```

The public smoke test verifies real Qwen streams, live clock output, and external sources. `--benchmark` repeats short prompts and times a longer reply, separating first visible text from completion. After building and staging the weights locally, `VERCEL=1 node --experimental-strip-types scripts/check-bundle.mjs` exercises the bundled handler without HTTP or model downloads; add `--search` to check both external indexes.

### Live latency sample

Five consecutive short Qwen replies on `xyvora.net` produced the same seven text chunks before and after the Qwen-only release. Times include the HTTP request, not just model execution.

| Measurement | Previous `9321539` | Qwen-only `e3fd665` |
| --- | ---: | ---: |
| Median time to first text | 1,130 ms | 336 ms |
| Median time to complete | 1,522 ms | 812 ms |
| First request, time to first text | 5,154 ms | 5,001 ms |

These are small live samples from the Vercel region, not a latency guarantee. The improvement is mainly on already loaded instances; a cold server can still take several seconds. The longer packing-list sample started in 500 ms instead of 886 ms, but it generated 275 instead of 173 text chunks and took 17.3 instead of 10.7 seconds to finish. Generation throughput did not materially improve in that sample.

The live checks ran in Vercel build job `dpl_GxM6ePhy3wguYUd2QhWenCF3yEWg` against production deployment `dpl_9GWZenYFwz9mZXFA4tcMxLkDF4Ck` via the apex domain.
