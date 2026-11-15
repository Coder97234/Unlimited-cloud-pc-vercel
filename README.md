# Unlimited-cloud-pc-vercel

A static site (PC-Free marketing/docs pages) deployed on **Vercel**, starting from the
`PC-Free-main.zip` upload that was sitting in the repo root.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | Landing page (hero video, features, AdSense units) |
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
| `ads.txt`, `robots.txt`, `sitemap.xml`, `favicon.svg`, `google…html` | Search/ad verification files |
| `SITE-README.md` | The original README that shipped inside the zip |

## Deploy

It's a plain static site — no build step. On Vercel:

1. Project root = repo root, **Framework Preset: Other**, build command empty, output directory `.`.
2. Deploy. `vercel.json` turns on clean URLs (`/docs` instead of `/docs.html`) and adds
   long-lived caching for `Assets/` and `images/`.

## Notes / open items

- `google6e21c377546f1291.html` and the `ads.txt`/AdSense publisher ID
  (`ca-pub-1809785313522754`) belong to the **original** site owner. Replace them with your
  own before going live, or verification/ads will point at the wrong property.
- Canonical URLs, OG/Twitter image URLs and the sitemap still reference
  `https://jephersonrd.github.io/PC-Free/`. Swap in the Vercel domain once it's assigned.
- `index.html` links `script.js`, which is empty. The old `index.js` (GSAP menu/scroll/FAQ
  handlers) expects markup that this page doesn't have, so it's inert.
