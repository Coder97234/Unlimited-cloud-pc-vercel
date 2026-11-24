# Run Helio with your local models

Helio 1 uses the bundled Qwen engine. **Helio 2–4** use installed text-chat weights from an operator-configured Ollama or llama.cpp runner. **Helio 5** is a separate, pinned reasoning tier. Missing weights or an unreachable runner make a tier unavailable; a Helio request never falls back to a smaller model, a sample, or a paid model API.

This is inference on the machine running the model, not in the visitor’s browser. Free-to-download weights don’t make hardware, electricity, or hosting free. Use a dedicated inventory and test actual chat on the target machine: an inventory listing does not prove a model will fit in memory, load successfully, or meet your quality and latency needs.

## CPU starter profile (Helio 2–4)

Install dependencies with `npm ci` and use a recent [llama-server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server) with router mode and Qwen3.5 support. This starter profile uses text only, one loaded model and one generation slot. It needs about 5.6 GB on disk for weights, plus temporary staging space; the largest model alone uses 2.74 GB of weights plus runtime memory. Start with a short context, and allow for slower first replies on CPU.

| Tier | Installed GGUF alias | Model license |
| --- | --- | --- |
| Helio 2 | `Qwen3-0.6B-Q4_K_M` | Apache-2.0 |
| Helio 3 | `Phi-3.5-mini-instruct.Q4_K_M` | MIT |
| Helio 4 | `Qwen3.5-4B-Q4_K_M` | Apache-2.0 |

From the repository root:

```sh
npm run build:helio
```

The setup script downloads the quantizer’s pinned revisions listed in [`scripts/helio-profile.mjs`](../scripts/helio-profile.mjs). It checks byte counts and SHA-256, and only then installs each complete GGUF into `.cache/xyvora-helio/models`. It reuses verified files. On a machine without access to the download host, bring the same three complete GGUFs into a directory and run `npm run build:helio -- --from-dir /path/to/ggufs`; the same checks apply. Weights are not checked into Git, served to browsers, downloaded during chat, or included in the Vercel bundle.

In a terminal on the inference machine, run this from the repository root. Adjust the thread count for your CPU if needed. The private bearer key goes in a local file, not Git:

```sh
state="$PWD/.cache/xyvora-helio"
umask 077
test -s "$state/runner.key" || openssl rand -hex 32 > "$state/runner.key"
LLAMA_CACHE="$state/runner-cache" LLAMA_API_KEY="$(cat "$state/runner.key")" \
  llama-server --host 127.0.0.1 --port 11439 --models-dir "$state/models" \
  --models-max 1 --parallel 1 --ctx-size 3072 --batch-size 256 --ubatch-size 128 \
  --threads 2 --threads-batch 2 --n-gpu-layers 0 --flash-attn on \
  --cache-type-k q8_0 --cache-type-v q8_0 --no-warmup \
  --offline --no-mmproj --no-ui --reasoning off --reasoning-format deepseek \
  --cors-origins localhost --no-cors-credentials
```

If the runner build does not accept `--no-ui`, update it or use its older `--no-webui` spelling. Use `LLAMA_API_KEY` so router children inherit authentication too. Do not start router mode with `-m` or expose router or child ports. Use a dedicated cache so it does not pick up unrelated weights. In another terminal, start Xyvora:

```sh
export XYVORA_SERVER_MODELS=1 XYVORA_LOCAL_RUNNER=llama.cpp XYVORA_LOCAL_PORT=11439
export XYVORA_LOCAL_MAX_TOKENS=224  # Max Effort ceiling; lower effort levels get smaller budgets
export XYVORA_LOCAL_KEY="$(cat .cache/xyvora-helio/runner.key)"
export XYVORA_LOCAL_TIERS='{"helio-2":["Qwen3-0.6B-Q4_K_M"],"helio-3":["Phi-3.5-mini-instruct.Q4_K_M"],"helio-4":["Qwen3.5-4B-Q4_K_M"]}'
npm run dev -- --host 127.0.0.1
```

Open the address printed by Vite. `XYVORA_SERVER_MODELS=1` disables the labeled Helio 1 sample; to enable real Helio 1, stage its weights with `npm run build:models` and install a supported `node-llama-cpp` CPU binding. Helio 2–4 are independent of that bundle. New chats prefer the lowest available live tier. No Xyvora account or model-provider API key is needed for chat on this machine.

Run `npm run check:helio-live -- http://127.0.0.1:5173` against this profile to check real replies, exact engine IDs, and completed SSE streams. This is a smoke check, not a benchmark. To diagnose an unavailable tier, inspect the runner’s authenticated `GET /models` and check that the exact alias is listed with source `models_dir` or `cache` and text input/output modalities. Test chat rather than relying on unloaded entries alone. Restart the runner or use its local inventory refresh after changing the staged files; Xyvora itself does not call management endpoints.

## Use another installed model inventory

You can put the server-only settings in `.env.local`, then restart the app. For llama.cpp, use trusted, complete, text-chat GGUFs and start router mode offline as above. Unfinished files, failed entries, known embedding modes and presets are not routed. For [Ollama](https://github.com/ollama/ollama), use a recent release with the cloud status API. Start or restart the daemon with cloud mode off:

```sh
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NO_CLOUD=1 \
  OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NUM_PARALLEL=1 ollama serve
```

Install your desired chat models in Ollama before serving traffic. `GET /api/status` must report `cloud.disabled: true`; `ollama list` should show the installed weights. Xyvora uses `XYVORA_LOCAL_RUNNER=ollama`, default port `11434`; for `llama.cpp` the default is `8080`. Change `XYVORA_LOCAL_PORT` for a different loopback port. Ollama’s optional `XYVORA_LOCAL_MAX_MODEL_BYTES` limits installed weight size by tag. Cloud and weightless tags and models without text completion capability are excluded. Xyvora does not pull models, create tags, or request cloud web search.

- **Automatic grouping:** when no mapping is set, Helio 2–4 group the eligible inventory by reported parameter count, size hint, weight size or alias. That is a rough order, not a quality ranking. A tier with an empty pool stays unavailable. Requests rotate within a pool, one model per turn, with identical Ollama digests counted once. Discovery checks up to 512 entries and refreshes on demand after ten seconds.
- **Exact mapping:** `XYVORA_LOCAL_TIERS` replaces grouping with an allowlist of exact aliases, as in the CPU example. Use the `id` from llama.cpp or the full Ollama tag, including `:latest` when shown. Do not list the same alias twice. Your selected tier does not change when its inventory changes.
- **Generation limits:** set `XYVORA_LOCAL_MAX_TOKENS` (1–3,600) to reduce standard-tier output on slow hardware. Low through Extra use smaller fractions of that ceiling; without the setting, the normal effort budgets apply. A request still has a time limit; cold weight loading and long input can be slow even with a short reply. Use “This message only” or reduce included context if you hit the runner’s context limit. The app allows one runner generation per process and forwards Stop; enforce concurrency on the runner too.

`GET /api/chat` lists available branded IDs. A non-tool `POST /api/chat` can return `X-Xyvora-Source: server`, `localModel` provenance and SSE ending in `[DONE]`. An unavailable model returns `503 MODEL_UNAVAILABLE` before generation; a failure during a stream is reported in the stream, never silently retried on another model. Exports preserve the branded selection and the local alias used. Earlier hosted selections remain readable but require a new choice before continuing or retrying.

## Helio 5: dedicated reasoning runner

Provision a larger **offline Ollama** runner separately. Helio 5 requires the exact installed tag, matching manifest digest, completion and thinking capabilities, and at least 20B parameters reported by the runner. That threshold prevents accidental routing to a lightweight model; it is not a benchmark or a quality guarantee. The CPU starter profile does not enable Helio 5.

One candidate to evaluate is [`qwen3.8:27b`](https://ollama.com/library/qwen3.8) (about 18 GB for its quantized weights alone, before runtime and context). Run your own quality and latency checks for coding, reasoning and your expected workloads. No Claude Fable 5 parity is claimed. Neither the starter setup nor chat pulls this model for you.

On suitable hardware, start a dedicated daemon with `OLLAMA_NO_CLOUD=1`, `OLLAMA_HOST=127.0.0.1:11435`, `OLLAMA_NUM_PARALLEL=1`, and `OLLAMA_MAX_LOADED_MODELS=1`. Install a suitable model there during setup. Read the full 64-hex `digest` and exact `model` name from the installed model’s row in `GET /api/tags`; this is an **Ollama manifest digest**, not the SHA-256 of a raw GGUF. Check `POST /api/show` for `completion`, `thinking`, and `model_info['general.parameter_count']`. Configure the app and restart it:

```dotenv
XYVORA_HELIO5_PORT=11435
XYVORA_HELIO5_MODEL=qwen3.8:27b
XYVORA_HELIO5_DIGEST=your_installed_manifest_digest
```

Keep the tag immutable while serving traffic. A change to the digest, cloud mode, or capabilities disables dispatch until the checks pass again; update the pin only after verifying a deliberate upgrade. Helio 5 is never auto-populated from Helio 2–4. Effort sets a bounded budget for the combined answer and reasoning and requests only levels the runner reports as supported. Low asks for thinking to be off when allowed; a runner not advertising suitable controls keeps its defaults. Separate reasoning frames are not shown or stored as answer text. Test an actual reply at each effort before exposing the tier.

## Use an operator-owned runner from Vercel

Vercel loopback cannot reach a workstation or its weights. Helio 1 still uses Vercel’s staged bundle. To enable other tiers on Vercel, run inference on **hardware you operate** and reach it through a dedicated authenticated HTTPS gateway. If you want prompts to stay on your machine, run both Xyvora and its runner there instead.

1. Keep the raw runner private. On the gateway, require a dedicated bearer secret of at least 32 characters. Allow only `GET /api/status`, `GET /api/tags`, `POST /api/show` (Ollama), or `GET /models` (llama.cpp), plus `POST /v1/chat/completions`. Strip or reject unexpected query parameters; do not proxy management or download endpoints. Pass SSE through unbuffered and propagate disconnects. Apply capacity, size, logging and retention controls. Do not proxy a paid model service.
2. Set `XYVORA_LOCAL_GATEWAY_URL` (Helio 2–4) or `XYVORA_HELIO5_GATEWAY_URL` (Helio 5) to the appropriate HTTPS origin, and set the matching server-only `XYVORA_LOCAL_KEY` or `XYVORA_HELIO5_KEY`. Omit the corresponding `*_PORT`. Use protected staging environment variables, not `VITE_*`, Git, or browser code. Xyvora never follows redirects. Neither the browser nor the Vercel bundle contains these runners’ model files.
3. Verify protection/update-lock behavior, real replies, cancellation and the stopped-runner behavior before production use. Leave the legacy hosted API off unless you intentionally serve an older signed-in client. No legacy provider key is used by the Helio selector. If enabled, SearXNG gets only the selected lookup query; that is separate from inference.
