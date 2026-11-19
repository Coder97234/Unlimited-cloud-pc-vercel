# Xyvora AI

[Xyvora AI](https://xyvora.net) is the assistant at **xyvora.net**, powered by **Qwen 2.5**. Ask “Who are you?” or type `/about` for its name, website, and model. No account, browser model download, or WebGPU is needed. Earlier comparisons remain readable in local history.

## Skills

Open **Skills** (or `Ctrl`/`⌘` + `/`) and select a card to load an editable example. Type `/skills` to see the command list in chat, or try one of these:

| Skill | Example | Runs on |
| --- | --- | --- |
| Calculator | `What is 18% of 84.50?` or `/calc sqrt(81) + 3^2` | Your device |
| Unit conversion | `/convert 72 F to C`, `/convert 2 cups to mL` (US cups) | Your device |
| Tip and split | `/split 84.50 + 18% / 3` (USD) | Your device |
| Calendar math | `/date 2028-02-28 + 3 days` or `/date 2028-02-28 to 2028-03-02` | Your device |
| Text stats, JSON formatting, case changes, list cleanup | `/text`, `/json`, `/case upper`, or `/lines sort`, followed by text or with a text attachment | Your device |
| Live clock | `What time is it?` or `/time Tokyo` | Server clock, no model |
| Web search | `/search NASA Artemis program` or turn on the **Web search** chip | Qwen 2.5 and search indexes |
| Writing and planning | `/summarize`, `/rewrite`, `/translate Spanish: Hello!`, `/plan learn guitar in two weeks` | Qwen 2.5 |

The writing tools can use pasted text or a text attachment. `/lines unique` keeps the first occurrence of each distinct non-empty line. Use the download icon in an open conversation to save its prompts, replies, and links as Markdown. Attached files themselves are not included, but a reply can contain text drawn from them.

Web search covers the keyless, rate-limited [Wiby](https://wiby.me/json/) and [English Wikipedia](https://www.mediawiki.org/wiki/API:REST_API/Reference#Search_pages) indexes. It does not cover every site or guarantee breaking news. Qwen uses retrieved excerpts and links to the source pages; a failed lookup is not presented as a sourced answer. The clock uses the browser's time zone by default, or UTC for API requests that omit one.

## Run locally

```sh
npm ci --ignore-scripts
npm run dev
```

The local interface preview uses labeled sample replies. On-device skills and the live clock still work. Set `XYVORA_SERVER_MODELS=1` in `.env.local` for live Qwen inference and Web search. This needs a supported `node-llama-cpp` CPU binding and outbound access to the model/search hosts. Run `npm run build:models` to stage the pinned weights before the first request, or let the first local live request download them.

## Deploy to Vercel

Use the **xyvora-ai** project with **xyvora.net** as its production domain. `vercel.json` configures the Vite build, the Node function, and the CPU-only install. No Gateway credentials or other models are used.

- The build verifies a compact Q4_0 GGUF of Apache-2.0 [Qwen 2.5 0.5B Instruct](https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF), pinned to a revision and checksum. Only the Qwen file ships with the server, not with the client or in Git. The function maps the weights locally and reuses its native inference context and only the fixed system-prompt prefix. Request, clock, and web tokens are discarded between requests. Up to two CPU threads are used when available.
- The artifact exceeds the standard bundle limit; use [Large Functions](https://vercel.com/docs/functions/limitations#large-functions) with Fluid compute and Active CPU. Older projects may need `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`. `npm run build` works without downloading the weights; `npm run build:models` stages them separately.
- Vercel compute/transfer limits and the search provider's rate limits still apply. The API limits requests, lookup duration, context, and output. Use project spend controls and shared rate limits before operating at public scale.

## Privacy

Chat history is stored in the browser. On-device skill turns do not make a chat request and are skipped in any later context sent to Qwen. For other replies, the server can receive the prompt, limited recent context, any attached text, and the browser time zone; it does not persist the chat. Only an explicitly requested search sends its search terms to Wiby and Wikipedia, not history, attachments, or your time zone. Do not include private information in a search. Source links provide attribution, including to Wikipedia contributors and [CC BY-SA licensing](https://en.wikipedia.org/wiki/Wikipedia:Copyrights).

## Chat API

`GET /api/chat` reports the assistant's name and site, the available model and skill IDs, and whether web search is available. `POST /api/chat` accepts `model: "qwen-lite"`, alternating `messages` ending with a user message, and optional `timeZone`, `searchQuery`, and `attachment: {name, text}`. Commands work in the last user message. Replies stream as SSE and end with `[DONE]` on success. `X-Xyvora-Source` identifies model, preview, clock, or built-in skill replies; clock and skill replies also set `X-Xyvora-Skill`.

## Checks

```sh
npm test
npm run build
node --experimental-strip-types scripts/smoke-chat.mjs https://xyvora.net --benchmark
```

The public smoke test verifies real Qwen streams, Xyvora’s identity, calculator and clock output, and external sources. `--benchmark` repeats short prompts and times a longer reply, separating first visible text from completion. After building and staging the weights locally, `VERCEL=1 node --experimental-strip-types scripts/check-bundle.mjs` exercises the bundled handler, tool dispatch, native workflow generation, and cancellation without HTTP or model downloads; add `--search` to check both external indexes.

### Live latency sample

Five consecutive short Qwen replies on `xyvora.net` produced the same seven text chunks before and after the Qwen-only release. Times include the HTTP request, not just model execution.

| Measurement | Previous `9321539` | Qwen-only `e3fd665` |
| --- | ---: | ---: |
| Median time to first text | 1,130 ms | 336 ms |
| Median time to complete | 1,522 ms | 812 ms |
| First request, time to first text | 5,154 ms | 5,001 ms |

These are small live samples from the Vercel region, not a latency guarantee. The improvement is mainly on already loaded instances; a cold server can still take several seconds. The longer packing-list sample started in 500 ms instead of 886 ms, but it generated 275 instead of 173 text chunks and took 17.3 instead of 10.7 seconds to finish. Generation throughput did not materially improve in that sample.

The live checks ran in Vercel build job `dpl_GxM6ePhy3wguYUd2QhWenCF3yEWg` against production deployment `dpl_9GWZenYFwz9mZXFA4tcMxLkDF4Ck` via the apex domain.

### Skills release performance

- The initial page script is **90.88 kB gzip** instead of **131.14 kB** (31% smaller). Markdown rendering loads when an answer is displayed, not on the empty homepage. Plain text is available while the renderer loads or if it cannot load.
- Five calculator submissions in each of two local Chromium viewport tests took **4.3–4.7 ms median** from click to reply text in the DOM, with zero chat POSTs. These timings measure the tool and rendering on one test machine, not the speed of an end user's device.
- We kept the existing mmap configuration after a six-run Vercel builder comparison (`dpl_9v6mA6tg2AmA135VRpwcUxJgWYFF`): median fresh-process first text was **2,415 ms** with default mmap and **2,472 ms** with lazy mmap, with similar peak memory. No reason to switch to lazy mmap or bypass the native checks.
