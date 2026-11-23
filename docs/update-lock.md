# Private update window

For the Xyvora update, all Vercel aliases on this release are locked unless the visiting browser has a verified early-access cookie. An anonymous browser sees **“This website has been locked for an update.”** and a password form. Anonymous API/static requests receive `423 UPDATE_LOCKED` and no workspace data. The gate runs before files and APIs in Vercel Routing Middleware; the API handlers also check it directly. Keep the middleware configured without a matcher. The Vite dev and preview servers enforce it when configured locally.

## Set the password without recording it

In a trusted Bash terminal, read the exact password without echo or `$` expansion. The key file is not a password file: it contains a scrypt salt and verifier plus an independent random session signer. It is still sensitive. Never send it to the browser, commit it, or include it in a deployment archive.

```bash
mkdir -p .cache
umask 077
IFS= read -r -s -p 'Early-access password: ' password; printf '\n'
printf '%s' "$password" | npm run --silent update:key > .cache/xyvora-update.key
unset password
```

Set the contents as the **Sensitive**, server-only project environment variable `XYVORA_UPDATE_KEY` on Vercel for the target environment. No `VITE_` prefix. Don’t paste the password or key into a build command or a public build log. `XYVORA_UPDATE_LOCK=1` is an optional explicit lock switch. A deployed lock without a usable key denies access; the Vercel build also refuses to release that configuration.

Local test with a disposable password and key:

```bash
export XYVORA_UPDATE_KEY="$(cat .cache/xyvora-update.key)"
npm run build
npm run preview -- --port 4207 --strictPort
```

Use the browser password prompt on that preview, or run `npm run check:update-browser -- http://127.0.0.1:4207` with the disposable password piped in on stdin. Without a key or lock switch, ordinary local development is open. The built UI uses the edition selected at build time; rebuild before changing modes in preview.

## Promote and check

1. Keep the existing domain and project. Deploy a new build after setting the sensitive variable; environment changes do not update older deployments. Preserve Vercel Authentication on historical deployment URLs so an earlier unprotected build cannot serve as a public alternative. Do not pause the project or point DNS at a static notice.
2. In a fresh browser on `https://xyvora.net`, check `/` and `/about`. They must show the notice and not the application. Verify unauthenticated `/api/chat`, `/api/account`, `/api/analytics`, `/api/workspace`, `/theme.js`, and an actual hashed JS asset return `423` and `Cache-Control: no-store` (and no app content). A Vercel login page on a deployment URL is not proof of the custom-domain lock.
3. Check that a wrong password fails. Unlock with the configured password. Check that chat streams, status loads, and navigation/reload works. Test **Lock preview** and an incognito window. Repeat the anonymous checks on public aliases. Access is host-specific; unlocking one alias does not unlock another.

The signed cookie expires after eight hours and is HttpOnly, host-only and Secure on HTTPS. The password opens the workspace, not any Xyvora account or account data. **Lock preview** removes the cookie in that browser; it does not sign an account out or clear local chats. Built content and gate responses are served without caching during the update. An already loaded page cannot be erased remotely. New requests still cross the lock.

Attempts are limited per client and in total **per warm server instance**, with bounded password size and concurrent verification. These limits are not a distributed abuse shield. For longer exposure, use a stronger generated passphrase, provider-side rate limits, or per-person access. Avoid treating a shared preview password as protection for confidential information.

## Rotate or reopen

Generate a new key and redeploy to rotate the password and invalidate all existing preview cookies. Keep previous production deployments behind Vercel Authentication. To deliberately reopen, remove `XYVORA_UPDATE_KEY`, set `XYVORA_UPDATE_LOCK=0`, and build/deploy again. Validate all pages and APIs on the public alias. Restore regular caching separately if desired. Don’t roll back to an ungated build while the site is meant to remain private.
