# Zapier MCP pilot for Xyvora

**Status: paused, not connected.** Do not configure Zapier or Sheets for the sign-in release. The steps below are retained for later review. If resumed, the first pilot is one explicitly approved Google Sheets row lookup against dummy data. It is not a published Zap, a shared team credential, or access to the entire Zapier tool catalog. Xyvora sign-in, Bird email verification, and the account database stay separate.

## Staging hostname and deployment

**The holding page is live at [connect-staging.xyvora.net](https://connect-staging.xyvora.net/).** The separate `xyvora-connect-staging` Vercel project reports deployment `dpl_HUpZVwc7GgFzZbeoF7FBezXrgSYJ` as Ready with the custom hostname assigned. The page was verified over HTTPS with the **HTTPS staging host** and **Not connected** badges. It acknowledges receipt of the public embed ID without publishing the value or asking for it again. No DNS changes are needed.

The holding page in `staging/zapier/` is safe to serve publicly: it includes no third-party script, account API, credentials, or Zapier connection. The main `xyvora-ai` project and its policies are unchanged. The staging project uses the Vite preset to initialize the deployment with explicit project settings; install and build commands are no-ops and only `public/` is served. A public embed ID is not a live connection and is not installed in this deployment.

### Redeploy the static holding page (maintainers only)

The initial deployment is complete; the owner does not need to use the CLI. For a future redeploy, export only the staging files from this checkout:

```sh
node scripts/zapier-staging.mjs --export ../xyvora-connect-staging
cd ../xyvora-connect-staging
```

Run the [Vercel CLI](https://vercel.com/docs/cli/global-options#project) in that exported folder (the one containing `vercel.json` and `public/`). Sign in privately with the Vercel owner account if needed. The team and project IDs below are not credentials. `--prod` assigns the custom domain on **only** the specified staging project; do not run this from the main app checkout.

```sh
npx vercel@latest login
npx vercel@latest deploy --prod --scope team_RBMbyvh9h7f4NrUHyFkpdrAq --project prj_VyjkxeKBD752Kdke37w7s61xmRWv
```

After any redeploy, verify `https://connect-staging.xyvora.net/` returns the **Zapier connection setup** page over HTTPS on that exact origin, with the **HTTPS staging host** badge and **Not connected**. `node scripts/zapier-staging.mjs` serves the local preview, which must show **Preview only** and does not verify the custom hostname.

## Check and configure the Zapier account

1. Open [MCP Embed configuration](https://mcp.zapier.com/manage/embed/config) while signed in to the intended Zapier account. Check whether the account can save an embed and view the generated code on its current plan. If the page is missing, read-only, or asks for an upgrade, note the message and stop. Do not buy or enable anything for this pilot without approval. Server-sharing eligibility is a separate issue: this pilot does not share a Zapier server or account between Xyvora users.
2. Use **Xyvora AI** as the company name. Once the exact hostname is verified over HTTPS, add `connect-staging.xyvora.net` to **Allowed Domains** and save. Enter the hostname only: no scheme, path, wildcard, or main-site domain. See [Zapier's embed setup](https://docs.zapier.com/mcp/embed/getting-started).
3. Copy only the public `embed-id` attribute value from the [generated client markup](https://docs.zapier.com/mcp/embed/getting-embed-code). Do not copy the embed secret, a connection token, or a user's MCP URL. Do not configure a secret on the public holding page. For the protected pilot, store the secret from [Embed Secret Management](https://mcp.zapier.com/manage/embed/secrets) as a Sensitive server variable once the connection flow is ready. `XYVORA_ZAPIER_EMBED_SECRET` is the proposed name; current builds do not read it.

## Prepare one read-only action

Use a new dummy sheet with columns `ID` and `Label` and a row such as `test-001`, `Ready`. Use a separate Google test account with **Viewer** access to the dummy sheet and no access to real files. In Zapier, select **Google Sheets → Lookup Spreadsheet Row** for that sheet, worksheet, and ID column. Leave **Create row if it doesn't exist** off: [the lookup has an optional create-on-miss behavior](https://help.zapier.com/hc/en-us/articles/8495978803213-Find-and-update-spreadsheet-rows-in-Google-Sheets-on-Zapier). Do not pick **Find or Create Row**. If the account or action configuration requires write access, stop instead of granting it for the pilot.

`lookup_row` identifies the catalog action; it does not establish the tool name or argument contract of an actual embedded MCP server. During protected staging, confirm the exact name and input schema in the connected test server's tool list. Check the no-match configuration before calling it. A test lookup for `test-001` should return one dummy row; `missing-001` should return not found and leave the sheet unchanged.

### Safe handoff

```text
Can save an MCP Embed with this plan: yes / no / not checked
Public embed-id from generated code: [only if available]
Exact staging setup hostname: [or not chosen yet]
Pilot MCP tool name and input field names/types: [after discovery; redact values]
```

Never include secrets, a private server URL (even without a visible token), a sheet ID, account data, or any real row values in a handoff. Share a redacted dashboard error if a step is blocked. No Google credentials need to be connected to Arena for the website pilot.

## Xyvora implementation and release gates

- The [documented web component](https://docs.zapier.com/mcp/embed/getting-embed-code) loads third-party JavaScript. Keep it off the main Xyvora account origin; changing the content security policy for just a path on the same origin would not isolate browser data or authenticated requests. Confirm a separate, narrowly allowed setup origin and a one-time handoff bound to the signed-in user, or a supported hosted authorization flow, before shipping a connect UI. Preserve the main site's existing script and frame restrictions.
- Keep any embed secret and each user's private MCP URL on the server after the connection handoff. Encrypt stored connection credentials, bind them to the verified Xyvora account, use exact verified Zapier endpoints with no redirects, and never log private URLs, headers, or provider payloads. Follow the [server SDK connection guide](https://docs.zapier.com/mcp/embed/sdk-connection-guide) for the chosen flow. A user's URL or credentials must not become a shared default.
- Allowlist the verified pilot action and schema on the server. Show the spreadsheet, action, and actual lookup value in Plugins; require a fresh approval for each run. If the action contract can create rows and Xyvora cannot enforce read-only behavior, leave it disabled. No automatic execution from chat, jobs, generic user-supplied URLs, or provider tool discovery. Show the bounded result only in the pilot panel, not in chat or memory.
- In protected staging, verify connection, approval, rejection without approval, matching and missing rows, and recovery from an expired connection. Sign in with a second Xyvora account and verify it cannot list or use the first account's connection or approvals. Disconnect must remove the local connection and invalidate pending approvals; verify provider-side revocation separately before promising it. Require a new consent flow to reconnect. Leave the pilot hidden until these checks pass and the owner approves the plan, permission, and usage limits.
