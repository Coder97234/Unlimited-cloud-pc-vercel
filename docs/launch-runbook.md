# Xyvora AI launch runbook

The app can run in guest mode without external credentials. The launch candidate does not create a database, an email sender, OAuth apps, or paid resources. A connected Vercel or Gmail account in Arena does not give the website its own provider credentials.

## 1. Provision and migrate PostgreSQL

Use an operator-owned PostgreSQL database with verified TLS, backups, and connection limits. For the hosted option, see [Supabase setup](supabase-setup.md); no Supabase API keys are required. Run `database/001_platform.sql`, `database/002_launch.sql`, then `database/003_server_access.sql` as the schema owner with role creation permission. The last migration gives the app and worker separate, scoped privileges and disables Data API roles for Xyvora tables. Set a different password for each needed role in a private admin session before enabling logins. If upgrading with differently named runtime roles, move to the scoped roles before enabling RLS in production. Back up before migrating and rehearse in staging. Schedule `database/maintenance.sql` daily for expired sessions, OAuth requests, recovery links, throttles, tasks, and analytics data.

In the Vercel project’s **Production** environment, add `XYVORA_DATABASE_URL` (sensitive, preferably pooled, e.g. `sslmode=verify-full` if supported by the provider) and `XYVORA_ACCOUNT_ORIGIN=https://xyvora.net`. Use a separate database, variables, and exact callback origin in staging. Never commit values or share them in chat. Analytics reads this database independently of sign-in. `/analytics` displays `0` for actual zero traffic and hides the report when storage is unavailable; do not seed the production report with demo counts. Review the privacy policy and provider retention/backup settings before collecting data.

## 2. Enable email and social sign-in

- Choose one email provider. With [Bird Mailboxes](bird-setup.md), set `XYVORA_MAIL_PROVIDER=bird`, `XYVORA_BIRD_MAILBOX_ID` and the Bird key (`BirDApi_Email` or `XYVORA_BIRD_API_KEY`) to deliver one-time codes that expire in 10 minutes. With Resend, leave the provider unset or set it to `resend`, verify the sending domain and set `XYVORA_MAIL_FROM` and `XYVORA_MAIL_API_KEY` for single-use links that expire in 30 minutes. Add a dedicated random `XYVORA_AUTH_SECRET` (32 or more characters) and set `XYVORA_ENABLE_PASSWORDS=1` only when delivery is ready. Reset revokes the account’s existing sessions. Existing username accounts can still sign in with their username, but need a verified email account for recovery.
- Create separate Google and GitHub OAuth apps with the exact redirect URI **`https://xyvora.net/api/account`**. Set `XYVORA_LOGIN_GOOGLE_ID`, `XYVORA_LOGIN_GOOGLE_SECRET`, `XYVORA_LOGIN_GITHUB_ID`, and `XYVORA_LOGIN_GITHUB_SECRET`. Identity OAuth is separate from private plugins. Google and GitHub accounts are not silently merged even when email addresses match. Additional Discord sign-in is optional.
- Test signup, delivery and reset in a mailbox you control. Confirm the new password works and another signed-in browser is rejected after reset. On a second device, check history, preferences, and memory. Deleting an account must remove its synced history, settings, memory, tasks and sessions; deletion does not recall exports or remove independently retained backups. Guest and Temporary chats do not sync. Sign-in and password form controls only appear when the corresponding services are enabled.

Synced history is limited to 24 chats, 30 turns per chat, and 2 MB of serialized data. The workspace reports a full history instead of silently dropping chats. Download a chat before deleting if you need a backup. A revision check merges independent changes; overlapping changes require a choice. Signed-in accounts can save up to 100 notes (10,000 characters total); the model uses only a bounded selection of recent notes. Guest notes keep their smaller in-browser limit. Attachment text excerpts in saved signed-in chats sync; original PDF/image files do not. Analytics consent is per browser and is never synced.

## 3. Run the durable text queue

On an always-on Linux service, install Node and the supported CPU binding, build and stage the model (`npm run build:models`), set `XYVORA_DATABASE_URL` to the limited worker connection and set `XYVORA_ENABLE_BACKGROUND=1`. Run `npm run worker` under a supervisor that restarts failed processes and gives a short graceful shutdown on deployment. The worker warms the model before marking itself ready. Once the worker is healthy, enable `XYVORA_ENABLE_BACKGROUND=1` for Vercel as well. You do **not** need a public worker HTTP endpoint or a Vercel Cron schedule.

The API enqueues only approved text prompts. The queue lives in PostgreSQL; leases prevent duplicate results, expired leases can be reclaimed, and failures retry with backoff up to three attempts. One queued/running task per account. It has no access to plugins, files, saved memory, or paid APIs. Monitor model startup, heartbeat, queue age, failures and database usage. A stale heartbeat pauses new submissions. Test by closing the submitter’s tab, restarting a worker during a task, then checking the result and cancellation from a second session.

## 4. Keep plugins paused for the sign-in release

- Leave `WORKSPACE_PLUGINS_ENABLED` off in `shared/workspace-tools.ts`. Leave `XYVORA_ENABLE_APP_CONNECTIONS` unset for a sign-in-only release. `/api/workspace` must then reject status, actions, and OAuth callbacks even if provider settings exist. Test opt-in read-only Gmail/Vercel connections in separate protected staging, never as a prerequisite for sign-in. Keep Zapier, Sheets, and paid media paused. Browser photo previews stay local.
- If plugins are later approved for a separate release, use the [provider setup and limits](../README.md#configure-read-only-connections-and-hosted-image-tools-optional). Sign-in credentials, provider approval, and any spending decision remain separate.

## 5. Verify the candidate, then promote

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run check:site
```

On a test host, run a **built** preview with `XYVORA_LOCAL_PLATFORM=1` and distinct `XYVORA_LOCAL_PLATFORM_DIR=.cache/xyvora-launch-test` and `XYVORA_LOCAL_MAIL_DIR=.cache/xyvora-launch-test-mail` on port 4184. Set `XYVORA_MAIL_PROVIDER=bird` on the local platform to exercise code entry instead of links. Run a second preview with no platform credentials on port 4185. Use the bundled mail catcher only with test data; files contain one-time codes or links and are not served to browsers or committed. Install Chromium (`npx playwright-core install chromium`) or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Then:

```sh
npm run check:site -- http://127.0.0.1:4184
npm run check:browser -- http://127.0.0.1:4184 http://127.0.0.1:4185
```

These checks use sample inference, an isolated database and search/provider fixtures where noted. They do not verify external signup delivery, Google/GitHub user consent, live OpenAI access, or the capacity of a production worker. Recheck the scoped PostgreSQL connection, delivery to an inbox you control, and the enabled sign-in flows with test accounts in protected staging before public signup. Leave passwords disabled until these checks pass. Redeploy after changing server settings; verify `/`, `/about`, `/analytics`, `/developers`, `/status`, and native chat at `https://xyvora.net` after promotion. If optional dependencies fail, leave the features disabled; keep the previous production deployment available for rollback. Only request indexing of the canonical URLs and resubmit `/sitemap.xml` after the new pages are live. Metadata changes cannot force an immediate search snippet refresh.
