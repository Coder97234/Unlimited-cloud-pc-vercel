# Xyvora AI

[Xyvora AI](https://xyvora.net) is a chat and tools workspace. **Normal** is the default for new chats. **Instant** prioritizes a quick, short reply with at most one small preceding exchange and a 96-token chat reply limit. Explicit translation keeps Normal’s longer output budget. **Thinker** asks the assistant to check assumptions and explain a conclusion; **Pro** asks for practical steps and verification; **Creative** uses more varied sampling for ideas and stories. These modes change instructions and generation settings, not the underlying engine or tool permissions. Earlier conversations remain readable in local history.

Orbit is Xyvora's violet, ringed robot mascot. The same small SVG renders in the welcome screen, composer, replies, and About. Orbit floats briefly at word boundaries and stays still with reduced motion. [About](https://xyvora.net/about) has the SVG and transparent **3840 × 1284** logos. Re-render the raster exports with `node scripts/render-brand.mjs` after installing Playwright Chromium.

## Chat controls

- **Temporary chat** (sidebar): chat without adding a conversation to this browser’s saved history. Ending it, switching chats, or reloading discards it. Server replies can still receive the current prompt, recent temporary exchanges, and attached text. Temporary does not mean offline or a guarantee about server logs.
- **Branch from reply** (under a finished reply) copies the chat through that exchange. **Edit prompt in a new branch** (next to a prompt) copies only the earlier turns and opens an editable draft. The original is unchanged. Neither action sends anything, and the copy is saved only after you send its first message. Branches are for saved chats, not temporary or archived comparisons.
- **Context → This message only** sends a question without earlier turns. That exchange is also skipped in future model context, including after switching back to **Recent chat** or branching. Retry respects both the saved exchange’s isolation and the current setting. It remains visible in the local chat and its Markdown export. The current prompt and attachment can still be sent; this setting doesn’t change tool permissions.

See the [feature roadmap](docs/product-roadmap.md) for existing capabilities, prerequisites, and next release tracks.

## Public pages and employee email

- [Meet the Xyvora team](https://xyvora.net/about) is the public credits page. The chat identity reply uses the same team data. The About and [For schools](https://xyvora.net/schools) pages are static HTML and don’t require JavaScript.
- [Sitemap](https://xyvora.net/sitemap.xml) lists the canonical public pages and is referenced by [robots.txt](https://xyvora.net/robots.txt). Submit the sitemap URL through the domain’s search console if desired.
- If a school blocks the domain, give a teacher or administrator the URL, block message, and intended classroom use and ask for a review. The For schools page explains the site’s privacy and network requirements; it does not change a school’s filters.
- [Employee email setup](docs/employee-email.md) records the proposed addresses and how to add them with the existing mail administrator without disturbing current mail.

## Chat tools

Xyvora answers recognized questions about its creators using the public team credits instead of generating an opinion. The server checks generated text before releasing each sentence or line, also covering translation, queued replies and image descriptions. These controls don’t prohibit criticism of the product. As with any language model, indirect or unrecognized references may not be caught; deterministic tool output can include text you supplied.

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

## Accounts, saved memory, and files

- **Sign in** from the top bar or **Create an account** from the welcome screen when accounts are enabled. Verify your email before setting a password; **Forgot password?** sends a recovery email. [Bird Mailboxes](docs/bird-setup.md) delivers one-time codes, while Resend sends links. Google, GitHub, and optional Discord sign-in only appear when enabled. Accounts are optional; choose **Continue as guest** to keep using chat on this device.
- Signed-in chats, theme, default reply mode, and up to 100 memory notes sync through PostgreSQL. Guest and Temporary chats do not sync. Use Workspace settings to import an older local copy from the same signed-in account, export chat as Markdown, or clear saved history. Use Memory to control whether a bounded set of recent notes can inform replies. Explicit translation, Temporary Chat, This message only, and image analysis do not use them.
- Attach or drop images, text-based PDFs, or code/text files in the composer to preview them locally. PDF previews show extracted text; scanned PDFs need OCR. Image analysis is paused; photo previews stay on-device and cannot be sent for a reply.
- Use `Cmd/Ctrl+K` to search chats, `Cmd/Ctrl+Shift+N` for a new chat, or `?` outside an input to view shortcuts. If the browser reserves a shortcut, the controls are also available in the sidebar and Workspace settings.

See the [production launch runbook](docs/launch-runbook.md) for database migrations, roles and retention, email verification/reset, OAuth, the worker, and the release checklist. For [Supabase setup](docs/supabase-setup.md), use scoped PostgreSQL roles and keep the Data API off the account data. No production service uses the local test database.

## Plugins (paused)

This release leaves the Plugins panel and its `/api/workspace` routes off. Account sign-in, guest chat, Web search, text/PDF attachments, and built-in tools such as `/calc` are separate. No Zapier or Sheets connection is needed.

The following are retained implementation notes for a future plugin release. When enabled, only the current user message can open a review panel; assistant replies, attached text, and provider output never initiate an action. Nothing runs just by opening a panel.

- **Script Lab** — `/run console.log(20 * 6)`. Review and run synchronous JavaScript in a QuickJS WebAssembly engine inside a disposable browser worker. No shell, packages, network, DOM, storage, or account access. Each run has a time, memory, input, and output limit. Attached text is opt-in as `input`. A complete attached `.js`/`.mjs` file can be loaded into the editor with `Run the attached JavaScript`.
- **Image Studio** — `/image Violet mountains at dusk`. Generate and download 4K abstract posters locally, without uploading a prompt. The separate **AI images** tab generates a square, landscape, or portrait JPEG through a configured OpenAI project. It requires explicit approval and a studio access code. **Analyze image** opens the chat attachment workflow.
- **GitHub projects** — `/repo octocat/Hello-World`. Approve public repository, file, and issue reads; choose a branch; edit a local copy; and review/download a unified diff. Grab a UTF-8 file under 24 KB to attach an excerpt to a chat draft. No push, PR creation, private repository access, or automatic code execution. Review patches before applying (for example, `git apply --check xyvora-repository.patch`).
- **API Explorer** — `/api https://api.github.com/repos/octocat/Hello-World`. Review the exact GET before sending. Public GitHub repository/latest-release endpoints and `https://registry.npmjs.org/package/latest` are supported; no custom destinations, methods, headers, redirects, or keys. Only selected response fields are shown as text.
- **Gmail** — “Show my latest Gmail messages.” Once connected, approve reading up to five inbox messages’ subject, sender, and date. No bodies, drafts, or sending.
- **Vercel** — “List my Vercel projects.” Once connected, approve reading the profile or listing up to eight projects in the authorized context. Project access requires the provider’s resource-read grant. Enter an optional team slug to read that granted scope. No deployment, project, or environment changes.

Script and public API results can be placed in a draft; they are never sent to chat automatically. Account results stay in the plugin window and aren’t added to history or model context.

### Configure read-only connections and hosted image tools (optional)

Do not configure these tools for the sign-in release. The shared `WORKSPACE_PLUGINS_ENABLED` release switch in `shared/workspace-tools.ts` must be deliberately changed before any of these settings can take effect. The Arena Gmail and Vercel connections are **not** credentials for the public Xyvora app.

1. Set `XYVORA_WORKSPACE_ORIGIN` to the app’s exact HTTPS origin (defaults to `https://xyvora.net`). Configure a dedicated random `XYVORA_CONNECT_SECRET` (at least 32 characters; for example `openssl rand -hex 32`). Register **`https://xyvora.net/api/workspace`** as the OAuth callback for each app, substituting your configured origin. Don’t configure production credentials on unrelated preview origins.
2. **Gmail:** Enable the Gmail API and register a web OAuth client. Set `XYVORA_GMAIL_CLIENT_ID` and `XYVORA_GMAIL_CLIENT_SECRET`; leave `XYVORA_GMAIL_PLUGIN_ENABLED=0` until approved for launch. The app asks for the restricted [`gmail.metadata` scope](https://developers.google.com/workspace/gmail/api/auth/scopes); use configured test users until the consent screen, required verification, and applicable security requirements are completed.
3. **Vercel:** Register a [Sign in with Vercel app](https://vercel.com/docs/sign-in-with-vercel) configured for `openid` and `profile`, with `client_secret_post` for the token exchange. Set `XYVORA_VERCEL_CLIENT_ID` and `XYVORA_VERCEL_CLIENT_SECRET`; leave `XYVORA_VERCEL_PLUGIN_ENABLED=0` until approved for launch. If your app has access to [resource permissions](https://vercel.com/docs/sign-in-with-vercel/scopes-and-permissions), grant only **read** access to Projects for project listing. Profile sign-in alone does not authorize the Projects API.
4. **Hosted images:** Set `XYVORA_IMAGE_API_KEY` to a dedicated OpenAI project key with Images permission and `XYVORA_IMAGE_ACCESS_CODE` to a separate random code (24–180 characters). For image analysis, also set `XYVORA_ENABLE_VISION=1` and allow the Responses endpoint. Generation uses `gpt-image-1`; analysis uses `gpt-4.1-mini`. Set provider usage limits and monitoring before enabling paid tools. Only approved image inputs are sent, with no chat history or saved memory. The local rate limiter is **per instance**, not a shared spend cap. Don’t publish the access code or share any setup secrets in chat.

Set values as sensitive server environment variables in Vercel and redeploy. Do not use a `VITE_` prefix. The service stays disabled for a provider until it is configured for the current origin. Plugin OAuth uses PKCE and state; plugin access tokens are encrypted/authenticated in host-only, HttpOnly, Secure cookies for at most an hour. No refresh tokens are kept. Disconnect clears the browser session and attempts provider revocation; permanent grants can also be removed in the provider’s account settings.

## Background tasks

The optional PostgreSQL-backed queue runs one approved text reply per account at a time, even after the tab closes. A supervised `npm run worker` process claims work using durable leases and retries interrupted jobs. View, cancel, or delete results for up to 30 days. Tasks have no access to plugins, scripts, saved notes, or hosted media. Background tasks are only shown when a worker is online. See the [runbook](docs/launch-runbook.md#3-run-the-durable-text-queue) for staging and enabling the worker.

## Run locally

```sh
npm ci --ignore-scripts
npm run dev
```

The local preview uses labeled sample replies. Built-in tools, the clock, on-device guest memory, and file previews work there without enabling plugins. Use `XYVORA_LOCAL_PLATFORM=1 npm run dev` to test password signup/reset, chat/settings/memory sync, task lifecycle, and actual local analytics using an embedded database in `.cache/xyvora-platform`. Local signup/recovery emails are written to `.cache/xyvora-platform-mail`, not sent to a provider. Set `XYVORA_MAIL_PROVIDER=bird` too to test the six-digit code flow with the mail catcher. This mode is only for local or disposable Arena previews; use test credentials. It does not prove cloud persistence or live OAuth. Hosted provider actions need an exact HTTPS origin and provider setup. Set `XYVORA_SERVER_MODELS=1` in `.env.local` for live inference and Web search. This needs a supported `node-llama-cpp` CPU binding and access to the model/search hosts. Run `npm run build:models` to stage the verified weights, or let the first local live request download them.

## Deploy to Vercel

This release defaults to a private update window on Vercel. Set the generated, sensitive `XYVORA_UPDATE_KEY` before building. See the [update-lock runbook](docs/update-lock.md) for preview, production verification, rotation and reopening. The shared preview password is separate from account sign-in.

Use **xyvora-ai** with **xyvora.net** as its production domain. `vercel.json` configures the Vite build and four Node functions. Account, analytics, and workspace functions do not import the native chat engine. If deploying via a source bootstrap, include `api/chat.js`, `api/account.js`, `api/analytics.js`, and `api/workspace.js` before extracting the pinned checkout so function discovery can see them.

- The backend uses a compact Q4_0 GGUF of Apache-2.0 [Qwen 2.5 0.5B Instruct](https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF), pinned to a revision and checksum. No weights are sent to browsers or checked into Git. The function maps its verified weights and reuses only the fixed system-prompt prefix between requests.
- The weights exceed the standard bundle limit; use [Large Functions](https://vercel.com/docs/functions/limitations#large-functions) with Fluid compute and Active CPU. Older projects may need `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`. `npm run build` needs no weight download; `npm run build:models` stages weights separately.
- Markdown renders without a raw-text fallback, and the PDF parser loads on demand. No plugin or model resources run in the browser with plugins paused. Production has a same-origin Content Security Policy.

## Privacy and API

- [Terms of Use](https://xyvora.net/terms), [Privacy Policy](https://xyvora.net/privacy), and [Cookie choices](https://xyvora.net/cookies) describe the behavior of this release. Review policies, a private support channel, and retention/backups with the site owner before opening signup or collecting production metrics.
- [Usage analytics](https://xyvora.net/analytics) shows current registered accounts, distinct opted-in browsers today and over 30 UTC days, returning browsers (two or more active UTC days in that period), and an estimate of concurrent activity (opted-in browsers seen in the last two minutes). It also shows daily counts, not profiles or event logs. The app doesn’t attach identity, URLs, or prompts to the measurement. Without configured storage it displays **unavailable**, not synthetic activity. Opt out in Cookie choices to stop collection and remove identified activity.
- [Developer API](https://xyvora.net/developers) has curl examples, an interactive API playground, a human-readable [status page](https://xyvora.net/status), and a downloadable [OpenAPI document](https://xyvora.net/openapi.json). Outside the update window, the public text endpoint needs no API key and Xyvora does not charge for it. It has request, concurrency, and per-instance abuse limits, not a promise of unbounded capacity or third-party credits. It is intended for server-to-server requests; cross-origin browser calls are not supported.

Guest history stays in the browser; signed-in history syncs to the verified account. On-device tool turns are skipped in future requests. Ordinary replies can send the prompt, limited recent context, extracted attachment text, enabled memory notes, and browser time zone to the server. Don’t put private data in search queries. Source links provide attribution, including Wikipedia’s [CC BY-SA license](https://en.wikipedia.org/wiki/Wikipedia:Copyrights).

`GET /api/chat` reports Xyvora’s identity, modes, tools, and availability. `POST /api/chat` accepts alternating `messages` ending with a user message, optional `model: "xyvora"`, `mode` (`normal`, `instant`, `thinker`, `pro`, `creative`), `timeZone`, `searchQuery`, `attachment: {name, text}`, and `memory` (up to eight short user notes). Older requests and saved chats still work. Replies stream as SSE with `[DONE]` on success. `X-Xyvora-Source` and `X-Xyvora-Skill` report the reply’s origin.

`GET /api/account` checks sign-in providers and the browser session, or handles the OAuth callback. `/api/account?section=memory`, `?section=history`, and `?section=settings` require a verified session and serve that account only. There is no guest cloud storage.

`/api/workspace` currently returns an uncached `404` before handling old plugin actions, uploads, or OAuth callbacks. Sign-in uses `/api/account` and is not affected.

## Checks

```sh
npm test
npm run build
npm run check:site
# Or verify deployed HTTP statuses and content types:
npm run check:site -- https://xyvora.net
node --experimental-strip-types scripts/smoke-chat.mjs https://xyvora.net
```

After staging the weights, `VERCEL=1 node --experimental-strip-types scripts/check-bundle.mjs` checks the actual bundled handlers, native modes, tools, and cancellation. `--search` tests the real search indexes. The backend verifies that the plugin route is closed while paused; `--plugins` is only for approved live GitHub and npm reads in a future plugin-enabled build. Account, analytics, and task SQL tests use an embedded PostgreSQL-compatible store. OAuth, model worker, and hosted image tests use fixture responses. Actual consent, cloud memory, and paid image generation/analysis must be checked with your configured projects. There are no account credentials in fixtures.

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

## Platform release startup check

Chat capability and account status now load in parallel. The app still verifies the account before loading saved history. In Chromium at 390 × 844, five alternating trials with **240 ms of injected delay per API** reached a usable account button and “Chat ready” in **291 ms median**, versus **510 ms** with the same checks forced to wait on each other. This is a controlled UI-readiness check, not a public-site model latency or throughput result. Instant still uses the existing bounded context and response profile; the native smoke/benchmark measure time to first text and completion separately.

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

### Platform upgrade

See the [staging and activation guide](docs/platform-upgrade.md) for private projects, the paged conversation library, optional Supabase Auth, hosted text model provider setup, and research briefs. The guide lists cutover and rollback constraints and features not yet enabled or implemented.
