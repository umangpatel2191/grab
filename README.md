# GRAB — Figma plugin that collects every website asset

Paste website links → GRAB reads the whole site (menu, footer, sitemap) → see every image, inline SVG icon, GIF, video and the brand colors → pick what you want → download, ZIP, or insert into Figma.
Everything here is free to build and host (Render free tier, open-source tools only).

```
grab/
  plugin/   Figma plugin (React UI + main thread)
  server/   Fastify backend (SSRF-safe fetcher, extractors, crawler, optional headless browser)
  shared/   Types and URL helpers used by both
  docs/     PLAN.md (merged plan + decisions), TEST-PLAN.md (manual checklist)
```

## 1. Run it locally (5 minutes)
```bash
cd server && npm install && npm run dev        # http://localhost:8787
cd ../plugin && npm install && npm run build   # makes dist/index.html + dist/code.js
```
In Figma desktop: Plugins → Development → Import plugin from manifest → pick `plugin/manifest.json`.
(Set `id` in the manifest to any value for local use; Figma gives you a real one when you publish.)
The plugin always uses the hosted server (`https://grab-server-lz29.onrender.com`, set as `DEFAULT_SETTINGS.backend` in `plugin/src/shared/messages.ts` and in `manifest.json` → `allowedDomains`). There is no server setting in the plugin; to point it elsewhere, change both places and rebuild.

Optional extras (the server finds them on its own at start; restart after installing):
- Deep scan (JavaScript sites, measured brand colors): `cd server && npx playwright install chromium`. If that browser cannot start on your PC, an installed Chrome or Edge is used instead.

## 2. Deploy the backend free (Render)
1. Push this folder to a GitHub repo.
2. Render → New → Blueprint → pick the repo (it reads `render.yaml`; the Docker image already includes the headless browser).
3. After deploy, copy the URL, e.g. `https://grab-server.onrender.com`.
4. In `plugin/manifest.json` replace `REPLACE-WITH-YOUR-BACKEND.onrender.com` with your host, then `cd plugin && npm run build`.
5. Put that URL in `DEFAULT_SETTINGS.backend` (`plugin/src/shared/messages.ts`) as well, and rebuild.

Free tier sleeps after ~15 min idle. The plugin shows "waking server" and retries for up to 90 s.
Behind Render's proxy set `GRAB_TRUST_PROXY=1` (the Dockerfile already does).

### Backend settings (env vars, all optional)
`PORT`, `GRAB_MAX_URLS` (10), `GRAB_MAX_PAGES` (200 pages per site), `GRAB_CRAWL_CONCURRENCY` (4), `GRAB_DEEP_CONCURRENCY` (2), `GRAB_MAX_IMAGE_MB` (25), `GRAB_MAX_VIDEO_MB` (50), `GRAB_FETCH_TIMEOUT_MS`, `GRAB_RESPECT_ROBOTS` (0 disables), `GRAB_RATE_LIMIT`, `GRAB_SCAN_RATE_LIMIT`.

## 3. Tests
```bash
cd server && npm test && npm run typecheck     # 141 tests
cd plugin && npm test && npm run typecheck     # 34 tests (includes an end-to-end run against a real server)
```
Manual checklist: `docs/TEST-PLAN.md`.

## 4. How it behaves (and honest limits)
- Whole site: "Pages per site" (default 10, "Whole site" up to 200) follows the menu, header and footer links, then the sitemap. Only login, cart, admin and file links are skipped; robots.txt is honored for every page; the same picture on many pages is shown once.
- Static-first: reads HTML, `<img>`, srcset, `<picture>`, preload images, lazy-load attributes, og:image, CSS backgrounds, image URLs inside page scripts (Next.js, Shopify, Wix data), icons, inline `<svg>` icons and logos (sprite `<use>` icons are rebuilt as standalone SVGs), image entries in sitemaps, video/poster/og:video, YouTube/Vimeo embeds. Limits: 3000 files per page, 30000 per scan.
- Deep scan renders pages in a headless browser, scrolls to the end, and records every image the page downloads plus computed backgrounds. A page that shows fewer than 6 images in the static read is rendered automatically when the server has a browser.
- Video: previews use the poster. Direct MP4/WebM/MOV can be downloaded (≤ 50 MB). HLS/DASH and YouTube/Vimeo open at the source. Figma insert uses the poster frame (Figma plugins cannot insert video).
- Public content only. No login, captcha, bot-check or paywall bypass: if a site shows a bot check to the browser, deep scan steps back and the normal scan is used.
- Safety: only http/https, no private/internal addresses (checked at connect time and on every redirect), size/time caps, robots.txt honored, no open proxy.
- Respect copyright and site terms; GRAB is for reference and inspiration.

## Preview, brand book and tokens
- **Preview (eye icon):** opens any item large with its real size, type, file size and the page it came from. Arrow keys move, Space selects, Esc closes; Download and Add to Figma work from there.
- **Create Brand Book:** builds a section in Figma with Cover, Logo (light, dark, brand backgrounds + app icon), Color (swatches, RGB, WCAG contrast), Typography (typefaces and the type scale), Iconography (every SVG icon as a component) and Imagery (moodboard). It also adds a color **variable collection**, color styles and text styles, and uses the site's own heading font when Figma has it.
- **Export tokens:** `tokens.json` (W3C design-token format, read by Tokens Studio) and a Tailwind theme, zipped.
- **Type scale:** h1–h6, body, button and small text. Measured in the browser with deep scan (body = the size most paragraph text uses); otherwise from CSS for those tags and from utility classes on the real elements (Tailwind), desktop values, `rem`, `clamp()`.
- **Logo:** the vector logo in the header (inline SVG that links home or sits in a logo wrapper), else the header image logo; marked "Logo" in the grid.

## HD images
Downloads, ZIPs and Figma inserts use the **full-resolution original** when the page shows a resized copy: WordPress `-300x200`, Shopify `_400x`, Next.js `/_next/image`, Nuxt `/_ipx`, Cloudflare `/cdn-cgi/image`, Cloudinary transforms, Wix `/v1/fill`, and size parameters on imgix, Contentful, Sanity, Unsplash, Squarespace, Webflow and Framer. If the original does not answer with a real image, the page's own URL is used. With **Settings → HD images** (on by default), images that are still under 1600 px are enlarged 2× with Lanczos resampling and a light sharpen: crisper in Figma, but no invented detail.

## Fonts
Read from `@font-face` (files, weights), Google Fonts links and `@import`s, and the `font-family` of headings, body text and buttons (weighted by real class use; measured in the browser with deep scan). Icon fonts and fonts nothing uses are skipped. "Add to Figma" builds a type specimen and local text styles for every font Figma has (all Google Fonts); others are listed by name. Font files are never downloaded, since fonts carry their own licenses.

## Brand colors
Read from `theme-color`, the app manifest, CSS brand variables (`--primary`, `--brand`, `--accent`…, following `var()` chains and Tailwind/shadcn channel values), colors weighted by how often the page really uses each CSS class (rules the page never uses are ignored; buttons, links and classes named brand/primary count more; Tailwind, Bootstrap and WordPress stock colors count less), colors written straight into the HTML (`style=""`, `bg-[#hex]`), the header logo (image or inline SVG), and with deep scan the measured colors of the real buttons, links and header. A color found by several methods ranks higher. Click a color to copy it; "Add to Figma" creates swatches and local color styles.

## Help and contact
The Help panel in the plugin shows how it works and the support address: umangp737@gmail.com (change `SUPPORT_EMAIL` in `plugin/src/ui/lib.ts`).

## 5. Publishing to the Figma Community
Create the plugin in Figma (Plugins → Manage plugins → Create new) to get a plugin ID, put it in `manifest.json`, rebuild, then Publish. Icon: `plugin/assets/icon-128.png` (and 256/512).
