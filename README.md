# Unlimited-cloud-pc-vercel

A static site (PC-Free marketing/docs pages) deployed on **Vercel**, starting from the
`PC-Free-main.zip` upload that was sitting in the repo root.

## Layout

| Path | What it is |
| --- | --- |
| `pc.html` | **The Windows PC** — embeds the live `dockurr/windows` desktop (port 8006) in an iframe, with an "open in new tab" fallback |
| `quickstart.html` | Step-by-step setup guide |
| `docs.html` | Full documentation |
| `faq.html` | FAQ page |
| `Compare.html` | Comparison vs other cloud PC options |
| `privacy.html` | Privacy policy (required for AdSense) |
| `style.css` | Global styles for `index.html` |
| `script.js` | Placeholder (currently empty) |
| `index.js` | Legacy script from the original site (not referenced by any page) |
| `Assets/` | Hero/section background videos (`mano.mp4` is ~6 MB) |
| `images/` | Screenshots used by the pages and OG/Twitter cards |
| `robots.txt`, `sitemap.xml`, `favicon.svg` | Search files |
| `api/vm-config.js` | Serverless function returning the browser-safe VM config to `pc.html` |
| `windows10.yml`, `.env.example` | Docker Compose for the Windows 10 machine itself (not run by Vercel) |
| `SITE-README.md` | The original README that shipped inside the zip |
| `PC-Free-main.zip` | Original upload, kept for reference |

## Deploy

It's a plain static site — no build step. On Vercel:

1. Project root = repo root, **Framework Preset: Other**, build command empty, output directory `.`.
2. Deploy. `vercel.json` turns on clean URLs (`/docs` instead of `/docs.html`) and adds
   long-lived caching for `Assets/` and `images/`.

## Wiring the Windows VM into the site

The pages are static; the machine is not. Vercel can't host a KVM virtual machine, so the
Windows desktop runs elsewhere and `pc.html` loads it:

1. **Start the machine** — `cp .env.example .env`, edit the credentials, then
   `docker compose -f windows10.yml up -d` (needs `/dev/kvm`), or run the same container in a
   GitHub Codespace. The desktop appears on port `8006`.
2. **Get a public https URL for port 8006** — in Codespaces: Ports tab → 8006 → visibility
   *Public* → copy `https://<codespace>-8006.app.github.dev`. Locally you'd need a tunnel.
3. **Point the site at it** — Vercel → project `unlimited-cloud-pc` → Settings → Environment
   Variables:
   - `VM_DESKTOP_URL` (required) — that `https://…-8006…` URL
   - `VM_BOOT_URL` (optional) — where the "Start machine" button goes
   - `VM_LABEL` (optional) — name shown in the UI

   Redeploy, then open `/pc`. Without `VM_DESKTOP_URL` the page shows setup instructions instead
   of a broken frame.

If the desktop refuses to be embedded (noVNC sends frame restrictions in some setups), `pc.html`
automatically offers "Open in new tab" — the machine still works, it just isn't framed.

## Notes / open items

- AdSense and the original owner's verification files were removed: no ads, no `ads.txt`,
  no publisher ID, and `privacy.html` now describes the site as cookie/tracker-free.
- Canonical URLs, OG/Twitter image URLs and the sitemap still reference
  `https://jephersonrd.github.io/PC-Free/`. Swap in the Vercel domain once assigned.
- `pc.html` is `noindex` and its URL is unguessable-ish but not protected — anyone with the link
  can reach the desktop, and so can anyone with the `-8006` Codespace URL itself. Keep the
  Codespace port private or stop the container when you're done.
- `index.html` links `script.js`, which is empty. The old `index.js` (GSAP menu/scroll/FAQ
  handlers) expects markup that this page doesn't have, so it's inert.
