# Send Xyvora account codes with Bird

Xyvora uses the [Bird Mailboxes send API](https://bird.com/docs/api/reference/create-mailbox-message) to send signup and password-reset emails from a dedicated mailbox. This is **not** Bird Verify: Xyvora generates and verifies the six-digit code; Bird only delivers the email. Codes expire in 10 minutes, work once, and are stored as keyed digests, not as raw codes. Password reset invalidates the target account’s existing sessions. This requires the existing account database migrations, not a new Bird-specific migration.

## Test the mailbox first

In the Bird dashboard, choose a mailbox dedicated to authentication and create a key with the minimum permissions needed to send from it. Restrict who can read its sent mail: it contains active codes. In your private local `.env.local` (ignored by Git), set:

```dotenv
XYVORA_BIRD_API_KEY=bk_xxxxxxxxx
XYVORA_BIRD_MAILBOX_ID=mbx_yourmailboxid
```

Replace `bk_xxxxxxxxx` with the real Bird key **in that file**, and replace the mailbox placeholder with the ID from your Bird dashboard. You can use `BirDApi_Email` instead of `XYVORA_BIRD_API_KEY`; the names are case-sensitive. Set only one: a nonempty `XYVORA_BIRD_API_KEY` takes priority. Don't paste the key in chat, put it on the command line, commit it, or use a `VITE_` prefix. The sender is the mailbox's own address; no `XYVORA_MAIL_FROM` is needed for Bird. The send uses Bird’s US endpoint by default or the EU endpoint for a `bk_eu1_` key.

```sh
npm run mail:bird:test -- your-email@example.com
```

Replace the recipient with an inbox you control. This sends one real test email without starting the app or using the database. HTTP 202 means Bird accepted the message, not that it reached the inbox. Check the inbox and spam folder. A 401, 403, or 404 can indicate a key, permission, or mailbox/region mismatch; verify those in Bird instead of retrying with broader permissions. The script does not print the provider response body or your key.

## Enable in the app

1. Set up the account database using the [launch runbook](launch-runbook.md#1-provision-and-migrate-postgresql) or the [Supabase guide](supabase-setup.md).
2. In **Vercel → xyvora-ai → Settings → Environment Variables**, add `XYVORA_MAIL_PROVIDER=bird`, `XYVORA_BIRD_MAILBOX_ID`, and the Bird key (`BirDApi_Email` or `XYVORA_BIRD_API_KEY`, sensitive) for the target environment. Set the exact HTTPS `XYVORA_ACCOUNT_ORIGIN` and a dedicated, random `XYVORA_AUTH_SECRET` of at least 32 characters. Enable `XYVORA_ENABLE_PASSWORDS=1` after the mailbox test, then redeploy. If Bird is selected but missing configuration, the password forms stay hidden rather than silently switching to Resend. An existing Resend installation can keep using links by leaving `XYVORA_MAIL_PROVIDER` unset or setting it to `resend`.
3. In protected staging, request a verification code, enter it in the **Create an account** dialog, and sign in on a second device. Use **Forgot password?** to test a reset: the code should work once, the old password should fail, and the other session should be revoked. Check Bird's send limits and usage before enabling public signup.

To exercise the code UI without sending real email, use `XYVORA_LOCAL_PLATFORM=1 XYVORA_MAIL_PROVIDER=bird npm run dev`. That mode writes test messages to the private `.cache/xyvora-platform-mail` directory and does not need or use a Bird key. Use test credentials only.
