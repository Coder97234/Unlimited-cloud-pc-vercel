import { birdMailboxMailer, emailAddress } from '../server/account-email.ts';
import { ToolError } from '../server/workspace-http.ts';

const to = emailAddress(process.argv[2]);
const send = birdMailboxMailer(process.env);
if (!to || process.argv.length !== 3) {
  console.error('Usage: npm run mail:bird:test -- <an-email-address-you-control>');
  process.exitCode = 1;
} else if (!send) {
  console.error('In .env.local or your private environment, set XYVORA_BIRD_MAILBOX_ID and put your real Bird API key in BirDApi_Email or XYVORA_BIRD_API_KEY. Do not use bk_xxxxxxxxx.');
  process.exitCode = 1;
} else {
  try {
    await send({ to, subject: 'Test from my mailbox', text: 'Hello! Sent from my Bird mailbox.' }, AbortSignal.timeout(9_000));
    console.log('Bird accepted the test message for delivery (HTTP 202). Check your inbox and spam folder.');
  } catch (error) {
    console.error(error instanceof ToolError ? error.message : 'Bird test email failed.');
    process.exitCode = 1;
  }
}
