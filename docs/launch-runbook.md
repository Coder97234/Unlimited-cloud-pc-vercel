# Xyvora AI launch runbook

The app can run in guest mode without external credentials. The launch candidate does not create a database, an email sender, OAuth apps, or paid resources. A connected Vercel or Gmail account in Arena does not give the website its own provider credentials.

## 1. Provision and migrate PostgreSQL

Use an operator-owned database with verified TLS, encrypted backups, and connection limits. Apply `database/001_platform.sql`, then `database/002_launch.sql`, using the schema owner. Grant `USAGE` on the schema plus `SELECT, INSERT, UPDATE, DELETE` on the `xyvora_*` tables to a dedicated app role. Give the worker a **different** connection limited to `SELECT, UPDATE` on `xyvora_jobs` and `SELECT, INSERT, UPDATE` on `xyvora_worker_health`. The roles do not need create/alter/drop permission. Apply changes to staging first; take a backup before running migrations on existing production storage. Schedule `database/maintenance.sql` daily for expired sessions, OAuth requests, recovery links, throttles, tasks, and analytics data.

In the Vercel project’s **Production** environment, add `XYVORA_DATABASE_URL` (sensitive, preferably pooled, e.g. `sslmode=verify-full` if supported by the provider) and `XYVORA_ACCOUNT_ORIGIN=https://xyvora.net`. Use a separate database, variables, and exact callback origin in staging. Never commit values or share them in chat. Analytics reads this database independently of sign-in. `/analytics` displays `0` for actual zero traffic and hides the report when storage is unavailable; do not seed the production report with demo counts. Review the privacy policy and provider retention/backup settings before collecting data.

## 2. Enable email and social sign-in

- Verify a sending domain in Resend and set up its sender DNS. Add `XYVORA_MAIL_FROM` (the verified sender), `XYVORA_MAIL_API_KEY` (sending key), and a dedicated random `XYVORA_AUTH_SECRET` (32 or more characters) in server settings. Set `XYVORA_ENABLE_PASSWORDS=1` only when email delivery is ready. A user verifies a mailbox before setting a password. Links are single-use, expire after 30 minutes, and travel in URL fragments. Password reset revokes that account’s existing sessions. Existing username accounts can still sign in with their username, but need a verified email account for recovery.
- Create separate Google and GitHub OAuth apps with the exact redirect URI **`https://xyvora.net/api/account`**. Set `XYVORA_LOGIN_GOOGLE_ID`, `XYVORA_LOGIN_GOOGLE_SECRET`, `XYVORA_LOGIN_GITHUB_ID`, and `XYVORA_LOGIN_GITHUB_SECRET`. Identity OAuth is separate from private plugins. Google and GitHub accounts are not silently merged even when email addresses match. Additional Discord sign-in is optional.
- Test signup, delivery and reset in a mailbox you control. Confirm the new password works and another signed-in browser is rejected after reset. On a second device, check history, preferences, and memory. Deleting an account must remove its synced history, settings, memory, tasks and sessions; deletion does not recall exports or remove independently retained backups. Guest and Temporary chats do not sync. Sign-in and password form controls only appear when the corresponding services are enabled.

Synced history is limited to 24 chats, 30 turns per chat, and 2 MB of serialized data. The workspace reports a full history instead of silently dropping chats. Download a chat before deleting if you need a backup. A revision check merges independent changes; overlapping changes require a choice. Signed-in accounts can save up to 100 notes (10,000 characters total); the model uses only a bounded selection of recent notes. Guest notes keep their smaller in-browser limit. Attachment text excerpts in saved signed-in chats sync; original PDF/image files do not. Analytics consent is per browser and is never synced.

## 3. Run the durable text queue

On an always-on Linux service, install Node and the supported CPU binding, build and stage the model (`npm run build:models`), set `XYVORA_DATABASE_URL` to the limited worker connection and set `XYVORA_ENABLE_BACKGROUND=1`. Run `npm run worker` under a supervisor that restarts failed processes and gives a short graceful shutdown on deployment. The worker warms the model before marking itself ready. Once the worker is healthy, enable `XYVORA_ENABLE_BACKGROUND=1` for Vercel as well. You do **not** need a public worker HTTP endpoint or a Vercel Cron schedule.

The API enqueues only approved text prompts. The queue lives in PostgreSQL; leases prevent duplicate results, expired leases can be reclaimed, and failures retry with backoff up to three attempts. One queued/running task per account. It has no access to plugins, files, saved memory, or paid APIs. Monitor model startup, heartbeat, queue age, failures and database usage. A stale heartbeat pauses new submissions. Test by closing the submitter’s tab, restarting a worker during a task, then checking the result and cancellation from a second session.

## 4. Make a release decision on media and plugins

- Keep `XYVORA_GMAIL_PLUGIN_ENABLED` / `XYVORA_VERCEL_PLUGIN_ENABLED` off for v1 unless their separate OAuth clients, scopes and consent verification have been approved. Sign-in does not enable them. The cards and direct plugin views are hidden when disabled.
- For paid **AI images**, use a dedicated OpenAI project with budget alerts, set `XYVORA_IMAGE_API_KEY` and a separate `XYVORA_IMAGE_ACCESS_CODE`, and test one approved generation. Set `XYVORA_ENABLE_VISION=1` only if image analysis has also been approved/tested. No shared provider key or studio code in browser bundles. When hosted media is off, local graphics and local composer image previews still work.

## 5. Verify the candidate, then promote

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run check:site
```

On a test host, run a **built** preview with `XYVORA_LOCAL_PLATFORM=1` and distinct `XYVORA_LOCAL_PLATFORM_DIR=.cache/xyvora-launch-test` and `XYVORA_LOCAL_MAIL_DIR=.cache/xyvora-launch-test-mail` on port 4184. Run a second preview with no platform credentials on port 4185. Use the bundled mail catcher only with test data; files contain one-time links and are not served to browsers or committed. Install Chromium (`npx playwright-core install chromium`) or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Then:

```sh
npm run check:site -- http://127.0.0.1:4184
npm run check:browser -- http://127.0.0.1:4184 http://127.0.0.1:4185
```

These checks use sample inference, an isolated database and search/provider fixtures where noted. They do not verify external signup delivery, Google/GitHub user consent, live OpenAI access, or the capacity of a production worker. Recheck each enabled integration with test accounts in protected staging. Redeploy after changing server settings; verify `/`, `/about`, `/analytics`, `/developers`, `/status`, and native chat at `https://xyvora.net` after promotion. If optional dependencies fail, leave the features disabled; keep the previous production deployment available for rollback. Only request indexing of the canonical URLs and resubmit `/sitemap.xml` after the new pages are live. Metadata changes cannot force an immediate search snippet refresh.
