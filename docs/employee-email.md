# Xyvora employee email setup

Proposed addresses (not provisioned or published):

| Employee | Proposed mailbox |
| --- | --- |
| Ethan Bennett | `ethan@xyvora.net` |
| Noberto Dominguez | `noberto@xyvora.net` |

`xyvora.net` already has inbound mail routing to `mailserver.businessidentity.llc`. Keep that routing in place. Vercel deploys the website, and a connected personal Gmail inbox does not administer these mailboxes.

## For the domain mail administrator

1. Sign in to the current domain email provider's admin portal and check the existing mailbox plan. Use separate mailboxes if both employees should sign in and send as their domain addresses. Use aliases only for forwarding into existing inboxes with the recipients’ permission.
2. Add the approved addresses or aliases in that portal. Check for a paid-seat prompt before adding a mailbox. Invite each employee privately and have them set up their own access and MFA where supported. Do not share passwords or recovery codes in chat or store them in this repo.
3. Send a test message from a separate account to each new address and confirm delivery. For real mailboxes, reply and check that the visible sender is the new address and that SPF, DKIM, and DMARC pass or align according to the provider’s instructions.
4. Do not change MX, SPF, DKIM, or DMARC just to add users. If the current host specifically requires a record change, verify the exact settings with the mail administrator first. Publish addresses on the site only after they work and the employees agree.
