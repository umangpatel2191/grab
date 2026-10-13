import fs from 'node:fs';
import type { Config } from '../config';
import type { MeasuredType } from './fonts';
import { GrabError, type SafeFetcher } from '../net/safeFetch';

/**
 * Optional "deep scan": render the page in a headless browser so JavaScript-built pages and
 * lazy-loaded images show up. Playwright is NOT a required dependency; when it (or its
 * Chromium build) is not installed the scan simply stays static and says so.
 */
let probe: Promise<boolean> | null = null;

async function loadPlaywright(): Promise<any> {
  const name = 'playwright';
  return import(name);
}

/** Playwright's own Chromium first, then an installed Chrome or Edge (the bundled build can be blocked on some PCs). */
async function launch(pw: any): Promise<any> {
  const tries: { channel?: string }[] = [];
  const exe: string | undefined = pw.chromium?.executablePath?.();
  if (exe && fs.existsSync(exe)) tries.push({});
  tries.push({ channel: 'chrome' }, { channel: 'msedge' });
  let last: unknown = null;
  for (const t of tries) {
    try {
      return await pw.chromium.launch({ headless: true, ...t });
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

/** True only when a browser really starts here, so the plugin never offers a deep scan that cannot run. */
export function deepAvailable(): Promise<boolean> {
  probe ??= loadPlaywright()
    .then(async (pw) => {
      const b = await launch(pw);
      await b.close().catch(() => undefined);
      return true;
    })
    .catch(() => false);
  return probe;
}

/** What the rendered page shows. Colors are real computed styles, so they match what people see. */
export interface RenderedPage {
  html: string;
  /** Image URLs the page actually downloaded (catches JS galleries, sliders, background images). */
  networkImages: string[];
  /** Computed CSS background images of visible elements. */
  backgroundImages: string[];
  /** Computed colors of the parts of a page that carry the brand. */
  uiColors: { color: string; part: 'button' | 'link' | 'header' | 'heading' | 'accent' }[];
  /** font-family the browser used for body text, headings and buttons. */
  fonts: { part: 'body' | 'heading' | 'button'; family: string }[];
  /** Computed text styles of the first visible h1…h6, paragraph, button and small text. */
  typeStyles: MeasuredType[];
}

// One shared browser; pages run in parallel up to deepConcurrency, the rest wait their turn.
let browserPromise: Promise<any> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let active = 0;
const waiters: (() => void)[] = [];

async function getBrowser(): Promise<any> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  browserPromise ??= loadPlaywright().then(launch);
  try {
    const b = await browserPromise;
    if (!b.isConnected()) throw new Error('closed');
    return b;
  } catch {
    browserPromise = null;
    throw new GrabError('DEEP_UNAVAILABLE', 'The deep scan browser could not start.');
  }
}

function releaseLater() {
  if (active > 0 || idleTimer) return;
  // free the memory when nobody has used deep scan for a minute
  idleTimer = setTimeout(() => {
    idleTimer = null;
    const p = browserPromise;
    browserPromise = null;
    void p?.then((b: any) => b.close()).catch(() => undefined);
  }, 60_000);
  idleTimer.unref();
}

async function acquire(limit: number, signal?: AbortSignal) {
  while (active >= limit) {
    await new Promise<void>((r) => waiters.push(r));
    if (signal?.aborted) throw new GrabError('CANCELED', 'Canceled.');
  }
  active++;
}

function release() {
  active--;
  waiters.shift()?.();
  releaseLater();
}

export async function closeDeep() {
  const p = browserPromise;
  browserPromise = null;
  await p?.then((b: any) => b.close()).catch(() => undefined);
}

// Runs inside the page. A plain string on purpose: bundlers add helpers to functions that the page does not have.
const MEASURE_SCRIPT = `(() => {
  const bgs = new Set();
  const all = document.querySelectorAll('body *');
  for (let i = 0; i < all.length && i < 6000; i++) {
    const bg = getComputedStyle(all[i]).backgroundImage;
    if (bg && bg !== 'none') {
      for (const m of bg.matchAll(/url\\(["']?(.*?)["']?\\)/g)) {
        if (m[1] && !m[1].startsWith('data:')) { try { bgs.add(new URL(m[1], location.href).href); } catch (e) {} }
      }
    }
  }
  const colors = [];
  const take = (sel, part, props, max) => {
    let n = 0;
    for (const el of Array.from(document.querySelectorAll(sel))) {
      if (n >= max) break;
      const r = el.getBoundingClientRect();
      if (r.width <= 8 || r.height <= 8) continue;
      const cs = getComputedStyle(el);
      for (const p of props) colors.push({ color: cs[p], part });
      n++;
    }
  };
  take('button, .btn, .button, [class*="btn-"], [class*="Button"], a[class*="button"], a[class*="btn"], input[type="submit"], [role="button"]', 'button', ['backgroundColor', 'borderColor'], 40);
  take('main a, article a, p a', 'link', ['color'], 40);
  take('header, nav, [class*="header"], [class*="navbar"]', 'header', ['backgroundColor'], 6);
  take('h1, h2', 'heading', ['color'], 12);
  take('[class*="badge"], [class*="tag"], [class*="accent"], [class*="highlight"], [class*="primary"]', 'accent', ['backgroundColor', 'color'], 30);
  const fonts = [];
  const ff = (sel, part, max) => {
    let n = 0;
    for (const el of Array.from(document.querySelectorAll(sel))) {
      if (n >= max) break;
      if (!(el.textContent || '').trim()) continue;
      fonts.push({ part, family: getComputedStyle(el).fontFamily });
      n++;
    }
  };
  ff('p, li, body', 'body', 15);
  ff('h1, h2, h3', 'heading', 10);
  ff('button, .btn, [class*="button"]', 'button', 6);
  const typeStyles = [];
  const pick = { h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', body: 'main p, article p, p', button: 'button, .btn, a[class*="button"], a[class*="btn"]', small: 'small, figcaption, .caption' };
  for (const tag of Object.keys(pick)) {
    // the style most of the text uses (weighted by text length), not just the first element
    const seen = new Map();
    for (const el of Array.from(document.querySelectorAll(pick[tag])).slice(0, 80)) {
      const r = el.getBoundingClientRect();
      const len = (el.textContent || '').trim().length;
      if (r.width < 4 || r.height < 4 || !len) continue;
      const cs = getComputedStyle(el);
      const key = [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.lineHeight, cs.letterSpacing, cs.textTransform].join('|');
      const cur = seen.get(key) || { n: 0, s: { tag, fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform } };
      cur.n += tag === 'body' ? Math.min(len, 400) : 1;
      seen.set(key, cur);
      if (tag !== 'body' && seen.size && cur.n >= 3) break;
    }
    let best = null;
    for (const v of seen.values()) if (!best || v.n > best.n) best = v;
    if (best) typeStyles.push(best.s);
  }
  return { backgroundImages: [...bgs].slice(0, 400), uiColors: colors, fonts, typeStyles };
})()`;

export async function renderWithBrowser(url: string, fetcher: SafeFetcher, cfg: Config, signal?: AbortSignal): Promise<RenderedPage> {
  if (!(await deepAvailable())) throw new GrabError('DEEP_UNAVAILABLE', 'Deep scan is not installed on this server.');
  await acquire(cfg.deepConcurrency, signal);
  let context: any = null;
  const onAbort = () => void context?.close().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });
  const hardStop = setTimeout(onAbort, 45_000);
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: cfg.userAgent.includes('Mozilla') ? cfg.userAgent : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 ${cfg.userAgent}`,
      viewport: { width: 1366, height: 900 },
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
    });
    const networkImages = new Set<string>();
    await context.route('**/*', async (route: any) => {
      const req = route.request();
      const type = req.resourceType();
      if (type === 'font' || type === 'media' || type === 'websocket') return route.abort();
      try {
        await fetcher.assertPublicUrl(req.url());
      } catch {
        return route.abort(); // same SSRF rules as the static scanner
      }
      if (type === 'image' && networkImages.size < 1500) networkImages.add(req.url());
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await page.waitForLoadState('load', { timeout: 8000 }).catch(() => undefined);
    // scroll until the page stops growing so lazy and infinite sections load
    let lastHeight = 0;
    for (let i = 0; i < 25; i++) {
      const h: number = await page.evaluate('window.scrollBy(0, Math.round(window.innerHeight * 0.9)), document.documentElement.scrollHeight');
      await page.waitForTimeout(350);
      const atEnd: boolean = await page.evaluate('window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4');
      if (atEnd && h === lastHeight) break;
      lastHeight = h;
    }
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
    await page.evaluate('window.scrollTo(0, 0)');

    const extra: { backgroundImages: string[]; uiColors: RenderedPage['uiColors']; fonts: RenderedPage['fonts']; typeStyles: RenderedPage['typeStyles'] } = await page.evaluate(MEASURE_SCRIPT);
    const html: string = await page.content();
    return { html: html.slice(0, cfg.maxHtmlBytes), networkImages: [...networkImages], ...extra };
  } catch (err) {
    if (err instanceof GrabError) throw err;
    if (signal?.aborted) throw new GrabError('CANCELED', 'Canceled.');
    if (process.env.GRAB_DEBUG) console.error('deep scan error', err);
    throw new GrabError('TIMEOUT', 'Deep scan could not finish for this page.');
  } finally {
    clearTimeout(hardStop);
    signal?.removeEventListener('abort', onAbort);
    await context?.close().catch(() => undefined);
    release();
  }
}
