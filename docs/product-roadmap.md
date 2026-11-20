# Xyvora feature roadmap

**Goal:** cover the common assistant workflows well, without implying Xyvora runs ChatGPT’s models or copying features as empty UI. ChatGPT’s public feature set varies by plan and changes over time. The [official release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) and [Free Tier FAQ](https://help.openai.com/en/articles/9275245-chatgpt-free-tier-faq) are reference points, not a commitment to replicate every product or plan.

## Working in this workspace

- Streaming chat with five reply profiles, Web search with sources, built-in local tools, and local history. All five modes use the same small text engine.
- Text, code, CSV/JSON, and text-based PDF attachments. Scanned-PDF OCR is still separate.
- Markdown chat download, local 4K artwork presets, and sandboxed JavaScript.
- **Chat controls:** Temporary chat in the sidebar, edit or branch without changing an original chat, and **Context → This message only** for exchanges that should neither receive nor supply earlier context. These controls require no new server services.
- **Personalization:** opt-in saved notes, with editing, deletion, and separate guest/account memory. Xyvora owns account identity, sessions, and note storage in PostgreSQL. Google, GitHub, Discord, or an optional password sign-in require server setup.
- **Hosted image tools:** prompt-to-image with three aspect ratios, and questions about a chat attachment with explicit upload approval. These actions require a configured OpenAI project and studio access code. Fixtures cover the flows, not live provider availability.

- **Projects and connections:** GitHub public repo browsing, issues, file excerpts and reviewed patch downloads; an approved GET registry for GitHub and npm; scoped Gmail/Vercel reads when configured. Private repository access, writes, and broad connector protocols are not included.
- **Developer API:** Free keyless streaming text with documented limits, sample commands and an OpenAPI spec. Apps call from their server. No unlimited compute commitment.
- **Transparency:** Public analytics counts actual opted-in browser activity with a separate registered account total. No active database yields an unavailable state. Terms, Privacy and Cookie choices describe controls; the owner still needs to confirm legal and operational requirements.
- **Background tasks:** Optional account-scoped text replies within a short function lifetime. No external action, scheduling, or durable retry service.

## Candidate release tracks

| Track | Next usable slice | What must be in place before calling it live |
| --- | --- | --- |
| Projects | Persistent project-scoped instructions and context; optional private GitHub access via a scoped GitHub App | Granular installation permissions, review, credential rotation, isolation, and deletion/export behavior. |
| Voice and vision | Verify configured image tools, then add voice input and spoken replies | Provider and device tests, budgets and limits, microphone/file consent, accessibility, and clear retention. A browser read-aloud button alone is not full voice chat. |
| Research and workbench | Broader cited search, an editable writing/code surface, and useful tables and charts | Verify that citations support claims; bound fetch, file, and compute use; run untrusted code only in an appropriately restricted sandbox. Don’t silently run tools or send files to a provider. |
| Custom assistants, connections and tasks | Saved assistant presets with approved tool access; expand integrations and scheduled workflows separately | Actual provider authorization, a safe job runner for scheduled work, a way to review and revoke access, and limits on external or paid actions. |
| Sharing and collaboration | Safe, explicit chat or project sharing | Account identity, access roles, revocation, and no discovery or publication of a private conversation by default. |

## Improvements to validate with users

Ask which real workflows still take too many steps. Good candidates are portable local backups with restore, project-scoped file libraries, clear lists of what goes into a request, and better keyboard and screen-reader controls. Don’t assume every user wants those things or that no competing product offers them.

Release a feature only after the end-to-end workflow works, including errors, cancellation, mobile use, and the relevant privacy boundaries. Turning on a new provider, cost, retention policy, or public sharing requires its own decision.
