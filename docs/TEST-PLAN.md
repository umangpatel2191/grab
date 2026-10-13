# GRAB manual test checklist

Automated: server 119 tests, plugin 34 tests (crawl, sitemap, inline svg, brand colors weighted by real class use, var chains, measured colors).
Not covered by automation — run these by hand in Figma desktop before publishing.

## A. Input
- [ ] Paste 1 link / 5 links / 11 links (limit message) / duplicates / junk lines / link without https / uppercase host
- [ ] Paste with trailing spaces, tracking params, #fragment, non-ASCII domain
- [ ] FETCH disabled when no valid link

## B. Websites (try real sites)
- [ ] Plain blog, portfolio, e-commerce, news, Wix/Squarespace/Webflow sites
- [ ] Page with lazy-loading images, srcset/picture, CSS backgrounds, SVG logos, favicons
- [ ] JS-only site (expect fewer results + hint about deep scan)
- [ ] 404, 403, timeout, robots-blocked, login-required, non-HTML (PDF) → each shows a clear reason, other links still finish
- [ ] localhost / 192.168.x / 169.254.169.254 / file:// links → refused

## B2. Brand colors, icons, GIFs
- [ ] Sites with theme-color, CSS variables, a manifest, only a logo → colors look right; neutral-only sites show no color section
- [ ] Click a swatch copies the hex; Copy all; Add to Figma makes frame + color styles (check Local styles)
- [ ] Icons & logos section holds favicons, SVG logos, small images; GIFs section animates; large GIF falls back to still preview

## B3. Whole site and deep scan
- [ ] Pages per site: 1 (only the link), 10, 50; source row shows "x/y pages" while running and "N · y pages" when done
- [ ] Same logo/footer image appears once, not once per page; login/cart/legal pages are not read
- [ ] JavaScript site (e.g. linear.app, a Framer/Wix site) with deep scan off: still gets images (automatic render)
- [ ] Deep scan on: more images than off on a slider/gallery page; brand colors match the site's buttons
- [ ] Site with a bot check for browsers (e.g. tanaaz.co.in) + deep scan → warning, but all normal-scan images still shown
- [ ] Inline SVG icons appear in Icons & logos and insert into Figma as vectors

## B4. Preview, brand book, tokens
- [ ] Eye icon opens the preview; ← → move, Space selects, Esc closes; SVG on a checkerboard; video shows poster
- [ ] Create Brand Book: section with Cover / Logo / Color / Typography / Iconography / Imagery; Local variables has "Brand · host"; color + text styles under Brand/host; icons are components
- [ ] Site whose heading font is a Google Font → book titles use it; a font Figma lacks → "not installed" note, Inter used
- [ ] Export tokens → zip with tokens.json and tailwind.theme.json

## C. Grid and filters
- [ ] Previews appear while scanning; chips (All, Colors, Images, Icons, GIFs, Videos) switch sections; Show more works
- [ ] Search hides the colors section and filters media
- [ ] Select, select all, clear; counter correct; keyboard: Tab, Space/Enter, "/" focuses search
- [ ] 500+ images stays responsive

## D. Video
- [ ] `<video>` with poster, og:video, YouTube/Vimeo embed, direct MP4 download, over-50 MB file (clear refusal), HLS (open at source)

## F. Output
- [ ] COPY links, SAVE one file, ZIP many (names unique, correct extensions)
- [ ] INSERT into Figma: PNG/JPG/WebP/GIF/SVG, huge image (>4096 px), 30+ images, one broken image (others still inserted), video → poster
- [ ] Inserted frame is named "GRAB · host", cleanly laid out, selected and zoomed to

## G. Settings and resilience
- [ ] Wrong server address → clear error; server asleep → "waking" then success
- [ ] Cancel mid-scan; close and reopen plugin (settings and history remembered)
- [ ] Light, dark, auto themes; narrow and wide plugin window (resize handle)

## H. Help
- [ ] Help panel opens; email shows umangp737@gmail.com; Copy works; mailto may be blocked inside Figma (Copy is the fallback)
