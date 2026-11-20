# Xyvora AI

[Xyvora AI](https://xyvora.net) is a chat and tools workspace. **Normal** is the default for new chats. **Instant** prioritizes a quick, short reply with at most one small preceding exchange and a 96-token chat reply limit. Explicit translation keeps Normal’s longer output budget. **Thinker** asks the assistant to check assumptions and explain a conclusion; **Pro** asks for practical steps and verification; **Creative** uses more varied sampling for ideas and stories. These modes change instructions and generation settings, not the underlying engine or tool permissions. Earlier conversations remain readable in local history.

The welcome screen and animated frog keep the supplied Xyvora art. The welcome logo has a responsive HD version. Download the transparent **3840 × 1284** light and dark lockups from **About**. These are sharpened, high-resolution exports of the supplied artwork, not a new mascot or vector tracing. Reduced-motion preferences still disable the frog’s hop and blink.

## Public pages and employee email

- [Meet the Xyvora team](https://xyvora.net/about) is the public credits page. The chat identity reply uses the same team data. The About and [For schools](https://xyvora.net/schools) pages are static HTML and don’t require JavaScript.
- [Sitemap](https://xyvora.net/sitemap.xml) lists the canonical public pages and is referenced by [robots.txt](https://xyvora.net/robots.txt). Submit the sitemap URL through the domain’s search console if desired.
- If a school blocks the domain, give a teacher or administrator the URL, block message, and intended classroom use and ask for a review. The For schools page explains the site’s privacy and network requirements; it does not change a school’s filters.
- [Employee email setup](docs/employee-email.md) records the proposed addresses and how to add them with the existing mail administrator without disturbing current mail.

## Chat tools

Ask naturally, or send `/tools` for examples. There are no dedicated Skills or Local time buttons.

| Tool | Example | Runs on |
| --- | --- | --- |
| Calculator and conversions | `What is 18% of 84.50?`, `Convert 5 miles to km` | Your device |
| Tip split and calendar math | `/split 84.50 + 18% / 3`, `/date 2028-02-28 + 3 days` | Your device |
| Text and structured data | Attach a CSV and ask `Inspect this CSV`, or try `/json`, `/jsonpick /items/0`, `/text`, `/comparelists`, `/base64`, `/url`, `/case upper`, or `/lines unique` | Your device |
| Live clock | `What time is it in Tokyo?` or `/time Tokyo` | Server clock, no model |
| Web search | `/search NASA Artemis program` or enable Web search for a prompt | Server and search indexes |
| Writing, translation, planning | `/summarize`, `/rewrite`, `/translate Spanish: Hello!`, `/plan learn guitar in two weeks` | Server |

Attach or drop up to **three files** (4 MB each): text, code, data files, and text-based PDFs. Text extraction happens on the device. PDFs are limited to the first six pages; scanned pages need OCR beforehand. Up to 8,000 characters of combined extracted text are available to tools. The server may use a shorter excerpt to fit the chat context. Use the download icon in an open chat to export prompts, replies, and links as Markdown. File bodies aren’t exported as attachments, but replies can quote them.

Web search uses the keyless, rate-limited [Wiby](https://wiby.me/json/) and [English Wikipedia](https://www.mediawiki.org/wiki/API:REST_API/Reference#Search_pages) indexes. The submitted search query alone goes to those indexes. The clock uses the browser’s time zone unless you ask for another, or UTC for direct API requests that omit it.

## Plugins and approvals

Open **Plugins** (`Ctrl`/`⌘` + `/`) or ask in chat. The current user message can open a review panel; assistant replies, attached text, and provider output never initiate an action. Nothing runs just by opening a panel.

- **Script Lab** — `/run console.log(20 * 6)`. Review and run synchronous JavaScript in a QuickJS WebAssembly engine inside a disposable browser worker. No shell, packages, network, DOM, storage, or account access. Each run has a time, memory, input, and output limit. Attached text is opt-in as `input`. A complete attached `.js`/`.mjs` file can be loaded into the editor with `Run the attached JavaScript`.
- **Image Studio** — `/image Violet mountains at dusk`. Generate and download 4K abstract posters locally, without uploading a prompt. The separate **AI images** tab can generate a 1024 × 1024 image through a configured provider. It requires explicit approval and a studio access code.
- **API Explorer** — `/api https://api.github.com/repos/octocat/Hello-World`. Review the exact GET before sending. Only public GitHub repository and latest-release endpoints are accepted; no custom destinations, methods, headers, redirects, or keys. Only selected response fields are shown as text.
- **Gmail** — “Show my latest Gmail messages.” Once connected, approve reading up to five inbox messages’ subject, sender, and date. No bodies, drafts, or sending.
- **Vercel** — “List my Vercel projects.” Once connected, approve reading the profile or listing up to eight projects in the authorized context. Project access requires the provider’s resource-read grant. No deployment, project, or environment changes.

Script and public API results can be placed in a draft; they are never sent to chat automatically. Account results stay in the plugin window and aren’t added to history or model context.

### Configure account connections and hosted images (optional)

Local chat tools, graphics, Script Lab, and the public API Explorer do not require OAuth credentials. The Arena Gmail and Vercel connections are **not** credentials for the public Xyvora app.

1. Set `XYVORA_WORKSPACE_ORIGIN` to the app’s exact HTTPS origin (defaults to `https://xyvora.net`). Configure a dedicated random `XYVORA_CONNECT_SECRET` (at least 32 characters; for example `openssl rand -hex 32`). Register **`https://xyvora.net/api/workspace`** as the OAuth callback for each app, substituting your configured origin. Don’t configure production credentials on unrelated preview origins.
2. **Gmail:** Enable the Gmail API and register a web OAuth client. Set `XYVORA_GMAIL_CLIENT_ID` and `XYVORA_GMAIL_CLIENT_SECRET`. The app asks for the restricted [`gmail.metadata` scope](https://developers.google.com/workspace/gmail/api/auth/scopes); use configured test users until the consent screen, required verification, and applicable security requirements are completed.
3. **Vercel:** Register a [Sign in with Vercel app](https://vercel.com/docs/sign-in-with-vercel) configured for `openid` and `profile`, with a client secret. Set `XYVORA_VERCEL_CLIENT_ID` and `XYVORA_VERCEL_CLIENT_SECRET`. If your app has access to [resource permissions](https://vercel.com/docs/sign-in-with-vercel/scopes-and-permissions), grant only **read** access to Projects for project listing. Profile sign-in alone does not authorize the Projects API.
4. **Hosted images:** Set `XYVORA_IMAGE_API_KEY` to a dedicated OpenAI project key with Images permission and `XYVORA_IMAGE_ACCESS_CODE` to a separate random code, at least 24 characters. Configure provider spend controls before enabling. Only the approved prompt is sent. The local rate limiter is **per instance**, not a shared spend cap. Don’t publish the access code or share any setup secrets in chat.

Set values as sensitive server environment variables in Vercel and redeploy. Do not use a `VITE_` prefix. The service stays disabled for a provider until it is configured for the current origin. OAuth uses PKCE and state; access tokens are encrypted/authenticated in host-only, HttpOnly, Secure cookies for at most an hour. No refresh tokens are kept. Disconnect clears the browser session and attempts provider revocation; permanent grants can also be removed in the provider’s account settings.

## Run locally

```sh
npm ci --ignore-scripts
npm run dev
```

The local preview uses labeled sample replies. The built-in tools, clock, script sandbox, file input, and local graphics work there. Set `XYVORA_SERVER_MODELS=1` in `.env.local` for live inference and Web search. This needs a supported `node-llama-cpp` CPU binding and access to the model/search hosts. Run `npm run build:models` to stage the verified weights, or let the first local live request download them.

## Deploy to Vercel

Use **xyvora-ai** with **xyvora.net** as its production domain. `vercel.json` configures the Vite build and two Node functions. The small workspace function never imports the chat engine. If deploying via a source bootstrap, include both `api/chat.js` and `api/workspace.js` before extracting the pinned checkout so function discovery can see them.

- The backend uses a compact Q4_0 GGUF of Apache-2.0 [Qwen 2.5 0.5B Instruct](https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF), pinned to a revision and checksum. No weights are sent to browsers or checked into Git. The function maps its verified weights and reuses only the fixed system-prompt prefix between requests.
- The weights exceed the standard bundle limit; use [Large Functions](https://vercel.com/docs/functions/limitations#large-functions) with Fluid compute and Active CPU. Older projects may need `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`. `npm run build` needs no weight download; `npm run build:models` stages weights separately.
- The asset bundle lazy-loads Markdown, plugins, the PDF parser, and the script worker. Its one WASM file is the local JavaScript sandbox, **not** a model or inference runtime. Production has a same-origin Content Security Policy.

## Privacy and API

Chat history stays in the browser. On-device tool turns are skipped in future requests. Ordinary replies can send the prompt, limited recent context, extracted attachment text, and browser time zone to the server. Don’t put private data in search queries. Source links provide attribution, including Wikipedia’s [CC BY-SA license](https://en.wikipedia.org/wiki/Wikipedia:Copyrights).

`GET /api/chat` reports Xyvora’s identity, modes, tools, and availability. `POST /api/chat` accepts alternating `messages` ending with a user message, optional `model: "xyvora"`, `mode` (`normal`, `instant`, `thinker`, `pro`, `creative`), `timeZone`, `searchQuery`, and `attachment: {name, text}`. Older requests and saved chats still work. Replies stream as SSE with `[DONE]` on success. `X-Xyvora-Source` and `X-Xyvora-Skill` report the reply’s origin.

`GET /api/workspace` reports connection and hosted image availability or completes an OAuth state/code callback. `POST /api/workspace` accepts only same-origin JSON with `approved: true`; separate checks enforce the request registry, account session, provider configuration, and size and rate limits. Plugins cannot send arbitrary API calls, write to connected accounts, or access the chat model.

## Checks

```sh
npm test
npm run build
npm run check:site
# Or verify deployed HTTP statuses and content types:
npm run check:site -- https://xyvora.net
node --experimental-strip-types scripts/smoke-chat.mjs https://xyvora.net
```

After staging the weights, `VERCEL=1 node --experimental-strip-types scripts/check-bundle.mjs` checks the actual bundled handlers, native modes, tools, and cancellation. `--search` tests the real search indexes and `--plugins` runs one real read-only API Explorer GET. OAuth and hosted-image tests use fixture provider responses; actual consent and paid image generation require separate credentials. There are no account credentials in fixtures.

Run `VERCEL=1 node --experimental-strip-types scripts/bench-instant.mjs --bundle` in a fresh process with staged weights, or pass an HTTPS origin instead of `--bundle` to measure across HTTP. It alternates Normal and Instant for the same short question, with and without older chat history, and reports first text and completion separately. Run the live benchmark separately from the smoke to stay within the chat rate limit.

## Instant release measurements

`3641e7a` shares Normal’s cached system prompt and adds a short brevity hint to the latest turn. Instant keeps at most one previous exchange (up to 1,200 characters) and reserves 96 output tokens for ordinary chat. The engine and its cold-load path are unchanged.

The benchmark alternated modes for the same one-sentence geography question. The older-context case included a synthetic inventory and a recent exchange. All samples returned the correct answer in seven text deltas. Each entry shows the median of three requests, **first text / completion**:

| Input | Normal (bundled) | Instant (bundled) | Normal (live HTTP) | Instant (live HTTP) |
| --- | ---: | ---: | ---: | ---: |
| New chat | 122 / 323 ms | 152 / 354 ms | 385 / 717 ms | 381 / 732 ms |
| Older chat history | 2,703 / 2,943 ms | 240 / 455 ms | 8,712 / 9,165 ms | 569 / 940 ms |

The warm, in-process measurements ran in production build `dpl_CTewadQk7iNoa9Vx6Avni2gurK3B` after one startup request (1,996 / 2,198 ms). The live HTTP sample ran from Vercel's US East build region in report-only job `dpl_AD7nQTqQ4acVLjnJXi6uGGXDD4Ed` after the production alias was assigned. Live numbers include network and instance routing; they do not isolate cold starts. One new-chat Instant request took 3,473 / 3,828 ms. Instant avoids processing older turns, but it does not increase decoding speed or always beat Normal on a fresh small prompt.

The same public report verified `200 application/xml` for the sitemap, `200 text/plain` for robots, `200 text/html` for all three listed pages, a 404 for an unknown path, the `www` redirect, and working site assets and chat streams.

## Previous release measurements

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

Live comparison on `xyvora.net`, five identical short prompts (31 characters and seven deltas per reply):

| HTTP measurement | Previous `e3fd665` | Skills release `491cb06` |
| --- | ---: | ---: |
| First request, time to first text | 3,888 ms | 6,132 ms |
| Median time to first text | 288 ms | 489 ms |
| Median time to complete | 759 ms | 988 ms |
| Median time from first to last text | 339 ms | 352 ms |

These small regional samples include mixed startup states. They show a faster tool path and a smaller initial app payload, **not** faster general Qwen inference. The packing-list prompt completed in 7.94 s instead of 12.95 s, but it generated 159 instead of 217 deltas. Cold starts remain the main latency cost. The live API calculator completed in 65 ms; in the 390 px Chromium test the on-device calculator took 5.3 ms median to show text and made no chat POSTs.

The pre-change regional benchmark used `dpl_PhDeuhTeV2MrADmj6jeFubVzVqaQ`. The live checks used `dpl_GSiiMHSZbf6FL1WX4DAwvD1dR7MU` against `dpl_8DCGNM1TF1eyAvCqwQXnL1VVWN1c` on the apex domain. Mobile checks covered the Skills picker, Xyvora identity link, private tool-history exclusion, clock, and a real Qwen translation. The HTTP smoke test also verified source retrieval and rejected the retired model ID.

### Qwen startup and mascot release

The pinned CPU backend normally runs temporary native allocations to estimate model and context memory. For the verified, bundled Qwen file and this exact CPU configuration, Xyvora uses conservative memory estimates and keeps the backend's RAM checks and allocation tracking. Other configurations fall back to the native estimation path. Set `XYVORA_QWEN_MEMORY_SIMULATION=1` to use native estimation for this bundle too.

In a controlled Vercel **builder** test (`dpl_FFRnQPYXwKLVjSbywRpLsTHefinq`), three alternating pairs of fresh two-thread processes mapped the same weights with a shared OS file cache:

| Median | Native simulation | Planned memory |
| --- | ---: | ---: |
| First text after process startup | 2,819 ms | 2,068 ms |
| Short reply finished | 3,069 ms | 2,312 ms |
| Peak RSS | 881 MiB | 812 MiB |
| Long decode | 28 tokens/s | 28 tokens/s |

In all pairs, greedy reply hashes and token counts matched. The gain is in startup, not sustained generation. Reproduce the comparison after staging the pinned weights with `node --experimental-strip-types scripts/bench-qwen.mjs --threads=2 --samples=3`. These process timings exclude HTTP and are separate from the live measurements.

Live HTTP on `xyvora.net`, from Vercel's `iad1` region, with the same five short prompts (31 characters and seven deltas per reply):

| Short reply measurement | Before `491cb06` | Released `af03bfa` |
| --- | ---: | ---: |
| First request: first text | 3,380 ms | 3,052 ms |
| First request: complete | 3,769 ms | 3,406 ms |
| Median first text | 373 ms | 378 ms |
| Median complete | 747 ms | 780 ms |

The first request was faster in this sample; the median was essentially unchanged. These are small samples with mixed instance reuse, not isolated cold-start measurements. The longer prompt got text in 368 ms and completed in 12.76 s on the release (232 deltas), vs. 3.69 s and 13.42 s before (185 deltas). Different reply lengths and instance startup states make the long samples unsuitable for comparing decode speed.

Production deployment `dpl_46u5HjTc216S1tKfabzPMX77h7q2` passed native Qwen, context reuse, cancellation recovery, translation, and search in its build. The separate report `dpl_4JgTZZnSuDzBwRxsSrDKk6aGvqw6` verified the deployed art bytes, Qwen SSE, identity, calculator, clock, and four live search sources on the public domain. A 390 px dark-mode Chromium run measured **301 ms to first on-screen text and 684 ms to completion** for one short reply, with word-driven motion in both the composer and the real stream. The local desktop and mobile checks also covered partial-word streaming, reduced motion, and narrow composer controls.
