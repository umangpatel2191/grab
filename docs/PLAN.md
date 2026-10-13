# GRAB — merged plan and decision record

Two plans were merged: **Plan A** (the first development plan: wide feature set, free tools such as gallery-dl, yt-dlp, Playwright, video, brutalist UI) and **Plan B** (the 12-page "Enhanced Zero-Cost" PDF: stricter scope, security, honest limits). Your requirements always win: free to build, video fetched, social images 5 at a time with LOAD MORE, brutalist UI, expert-level testing.

## Comparison and decision

| Area | Plan A | Plan B | Decision (what is built) |
| --- | --- | --- | --- |
| Website images | Cheerio + Playwright | Static first, deep scan opt-in | **B**: static by default, deep scan is an optional toggle that uses Playwright only if installed; never required |
| Extraction coverage | img, srcset, CSS, og:image | plus lazy attrs, JSON-LD, dedupe by variants | **Both**: img, srcset, picture, noscript, lazy attrs, CSS (inline and linked), meta, favicons, JSON-LD, Next.js data, direct links, data URIs; variants grouped |
| Social images | gallery-dl for everything, 5 per batch | Detect links only; adapters only where stable | **Merged**: detect all profiles; first 5 fetched automatically; LOAD MORE for 5 more. YouTube (free RSS) and Reddit (public JSON) built in; gallery-dl used for Instagram, X, Pinterest, TikTok, Behance, Dribbble, Flickr, Tumblr etc. when installed on the server; otherwise honest "Open profile" fallback. No login or captcha bypass |
| Video | Fetch, preview and download with ffmpeg merge | Defer video | **Merged**: video is fetched and shown (video tags, og:video, YouTube/Vimeo embeds, social video). Preview uses the poster. Direct MP4/WebM/MOV files can be downloaded; streaming formats (HLS/DASH) and page links open at source (no ffmpeg on a free server). Figma insert uses the poster frame |
| API | /scan, /social, /thumb, /file | Versioned /v1, SSRF-safe, no open proxy | **B**: versioned /v1, ids created by the server, no arbitrary-URL proxy |
| Progress | Streaming | SSE or polling | **Polling** with a `since` cursor: works on every free host, resumes after a cold start |
| Security | Block private IPs | Full SSRF, DNS rebinding, caps, sniffing, SVG safety | **B** in full |
| Free hosting | Render / Railway / Fly | Honest caps, no silent paid fallback | **B**: no paid service anywhere; Apify is not integrated; all limits visible |
| Batch size | 5 social at a time | Cursor only if the source supports it | **Merged**: always 5; real cursor/offset per adapter; end state shown honestly |
| Video in Figma | Poster | Native video limited by plan and size | Poster insert only |
| UI | Brutalist, tabs, sticky bar | Same, plus keyboard, no hover-only actions | **Merged**: brutalist, every action available without hover, keyboard shortcuts, virtual-style incremental grid |
| Insert | Frame + image fills | Chunked, per-item errors, cancel | **B**: chunked, per-item try/catch, cancel, summary, Figma size and format limits handled |
| Download | One, many, ZIP | Single first; ZIP capped | **Both**: single, selected as ZIP (client side, capped), copy URLs |
| Tests | Wide checklist | Fixtures, security, release blockers | **Both**: automated tests for URL parsing, IP guard, SSRF, extraction, API flow, social paging; manual checklist in `docs/TEST-PLAN.md` |

## Free-to-build guarantee

- Everything in this repository is open source and runs locally for $0.
- Hosting: Render free web service or any Docker host; Cloudflare/GitHub are optional.
- No paid API keys, no paid scraping credits, no automatic upgrades.
- Hard limits (URLs, bytes, time, per-IP rate, videos size) are configuration with safe defaults.

## Honest limits

- Instagram, X, TikTok, Facebook and LinkedIn change often and often require login; results there are best effort and always fail gracefully.
- Free servers sleep: the plugin shows a "server is waking up" state.
- "HD" means the largest variant the source exposes.

## Update (2026-10-12)
Social media support was removed at the owner's request (no profiles, no gallery-dl, no /profiles routes). Focus is now complete website asset collection: whole-site crawl, inline SVG, sitemap images, deep scan that never loses static results, and brand colors weighted by real class use.
