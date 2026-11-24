# Xyvora feature roadmap

**Goal:** cover the common assistant workflows well, without implying Xyvora runs ChatGPT’s models or copying features as empty UI. ChatGPT’s public feature set varies by plan and changes over time. The [official release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) and [Free Tier FAQ](https://help.openai.com/en/articles/9275245-chatgpt-free-tier-faq) are reference points, not a commitment to replicate every product or plan.

## Working in this workspace

- Streaming chat with four ranked slots, separate effort and reply styles, built-in local tools, and local history. Hosted model slots and snippet-based SearXNG search need configuration.
- Text, code, CSV/JSON, and text-based PDF attachments. Scanned-PDF OCR is still separate.
- Markdown chat download.
- **Chat controls:** Temporary chat in the sidebar, edit or branch without changing an original chat, and **Context → This message only** for exchanges that should neither receive nor supply earlier context. These controls require no new server services.
- **Personalization:** opt-in saved notes, with editing, deletion, and separate guest/account memory. Xyvora owns account identity, sessions, synced history, settings and memory in PostgreSQL. Social sign-in and verified email/password with reset require server setup.
- **Plugins are paused:** Script Lab, Image Studio, and public GitHub/npm tools are retained for later review. Gmail and Vercel are separate opt-in, read-only connections. Local photo previews still work.
- **Developer API:** Free keyless streaming text with documented limits, sample commands and an OpenAPI spec. Apps call from their server. No unlimited compute commitment.
- **Transparency:** Public analytics counts actual opted-in browser activity with a separate registered account total. No active database yields an unavailable state. Terms, Privacy and Cookie choices describe controls; the owner still needs to confirm legal and operational requirements.
- **Background tasks:** Optional account-scoped text replies through a durable PostgreSQL queue and leased worker. No external action or scheduled workflows.

## Candidate release tracks

| Track | Next usable slice | What must be in place before calling it live |
| --- | --- | --- |
| Projects | Persistent project-scoped instructions and context; optional private GitHub access via a scoped GitHub App | Granular installation permissions, review, credential rotation, isolation, and deletion/export behavior. |
| Voice and vision | Verify configured image tools, then add voice input and spoken replies | Provider and device tests, budgets and limits, microphone/file consent, accessibility, and clear retention. A browser read-aloud button alone is not full voice chat. |
| Research and workbench | Broader cited search, an editable writing/code surface, and useful tables and charts | Verify that citations support claims; bound fetch, file, and compute use; run untrusted code only in an appropriately restricted sandbox. Don’t silently run tools or send files to a provider. |
| Custom assistants, connections and tasks | Saved assistant presets with approved tool access; a [Zapier MCP read-only pilot](zapier-pilot.md); scheduled work stays separate | Confirm per-user authorization, approval, isolation, revocation, and usage limits before enabling a provider. Scheduled work needs its own safe runner. |
| Sharing and collaboration | Safe, explicit chat or project sharing | Account identity, access roles, revocation, and no discovery or publication of a private conversation by default. |

## Improvements to validate with users

Ask which real workflows still take too many steps. Good candidates are portable local backups with restore, project-scoped file libraries, clear lists of what goes into a request, and better keyboard and screen-reader controls. Don’t assume every user wants those things or that no competing product offers them.

Release a feature only after the end-to-end workflow works, including errors, cancellation, mobile use, and the relevant privacy boundaries. Turning on a new provider, cost, retention policy, or public sharing requires its own decision.
