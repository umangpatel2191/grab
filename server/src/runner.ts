import type { Candidate, ReasonCode, ScanOptions } from '../../shared/types';
import { guessMime, variantKey } from '../../shared/urls';
import type { Config } from './config';
import { deepAvailable, renderWithBrowser, type RenderedPage } from './extract/deep';
import { colorDistance, isNeutral as isNeutralHex, colorsFromCss, colorsFromImage, colorsFromManifest, colorsFromScreenshot, colorsFromSvgPaints, colorsFromUi, extractBrandHints, mergeBrandColors, usageFromHtml } from './extract/brand';
import { cssImports, extractCssImageUrls, extractFromHtml, isCrawlablePage, type ExtractResult } from './extract/html';
import { extractFonts, extractTypeScale } from './extract/fonts';
import { getSharp } from './media';
import { Job, newId } from './jobs';
import { RobotsCache } from './net/robots';
import { GrabError, type SafeFetcher } from './net/safeFetch';
import { sniffImage } from './sniff';

export interface RunnerDeps {
  cfg: Config;
  fetcher: SafeFetcher;
  robots: RobotsCache;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function codeOf(err: unknown): { code: ReasonCode; message: string } {
  if (err instanceof GrabError) return { code: err.code, message: err.message };
  return { code: 'INTERNAL', message: 'Something went wrong while reading this source.' };
}

export async function runScan(job: Job, options: ScanOptions, deps: RunnerDeps): Promise<void> {
  const { cfg } = deps;
  try {
    await pool(job.sources, cfg.pageConcurrency, async (src) => {
      if (job.abort.signal.aborted) return;
      await scanPage(job, src, options, deps);
    });
  } catch {
    // individual sources already reported their own errors; never let the job hang
  } finally {
    job.finish(job.abort.signal.aborted ? 'canceled' : 'done');
  }
}

interface PageRead {
  html: string;
  finalUrl: string;
  result: ExtractResult;
  cssTexts: string[];
  rendered: RenderedPage | null;
}

type ReadOutcome =
  | { type: 'media'; candidate: Candidate }
  | { type: 'html'; page: PageRead }
  | { type: 'skip'; code: ReasonCode; message: string };

/** Fetch one page, render it when asked, and extract everything. Shared by the first page and the crawl. */
async function readPage(
  url: string,
  deep: boolean,
  deps: RunnerDeps,
  signal: AbortSignal,
  cssCache: Map<string, Promise<string | null>>,
  onDeepFail?: (code: ReasonCode) => void,
): Promise<ReadOutcome> {
  const { cfg, fetcher } = deps;
  const res = await fetcher.fetchBuffer(url, { maxBytes: cfg.maxHtmlBytes, accept: 'text/html,application/xhtml+xml,*/*;q=0.5', signal });
  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  const finalUrl = res.finalUrl;

  // The link itself is an image or a video file.
  const sniffed = sniffImage(res.body);
  if (ctype.startsWith('image/') || (sniffed && !ctype.includes('html'))) {
    return { type: 'media', candidate: directCandidate(finalUrl, 'image', sniffed ?? ctype.split(';')[0], url) };
  }
  if (ctype.startsWith('video/')) return { type: 'media', candidate: directCandidate(finalUrl, 'video', ctype.split(';')[0], url) };
  if (!/html|xml|text\/plain/.test(ctype) && ctype !== '') return { type: 'skip', code: 'NOT_HTML', message: 'This link is not a web page.' };

  const staticHtml = res.body.toString('utf8');
  let html = staticHtml;
  let rendered: RenderedPage | null = null;
  if (deep) {
    try {
      rendered = await renderWithBrowser(finalUrl, fetcher, cfg, signal);
      if (looksLikeBotCheck(rendered.html, staticHtml)) {
        rendered = null; // the site showed the browser a "checking you are human" page: keep the real one
        onDeepFail?.('BLOCKED_BY_SITE');
      } else html = rendered.html;
    } catch (err) {
      onDeepFail?.(codeOf(err).code);
    }
  }
  const xopts = { maxCandidates: cfg.maxCandidatesPerPage, groupId: 'web', newId };
  // The plain HTML always counts too: a rendered page can hide things (closed sliders, other breakpoints).
  const fromStatic = extractFromHtml(staticHtml, finalUrl, xopts);
  let result = rendered ? mergeResults(fromStatic, extractFromHtml(rendered.html, finalUrl, xopts)) : fromStatic;

  // Background images in linked stylesheets. Each stylesheet is read once per scan.
  const cssTexts: string[] = [];
  const extraCss: string[] = [...(rendered?.backgroundImages ?? [])];
  const seenCss = new Set<string>();
  const loadCss = async (css: string, depth: number): Promise<void> => {
    if (seenCss.has(css) || seenCss.size >= 40) return;
    seenCss.add(css);
    let p = cssCache.get(css);
    if (!p) {
      p = fetcher
        .fetchBuffer(css, { maxBytes: cfg.maxCssBytes, timeoutMs: 8000, accept: 'text/css,*/*;q=0.1', signal, referer: finalUrl })
        .then((r) => r.body.toString('utf8'))
        .catch(() => null); // a stylesheet we cannot read is not worth failing the page
      cssCache.set(css, p);
    }
    const text = await p;
    if (!text) return;
    cssTexts.push(text);
    extraCss.push(...extractCssImageUrls(text, css));
    if (depth < 2) await Promise.all(cssImports(text, css).map((u) => loadCss(u, depth + 1)));
  };
  await Promise.all(result.stylesheets.map((css) => loadCss(css, 0)));
  const extraImages = rendered?.networkImages ?? [];
  if (extraCss.length || extraImages.length) {
    // only the extra URLs are new: no need to parse the page a second time
    result = mergeResults(result, extractFromHtml('', finalUrl, xopts, extraCss.slice(0, 1500), extraImages));
  }
  return { type: 'html', page: { html, finalUrl, result, cssTexts, rendered } };
}

/** A bot check, captcha or "please wait" page instead of the site. */
function looksLikeBotCheck(rendered: string, original: string): boolean {
  // Only what a challenge page itself says. Plain "captcha" (reCAPTCHA on a contact form) and
  // Cloudflare's "challenge-platform" script are on countless normal pages and prove nothing.
  const sig = /<title>\s*(just a moment|attention required|access denied|security check)|checking your browser|verify you are human|cf-chl-|sgcaptcha|ddos-guard|are you a robot|enable javascript and cookies to continue/i;
  if (sig.test(rendered) && !sig.test(original)) return true;
  // or the page lost nearly all of its words, e.g. a tiny self-refreshing placeholder
  const words = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ').split(/\s+/).filter((w) => w.length > 2).length;
  const before = words(original);
  return before > 150 && words(rendered) < before / 6;
}

/** Union of two extractions of the same page; the first one's ids win for duplicates. */
function mergeResults(a: ExtractResult, b: ExtractResult): ExtractResult {
  const seen = new Set(a.candidates.map((c) => c.kind + ':' + variantKey(c.url)));
  const extra = b.candidates.filter((c) => {
    const k = c.kind + ':' + variantKey(c.url);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    candidates: [...a.candidates, ...extra],
    stylesheets: [...new Set([...a.stylesheets, ...b.stylesheets])],
    pageLinks: [...new Set([...a.pageLinks, ...b.pageLinks])],
    logoUrl: a.logoUrl ?? b.logoUrl,
    logoSvgColors: [...a.logoSvgColors, ...b.logoSvgColors].slice(0, 60),
  };
}

async function brandColors(page: PageRead, deps: RunnerDeps, signal: AbortSignal, rendered: RenderedPage | null) {
  const { fetcher } = deps;
  const { html, finalUrl: pageUrl, cssTexts, result } = page;
  const hints = extractBrandHints(html, pageUrl);
  const all = [...hints.colors, ...colorsFromCss([hints.inlineCss, ...cssTexts].join('\n'), usageFromHtml(html))];
  if (rendered) all.push(...colorsFromUi(rendered.uiColors));
  all.push(...colorsFromSvgPaints(result.logoSvgColors));
  if (hints.manifestUrl) {
    try {
      const res = await fetcher.fetchBuffer(hints.manifestUrl, { maxBytes: 200_000, timeoutMs: 5000, accept: 'application/manifest+json,application/json,*/*;q=0.1', signal, referer: pageUrl });
      all.push(...colorsFromManifest(res.body.toString('utf8')));
    } catch {
      /* optional */
    }
  }
  const logoUrl = result.logoUrl ?? pickLogo(result.candidates)?.url ?? null;
  const sharp = logoUrl ? await getSharp() : null;
  if (logoUrl && sharp) {
    try {
      let body: Buffer;
      if (logoUrl.startsWith('data:')) {
        const data = logoUrl.slice(logoUrl.indexOf(',') + 1);
        body = logoUrl.includes(';base64,') ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
      } else {
        const res = await fetcher.fetchBuffer(logoUrl, { maxBytes: 1_500_000, timeoutMs: 6000, accept: 'image/*,*/*;q=0.5', signal, referer: pageUrl });
        if (res.truncated) throw new Error('too big');
        body = res.body;
      }
      all.push(...(await colorsFromImage(sharp, body)));
    } catch {
      /* optional */
    }
  }
  // What the page really shows is the strongest evidence: a color only the CSS mentions, that
  // covers no part of the rendered page, is most likely from a library or an unused theme part.
  const sharp2 = rendered?.uiShot ? await getSharp() : null;
  if (rendered?.uiShot && sharp2) {
    const seen = await colorsFromScreenshot(sharp2, rendered.uiShot);
    if (seen.length) {
      // keep a color only when the page shows it (covers part of it) or uses it on buttons, links,
      // the header or the logo; everything else was only written in the CSS
      const shown = (hex: string) => seen.some((s) => !isNeutralHex(s.hex) && colorDistance(s.hex, hex) < 40);
      const kept = all.filter((c) => isNeutralHex(c.hex) || c.role === 'logo' || c.role === 'theme' || ['buttons', 'header', 'links', 'logo'].includes(c.source) || shown(c.hex));
      all.length = 0;
      all.push(...kept, ...seen);
    }
  }
  return mergeBrandColors(all, 10);
}

function pickLogo(cands: Candidate[]): Candidate | null {
  const imgs = cands.filter((c) => c.kind === 'image' && !c.url.startsWith('data:'));
  const named = imgs.find((c) => /logo|brand/i.test(c.url) || /logo/i.test(c.title ?? ''));
  if (named) return named;
  const icons = imgs.filter((c) => c.origin === 'favicon').sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return icons[0] ?? null;
}

/**
 * Pages and images listed in the site's sitemaps: the ones named in robots.txt, /sitemap.xml and
 * /sitemap_index.xml, following sitemap indexes. Image sitemaps (<image:loc>) count as images.
 */
async function readSitemaps(origin: string, siteHost: string, deps: RunnerDeps, signal: AbortSignal, maxPages: number): Promise<{ pages: string[]; images: string[] }> {
  const pages: string[] = [];
  const images = new Set<string>();
  const read = async (url: string) => {
    try {
      const r = await deps.fetcher.fetchBuffer(url, { maxBytes: 5_000_000, timeoutMs: 8000, accept: 'application/xml,text/xml,*/*;q=0.1', signal });
      const text = r.body.toString('utf8');
      return /<(urlset|sitemapindex)\b/i.test(text) ? text : '';
    } catch {
      return '';
    }
  };
  const tag = (xml: string, name: string) =>
    [...xml.matchAll(new RegExp(`<${name}>\\s*(?:<!\\[CDATA\\[)?\\s*([^<\\]\\s]+)`, 'gi'))].map((m) => m[1].replace(/&amp;/g, '&'));
  let roots: string[] = [];
  try {
    const r = await deps.fetcher.fetchBuffer(origin + '/robots.txt', { maxBytes: 200_000, timeoutMs: 5000, accept: 'text/plain', signal });
    roots = [...r.body.toString('utf8').matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  } catch {
    /* no robots.txt */
  }
  roots.push(origin + '/sitemap.xml', origin + '/sitemap_index.xml');
  const queue = [...new Set(roots)];
  const done = new Set<string>();
  let foundAny = false;
  while (queue.length && done.size < 25 && pages.length < maxPages) {
    const url = queue.shift()!;
    if (done.has(url)) continue;
    // the two guesses are the same file on most sites; skip the second once one worked
    if (foundAny && /\/sitemap(_index)?\.xml$/.test(url) && !roots.slice(0, -2).includes(url)) continue;
    done.add(url);
    const xml = await read(url);
    if (!xml) continue;
    foundAny = true;
    if (/<sitemapindex/i.test(xml)) {
      // page and post sitemaps first, then the rest
      const kids = tag(xml, 'loc').sort((x, y) => Number(/page|post|product|portfolio|project/i.test(y)) - Number(/page|post|product|portfolio|project/i.test(x)));
      queue.push(...kids);
      continue;
    }
    for (const img of tag(xml, 'image:loc')) images.add(img);
    for (const loc of tag(xml, 'loc')) {
      try {
        const u = new URL(loc);
        if (isCrawlablePage(u, siteHost)) pages.push(u.toString());
      } catch {
        /* ignore */
      }
      if (pages.length >= maxPages) break;
    }
  }
  return { pages, images: [...images].slice(0, 5000) };
}

function normPage(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + (u.pathname.replace(/\/+$/, '') || '/') + u.search;
  } catch {
    return url;
  }
}

async function scanPage(
  job: Job,
  src: { id: string; url: string },
  options: ScanOptions,
  deps: RunnerDeps,
) {
  const { cfg, robots } = deps;
  const signal = job.abort.signal;
  job.emit({ type: 'source.started', sourceId: src.id, url: src.url });
  const warn = (code: ReasonCode, message: string) => job.emit({ type: 'source.warning', sourceId: src.id, code, message });

  // The same picture found on several pages (logo, footer icons) is shown once.
  const seen = new Set<string>();
  let total = 0;
  const publish = (cands: Candidate[]) => {
    const fresh = cands.filter((c) => {
      const k = c.kind + ':' + variantKey(c.url);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const added = job.addItems(fresh.map((c) => ({ ...c, sourceUrl: src.url })));
    for (let i = 0; i < added.length; i += 40) job.emit({ type: 'image.found', sourceId: src.id, candidates: added.slice(i, i + 40) });
    total += added.length;
  };
  try {
    if (!(await robots.isAllowed(src.url, signal))) {
      warn('ROBOTS_DISALLOWED', 'This site asks automatic tools not to read this page.');
      job.emit({ type: 'source.done', sourceId: src.id, count: 0 });
      return;
    }
    const cssCache = new Map<string, Promise<string | null>>();
    const deepOn = !!options.deep && (await deepAvailable());
    if (options.deep && !deepOn) warn('DEEP_UNAVAILABLE', 'Deep scan is not installed on this server; showing the normal scan.');
    const onDeepFail = (code: ReasonCode) => {
      if (code === 'BLOCKED_BY_SITE') warn(code, 'This site shows a bot check to browsers, so deep scan was skipped. Everything below comes from the normal scan.');
      else if (code === 'TIMEOUT') warn(code, 'Deep scan took too long on this page (heavy page or busy server), so the normal scan is shown. It found everything in the page code; only images added later by scripts can be missing.');
      else if (code === 'DEEP_UNAVAILABLE') warn(code, 'The deep scan browser could not start on the server right now, so the normal scan is shown.');
      else if (code !== 'CANCELED') warn(code, 'Deep scan could not read this page, so the normal scan is shown.');
    };
    // the quick read first, so images show within seconds; the browser adds what scripts build
    let first = await readPage(src.url, false, deps, signal, cssCache);
    if (first.type === 'media') {
      publish([first.candidate]);
      job.emit({ type: 'source.done', sourceId: src.id, count: total });
      return;
    }
    if (first.type === 'skip') {
      warn(first.code, first.message);
      job.emit({ type: 'source.done', sourceId: src.id, count: 0 });
      return;
    }
    publish(first.page.result.candidates);

    // Rendered when asked (deep scan), or automatically when the page builds its images with JavaScript.
    let autoDeep = false;
    const imageCount = first.page.result.candidates.filter((c) => c.origin !== 'favicon').length;
    if (deepOn || (imageCount < 6 && (await deepAvailable()))) {
      const again = await readPage(src.url, true, deps, signal, cssCache, deepOn ? onDeepFail : undefined).catch(() => null);
      if (again?.type === 'html' && again.page.rendered) {
        // without deep scan, keep rendering the other pages only if rendering found more here
        const more = again.page.result.candidates.length > first.page.result.candidates.length;
        autoDeep = !deepOn && more;
        if (deepOn || more) first = again;
      }
    }
    const root = first.page;
    // mark the site's own logo so the plugin can put it first and use it in the brand book
    if (root.result.logoUrl) {
      const key = variantKey(root.result.logoUrl);
      const logo = root.result.candidates.find((c) => c.url === root.result.logoUrl || variantKey(c.url) === key);
      if (logo) logo.role = 'logo';
    }
    if (root.html.length >= cfg.maxHtmlBytes) warn('TOO_LARGE', 'The page is very large; only the first part was read.');

    // Images first: the user sees results while colors, fonts and the crawl are still working.
    publish(root.result.candidates);

    // Brand insights run beside the crawl. One look at the rendered home page (when the server
    // has a browser) measures the real colors, fonts and type sizes, even with deep scan off.
    const insights = (async () => {
      let measure: RenderedPage | null = root.rendered;
      if (!measure && cfg.measurePages && (await deepAvailable())) {
        try {
          const r = await renderWithBrowser(root.finalUrl, deps.fetcher, cfg, signal, true);
          if (!looksLikeBotCheck(r.html, root.html)) measure = r;
        } catch {
          /* the static reading stands */
        }
      }
      try {
        const fonts = extractFonts(root.html, root.finalUrl, root.cssTexts, usageFromHtml(root.html), measure?.fonts);
        const typeScale = extractTypeScale(root.cssTexts, root.html, measure?.typeStyles);
        if (fonts.length || typeScale.length) job.emit({ type: 'fonts.found', sourceId: src.id, fonts, typeScale });
      } catch {
        /* optional */
      }
      try {
        const colors = await brandColors(root, deps, signal, measure);
        if (colors.length) job.emit({ type: 'brand.found', sourceId: src.id, colors });
      } catch {
        /* optional */
      }
    })();

    // Read the rest of the site: navigation links first, then the sitemap, within a time budget.
    const deadline = Date.now() + cfg.siteBudgetMs;
    const want = Math.max(1, Math.min(options.pages ?? 1, cfg.maxPagesPerSite));
    if (want > 1 && !signal.aborted) {
      const siteHost = new URL(root.finalUrl).hostname;
      const visited = new Set<string>([normPage(src.url), normPage(root.finalUrl)]);
      const queued = new Set<string>();
      const queue: string[] = [];
      const enqueue = (list: string[]) => {
        for (const u of list) {
          const k = normPage(u);
          if (visited.has(k) || queued.has(k)) continue;
          queued.add(k);
          queue.push(u);
        }
      };
      enqueue(root.result.pageLinks);
      const sm = await readSitemaps(new URL(root.finalUrl).origin, siteHost, deps, signal, want * 3);
      enqueue(sm.pages);
      // images the site lists in its sitemap, even ones on pages the crawl does not reach
      if (sm.images.length) {
        const xopts = { maxCandidates: sm.images.length, groupId: 'web', newId };
        publish(extractFromHtml('', root.finalUrl, xopts, [], sm.images).candidates);
      }
      let done = 1;
      const progress = (url: string) =>
        job.emit({ type: 'source.progress', sourceId: src.id, pagesDone: done, pagesTotal: Math.min(want, done + queue.length), url });
      progress(root.finalUrl);
      // on a small server only the first page is rendered: a browser per page is what made scans slow
      const pageDeep = (deepOn || autoDeep) && !cfg.lowMemory;
      const worker = async () => {
        while (queue.length && visited.size < want && !signal.aborted && Date.now() < deadline) {
          const url = queue.shift()!;
          const k = normPage(url);
          if (visited.has(k)) continue;
          visited.add(k);
          try {
            if (await robots.isAllowed(url, signal)) {
              const r = await readPage(url, pageDeep, deps, signal, cssCache);
              if (r.type === 'media') publish([r.candidate]);
              if (r.type === 'html') {
                publish(r.page.result.candidates);
                enqueue(r.page.result.pageLinks.slice(0, 60));
              }
            }
          } catch {
            /* one broken page never stops the crawl */
          }
          done++;
          progress(url);
        }
      };
      await Promise.all(Array.from({ length: cfg.crawlConcurrency }, worker));
      if (!signal.aborted && Date.now() >= deadline && queue.length && visited.size < want) {
        warn('TIMEOUT', `Stopped after ${Math.round(cfg.siteBudgetMs / 1000)} seconds with ${done} pages read, to keep the scan quick. Scan fewer pages, or scan a specific page for more.`);
      }
    }

    await insights;
    if (!total) warn('NOT_FOUND', 'No images were found on this site. It may block automatic tools.');
    job.emit({ type: 'source.done', sourceId: src.id, count: total });
  } catch (err) {
    const c = codeOf(err);
    if (c.code !== 'CANCELED') warn(c.code, c.message);
    job.emit({ type: 'source.done', sourceId: src.id, count: total });
  }
}

function directCandidate(url: string, kind: 'image' | 'video', mime: string, sourceUrl: string): Candidate {
  return {
    id: newId(),
    kind,
    origin: kind === 'video' ? 'video' : 'img',
    groupId: 'web',
    sourceUrl,
    url,
    posterUrl: kind === 'video' ? null : url,
    posterFallback: null,
    width: null,
    height: null,
    dimsSource: 'unknown',
    mime: mime || guessMime(url),
    bytes: null,
    durationSec: null,
    title: null,
    downloadable: true,
    variants: [{ url, width: null, height: null }],
    warnings: [],
  };
}
