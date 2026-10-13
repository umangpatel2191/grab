import * as cheerio from 'cheerio';
import type { Candidate, MediaKind, Origin, Variant } from '../../../shared/types';
import {
  DIRECT_VIDEO_EXT,
  IMAGE_EXT,
  VIDEO_EXT,
  dimsFromUrl,
  guessMime,
  variantKey,
} from '../../../shared/urls';
import { originalUrl } from '../../../shared/originals';

type CheerioAPI = ReturnType<typeof cheerio.load>;

export interface ExtractOptions {
  maxCandidates: number;
  groupId?: string;
  newId: () => string;
}

export interface ExtractResult {
  candidates: Candidate[];
  stylesheets: string[];
  /** Same-site page links, most important (navigation, header, footer) first. Used to crawl the site. */
  pageLinks: string[];
  /** The site's own logo, when the page makes it clear which image that is. */
  logoUrl: string | null;
  /** Colors painted inside an inline SVG logo. */
  logoSvgColors: string[];
}

const NOT_A_PAGE = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|heic|mp4|webm|mov|m4v|m3u8|mpd|mp3|wav|pdf|zip|rar|gz|dmg|exe|docx?|xlsx?|pptx?|csv|json|xml|txt|css|js|woff2?|ttf|otf|eot)$/i;
const SKIP_PATH = /\/(login|log-in|signin|sign-in|signup|sign-up|register|logout|cart|checkout|basket|account|my-account|wp-admin|wp-login|admin|feed|cdn-cgi|wp-json|xmlrpc\.php)(\/|$)|\/(tag|author)\/[^/]+\/page\/\d+/i;

function samesite(a: string, b: string): boolean {
  return a.replace(/^www\./, '') === b.replace(/^www\./, '');
}

/** Same-site links that look like real pages. Exported for the crawler (sitemaps). */
export function isCrawlablePage(u: URL, siteHost: string): boolean {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (!samesite(u.hostname, siteHost)) return false;
  if (NOT_A_PAGE.test(u.pathname) || SKIP_PATH.test(u.pathname)) return false;
  if ([...u.searchParams.keys()].some((k) => /^(add-to-cart|replytocom|share|print|action|lang|currency|sort|filter|orderby)$/i.test(k))) return false;
  return true;
}

interface Raw {
  kind: MediaKind;
  origin: Origin;
  url: string;
  posterUrl?: string | null;
  posterFallback?: string | null;
  width?: number | null;
  height?: number | null;
  mime?: string | null;
  title?: string | null;
  downloadable?: boolean;
  variants?: Variant[];
}

const TRACKER_HOSTS = /(^|\.)(doubleclick\.net|google-analytics\.com|googletagmanager\.com|facebook\.com\/tr|scorecardresearch\.com|adsrvr\.org|bat\.bing\.com|px\.ads\.linkedin\.com|analytics\.twitter\.com)$/i;
const FONT_EXT = /\.(woff2?|ttf|otf|eot)(?=($|[?#]))/i;
const MAX_DATA_URI = 100 * 1024;

const LAZY_SRC_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url', 'data-image', 'data-img', 'data-full', 'data-hi-res-src', 'data-zoom-src'];
const LAZY_SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset'];
const LAZY_BG_ATTRS = ['data-bg', 'data-background', 'data-background-image', 'data-bg-src', 'data-bg-image'];

function resolveUrl(raw: string | undefined | null, base: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === '#' || /^(javascript|about|blob|mailto|tel):/i.test(s)) return null;
  if (s.startsWith('data:')) {
    if (!/^data:image\//i.test(s) || s.length > MAX_DATA_URI) return null;
    return s;
  }
  try {
    const u = new URL(s, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export function parseSrcset(value: string): { url: string; w: number | null; x: number | null }[] {
  const out: { url: string; w: number | null; x: number | null }[] = [];
  const normalized = value.trim().replace(/(\d[wx]),(?=\S)/g, '$1, ');
  for (const part of normalized.split(/,\s+/)) {
    const bits = part.trim().split(/\s+/);
    const url = bits[0]?.replace(/,+$/, '');
    if (!url) continue;
    let w: number | null = null;
    let x: number | null = null;
    for (const d of bits.slice(1)) {
      const m = d.match(/^(\d+(?:\.\d+)?)([wx])$/i);
      if (!m) continue;
      if (m[2].toLowerCase() === 'w') w = Math.round(Number(m[1]));
      else x = Number(m[1]);
    }
    out.push({ url, w, x });
  }
  return out;
}

function num(v: string | undefined): number | null {
  if (!v) return null;
  if (v.includes('%')) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function youtubeId(src: string): string | null {
  const m = src.match(/(?:youtube(?:-nocookie)?\.com\/(?:embed|v)\/|youtu\.be\/)([\w-]{11})/i);
  return m ? m[1] : null;
}

function vimeoId(src: string): string | null {
  const m = src.match(/player\.vimeo\.com\/video\/(\d+)/i);
  return m ? m[1] : null;
}

function isImageUrl(u: string): boolean {
  return u.startsWith('data:image/') || IMAGE_EXT.test(u);
}

function cssUrls(css: string): string[] {
  const out: string[] = [];
  const re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    if (m[2]) out.push(m[2]);
  }
  // image-set("a.png" 1x, "a@2x.png" 2x) also allows bare strings without url()
  const lower = css.toLowerCase();
  for (let i = lower.indexOf('image-set('); i !== -1 && out.length < 2000; i = lower.indexOf('image-set(', i + 10)) {
    // scan to the matching ")" (the list holds type("image/avif") and url() calls)
    let depth = 0;
    let end = i + 9;
    for (; end < css.length; end++) {
      if (css[end] === '(') depth++;
      else if (css[end] === ')' && --depth === 0) break;
    }
    const inner = css.slice(i + 10, end);
    for (const s of inner.matchAll(/(?:^|,)\s*(['"])([^'"]+)\1/g)) out.push(s[2]);
  }
  return out;
}

/** Stylesheets pulled in with @import (they hold backgrounds, fonts and colors too). */
export function cssImports(css: string, base: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/gi)) {
    const u = resolveUrl(m[2], base);
    if (u && !u.startsWith('data:')) out.push(u);
  }
  return out.slice(0, 10);
}

/** Image URLs that appear in CSS text (used for <style> blocks and linked stylesheets). */
export function extractCssImageUrls(css: string, base: string): string[] {
  const out: string[] = [];
  for (const raw of cssUrls(css)) {
    const u = resolveUrl(raw, base);
    if (u && isImageUrl(u) && !FONT_EXT.test(u)) out.push(u);
  }
  return out;
}

function scriptJsonUrls(text: string, base: string): string[] {
  const t = text.replace(/\\u0026/g, '&').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  const re = /https?:\/\/[^"'\s\\<>)]+?\.(?:jpe?g|png|webp|avif|gif|svg)(?:\?[^"'\s\\<>)]*)?/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) && found.size < 200) {
    const u = resolveUrl(m[0], base);
    if (u) found.add(u);
  }
  return [...found];
}

export function extractFromHtml(html: string, pageUrl: string, opts: ExtractOptions, extraCss: string[] = [], extraImages: string[] = []): ExtractResult {
  const $ = cheerio.load(html);
  const baseHref = $('base[href]').first().attr('href');
  const base = (baseHref && resolveUrl(baseHref, pageUrl)) || pageUrl;
  const raws: Raw[] = [];
  const embeds = new Set<string>();

  const add = (r: Raw) => {
    if (raws.length < opts.maxCandidates * 3) raws.push(r);
  };

  const addImg = (rawUrl: string | undefined | null, origin: Origin, extra: Partial<Raw> = {}) => {
    const url = resolveUrl(rawUrl, base);
    if (!url) return;
    if (!url.startsWith('data:')) {
      try {
        if (TRACKER_HOSTS.test(new URL(url).hostname)) return;
      } catch {
        return;
      }
    }
    add({ kind: 'image', origin: url.startsWith('data:') ? 'data-uri' : origin, url, ...extra });
  };

  const collectImages = ($$: CheerioAPI, depth: number) => {
    $$('img').each((_, el) => {
      const $el = $$(el);
      const w = num($el.attr('width')) ?? num($el.attr('data-width'));
      const h = num($el.attr('height')) ?? num($el.attr('data-height'));
      if ((w !== null && w <= 2) || (h !== null && h <= 2)) return; // tracking pixel
      const title = ($el.attr('alt') || $el.attr('title') || '').trim().slice(0, 120) || null;
      const srcsets = [$el.attr('srcset'), ...LAZY_SRCSET_ATTRS.map((a) => $el.attr(a))].filter(Boolean) as string[];
      for (const ss of srcsets) {
        for (const c of parseSrcset(ss)) {
          const width = c.w ?? (c.x && w ? Math.round(w * c.x) : null);
          const height = width && w && h ? Math.round((width / w) * h) : null;
          addImg(c.url, 'srcset', { width, height, title });
        }
      }
      addImg($el.attr('src'), 'img', { width: w, height: h, title });
      for (const a of LAZY_SRC_ATTRS) addImg($el.attr(a), 'lazy-attribute', { width: w, height: h, title });
    });

    $$('picture source[srcset], source[srcset]').each((_, el) => {
      for (const c of parseSrcset($$(el).attr('srcset') || '')) {
        addImg(c.url, 'picture', { width: c.w, title: null });
      }
    });

    if (depth === 0) {
      $$('noscript').each((_, el) => {
        const inner = $$(el).text() || $$(el).html() || '';
        if (!/<img/i.test(inner)) return;
        collectImages(cheerio.load(inner, null, false) as CheerioAPI, depth + 1);
      });
    }
  };

  collectImages($, 0);

  $('link[rel="preload"][as="image"]').each((_, el) => {
    const $el = $(el);
    const ss = $el.attr('imagesrcset');
    if (ss) for (const c of parseSrcset(ss)) addImg(c.url, 'srcset', { width: c.w });
    addImg($el.attr('href'), 'img');
  });
  $('image[href], image[xlink\\:href]').each((_, el) => addImg($(el).attr('href') || $(el).attr('xlink:href'), 'img'));
  $('object[data], embed[src]').each((_, el) => {
    const u = $(el).attr('data') || $(el).attr('src');
    if (u && IMAGE_EXT.test(u)) addImg(u, 'img');
  });

  // inline style backgrounds and lazy backgrounds
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    if (!/url\(/i.test(style)) return;
    for (const raw of cssUrls(style)) {
      const u = resolveUrl(raw, base);
      if (u && !FONT_EXT.test(u)) addImg(u, 'css-background');
    }
  });
  const inlineImports: string[] = [];
  $('style').each((_, el) => {
    const css = $(el).text();
    for (const u of extractCssImageUrls(css, base)) addImg(u, 'css-background');
    inlineImports.push(...cssImports(css, base));
  });
  for (const u of extraCss) addImg(u, 'css-background');
  for (const u of extraImages) addImg(u, 'img');
  for (const attr of [...LAZY_BG_ATTRS, ...LAZY_SRC_ATTRS]) {
    $(`:not(img)[${attr}]`).each((_, el) => {
      const v = $(el).attr(attr) || '';
      const m = v.match(/url\(\s*['"]?(.*?)['"]?\s*\)/i);
      const u = resolveUrl(m ? m[1] : v, base);
      if (u && isImageUrl(u)) addImg(u, 'lazy-attribute');
    });
  }

  // metadata images
  const metaDims = {
    w: num($('meta[property="og:image:width"]').attr('content')),
    h: num($('meta[property="og:image:height"]').attr('content')),
  };
  $('meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"], meta[name="og:image"]').each((_, el) => {
    addImg($(el).attr('content'), 'og-image', { width: metaDims.w, height: metaDims.h });
  });
  $('meta[name="twitter:image"], meta[name="twitter:image:src"], meta[property="twitter:image"], meta[itemprop="image"], link[rel="image_src"]').each((_, el) => {
    addImg($(el).attr('content') || $(el).attr('href'), 'twitter-image');
  });
  $('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"], link[rel="mask-icon"], link[rel="shortcut icon"]').each((_, el) => {
    const sizes = ($(el).attr('sizes') || '').match(/(\d+)x(\d+)/);
    addImg($(el).attr('href'), 'favicon', sizes ? { width: Number(sizes[1]), height: Number(sizes[2]) } : {});
  });

  // direct links to image or video files (often the full-size version of a thumbnail)
  $('a[href]').each((_, el) => {
    const u = resolveUrl($(el).attr('href'), base);
    if (!u) return;
    if (!u.startsWith('data:') && IMAGE_EXT.test(u)) addImg(u, 'link');
    else if (DIRECT_VIDEO_EXT.test(u)) {
      add({ kind: 'video', origin: 'link', url: u, mime: guessMime(u), downloadable: true });
    }
  });

  // JSON data embedded in the page
  // also plain inline scripts: page builders (Wix, Shopify, Framer, Next.js) keep their gallery data there
  let scriptBudget = 2_000_000;
  $('script:not([src])').each((_, el) => {
    const type = ($(el).attr('type') || '').toLowerCase();
    if (type && !/json|javascript|module/.test(type)) return;
    if (scriptBudget <= 0) return;
    const text = $(el).text().slice(0, scriptBudget);
    scriptBudget -= text.length;
    for (const u of scriptJsonUrls(text, base)) addImg(u, 'script-json');
  });

  // video elements
  $('video').each((_, el) => {
    const $v = $(el);
    const poster = resolveUrl($v.attr('poster'), base);
    const sources: { url: string; type: string | null }[] = [];
    const direct = resolveUrl($v.attr('src'), base);
    if (direct) sources.push({ url: direct, type: $v.attr('type') ?? null });
    $v.find('source[src]').each((__, s) => {
      const u = resolveUrl($(s).attr('src'), base);
      if (u) sources.push({ url: u, type: $(s).attr('type') ?? null });
    });
    if (!sources.length) {
      if (poster) addImg(poster, 'img');
      return;
    }
    const rank = (s: { url: string; type: string | null }) => {
      const t = (s.type || guessMime(s.url) || '').toLowerCase();
      if (t.includes('mp4')) return 0;
      if (t.includes('webm')) return 1;
      if (t.includes('quicktime')) return 2;
      return 3;
    };
    sources.sort((a, b) => rank(a) - rank(b));
    const best = sources[0];
    const mime = best.type || guessMime(best.url);
    add({
      kind: 'video',
      origin: 'video',
      url: best.url,
      posterUrl: poster,
      mime,
      width: num($v.attr('width')),
      height: num($v.attr('height')),
      downloadable: rank(best) < 3 && !/mpegurl|dash/i.test(mime || ''),
      variants: sources.slice(1).map((s) => ({ url: s.url, width: null, height: null })),
    });
  });
  $('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[name="twitter:player:stream"]').each((_, el) => {
    const u = resolveUrl($(el).attr('content'), base);
    if (!u || !VIDEO_EXT.test(u)) return;
    add({
      kind: 'video',
      origin: 'og-video',
      url: u,
      mime: guessMime(u),
      posterUrl: resolveUrl($('meta[property="og:image"]').first().attr('content'), base),
      downloadable: DIRECT_VIDEO_EXT.test(u),
    });
  });

  // embedded players
  const addEmbed = (id: string, provider: 'youtube' | 'vimeo') => {
    const key = provider + id;
    if (embeds.has(key)) return;
    embeds.add(key);
    if (provider === 'youtube') {
      add({
        kind: 'video',
        origin: 'embed',
        url: `https://www.youtube.com/watch?v=${id}`,
        posterUrl: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
        posterFallback: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        downloadable: false,
        title: 'YouTube video',
      });
    } else {
      add({ kind: 'video', origin: 'embed', url: `https://vimeo.com/${id}`, posterUrl: null, downloadable: false, title: 'Vimeo video' });
    }
  };
  $('iframe[src], iframe[data-src]').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    const y = youtubeId(src);
    if (y) return addEmbed(y, 'youtube');
    const v = vimeoId(src);
    if (v) addEmbed(v, 'vimeo');
  });
  $('lite-youtube[videoid], [data-youtube-id]').each((_, el) => {
    const id = $(el).attr('videoid') || $(el).attr('data-youtube-id') || '';
    if (/^[\w-]{11}$/.test(id)) addEmbed(id, 'youtube');
  });

  // inline <svg> icons and logos: real assets that have no file of their own
  const symbols = new Map<string, string>();
  $('symbol[id]').each((_, el) => {
    symbols.set($(el).attr('id')!, $.html(el));
  });
  let svgCount = 0;
  let svgLogo: string | null = null;
  $('svg').each((_, el) => {
    if (svgCount >= 400) return;
    const $s = $(el);
    if ($s.parents('svg').length || $s.closest('defs, symbol').length) return;
    if ($s.attr('aria-hidden') === 'true' && !$s.children().length) return;
    let inner = $s.html() || '';
    // sprite icons: <use href="#id"> → copy the symbol in so the file stands alone
    const use = $s.find('use').first().attr('href') || $s.find('use').first().attr('xlink:href');
    let viewBox = $s.attr('viewBox') || $s.attr('viewbox');
    if (use && use.startsWith('#') && symbols.has(use.slice(1))) {
      const $sym = cheerio.load(symbols.get(use.slice(1))!, null, false)('symbol');
      inner = $sym.html() || inner;
      viewBox = viewBox || $sym.attr('viewBox') || $sym.attr('viewbox');
    }
    // a sprite sheet (only <symbol>/<defs>) is not an icon itself; its icons are picked up via <use>
    const drawn = inner.replace(/<(symbol|defs)\b[\s\S]*?<\/\1>/gi, '');
    if (!/<(path|rect|circle|ellipse|polygon|polyline|line|g|image|text)\b/i.test(drawn)) return;
    let w = num($s.attr('width'));
    let h = num($s.attr('height'));
    const vb = (viewBox || '').trim().split(/[\s,]+/).map(Number);
    if ((!w || !h) && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      w = w ?? Math.round(vb[2]);
      h = h ?? Math.round(vb[3]);
    }
    const attrs = [`xmlns="http://www.w3.org/2000/svg"`, `xmlns:xlink="http://www.w3.org/1999/xlink"`];
    if (viewBox) attrs.push(`viewBox="${viewBox}"`);
    if (w) attrs.push(`width="${w}"`);
    if (h) attrs.push(`height="${h}"`);
    for (const a of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'style']) {
      const v = $s.attr(a);
      if (v) attrs.push(`${a}="${v.replace(/"/g, '&quot;')}"`);
    }
    // currentColor has no color outside the page: use the page's text color guess (dark)
    const svg = `<svg ${attrs.join(' ')}>${inner}</svg>`.replace(/currentColor/gi, '#111111');
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    if (url.length > MAX_DATA_URI) return;
    const label = ($s.attr('aria-label') || $s.find('title').first().text() || $s.closest('[aria-label]').attr('aria-label') || '').trim().slice(0, 120) || null;
    add({ kind: 'image', origin: 'inline-svg', url, width: w, height: h, mime: 'image/svg+xml', title: label });
    svgCount++;
    // the first inline svg that links home or sits in a logo wrapper is the site's vector logo
    if (!svgLogo && $s.closest('a[href="/"], a[rel="home"], [class*="logo" i], [id*="logo" i], [class*="brand" i]').length && !$s.closest('footer').length) svgLogo = url;
  });

  // same-site pages, navigation first
  const siteHost = new URL(pageUrl).hostname;
  const ranked = new Map<string, number>();
  $('a[href]').each((_, el) => {
    const abs = resolveUrl($(el).attr('href'), base);
    if (!abs || abs.startsWith('data:')) return;
    let u: URL;
    try {
      u = new URL(abs);
    } catch {
      return;
    }
    if (!isCrawlablePage(u, siteHost)) return;
    u.hash = '';
    const key = u.toString();
    if (key.replace(/\/$/, '') === pageUrl.replace(/#.*$/, '').replace(/\/$/, '')) return;
    const inNav = $(el).closest('nav, header, [role="navigation"], [class*="menu"], [class*="nav"]').length > 0;
    const inFooter = $(el).closest('footer').length > 0;
    const depth = u.pathname.split('/').filter(Boolean).length;
    const score = (inNav ? 100 : inFooter ? 40 : 60) - depth * 5;
    ranked.set(key, Math.max(ranked.get(key) ?? -Infinity, score));
  });
  const pageLinks = [...ranked].sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, 300);

  // the site's own logo: inside the header, linking home, or named "logo"
  let logoUrl: string | null = null;
  const logoSel = [
    'header a[href="/"] img, nav a[href="/"] img, a[rel="home"] img, a[class*="logo"] img',
    'img[class*="logo" i], img[id*="logo" i], [class*="logo" i] img, [id*="logo" i] img',
    'header img, nav img',
  ];
  for (const sel of logoSel) {
    $(sel).each((_, el) => {
      if (logoUrl) return;
      const $el = $(el);
      const u = resolveUrl($el.attr('src') || $el.attr('data-src') || parseSrcset($el.attr('srcset') || '')[0]?.url, base);
      if (u && !/partner|client|sponsor|payment|badge|award/i.test(u + ' ' + ($el.attr('alt') || ''))) logoUrl = u;
    });
    if (logoUrl) break;
  }
  // a vector logo in the header beats a raster one
  if (svgLogo) logoUrl = svgLogo;
  const logoSvgColors: string[] = [];
  $('header svg, a[href="/"] svg, [class*="logo" i] svg, svg[class*="logo" i]').slice(0, 4).each((_, el) => {
    $(el).find('[fill], [stroke], [style]').addBack().each((__, n) => {
      const $n = $(n);
      for (const v of [$n.attr('fill'), $n.attr('stroke'), ($n.attr('style') || '').match(/(?:fill|stroke)\s*:\s*([^;]+)/)?.[1]]) {
        if (v && !/none|currentcolor|url\(|inherit|transparent/i.test(v)) logoSvgColors.push(v.trim());
      }
    });
  });

  const stylesheets: string[] = [];
  $('link[rel~="stylesheet"][href]').each((_, el) => {
    const u = resolveUrl($(el).attr('href'), base);
    if (u && !u.startsWith('data:')) stylesheets.push(u);
  });

  return {
    candidates: finalize(raws, pageUrl, opts),
    stylesheets: [...new Set([...stylesheets, ...inlineImports])].slice(0, 30),
    pageLinks,
    logoUrl,
    logoSvgColors: logoSvgColors.slice(0, 40),
  };
}

function finalize(raws: Raw[], pageUrl: string, opts: ExtractOptions): Candidate[] {
  const groupId = opts.groupId ?? 'web';
  const map = new Map<string, Candidate>();
  for (const r of raws) {
    const key = r.kind + ':' + variantKey(r.url);
    let w = r.width ?? null;
    let h = r.height ?? null;
    let dimsSource: Candidate['dimsSource'] = w || h ? 'attr' : 'unknown';
    if (!w && !h && !r.url.startsWith('data:')) {
      const d = dimsFromUrl(r.url);
      if (d) {
        w = d.width;
        h = d.height;
        dimsSource = 'url';
      }
    }
    const existing = map.get(key);
    if (existing) {
      const v: Variant = { url: r.url, width: w, height: h };
      if (!existing.variants.some((x) => x.url === r.url)) existing.variants.push(v);
      // keep the biggest known version as the main one
      if ((w ?? 0) > (existing.width ?? 0)) {
        existing.url = r.url;
        existing.originalUrl = r.kind === 'image' ? originalUrl(r.url) : null;
        existing.width = w;
        existing.height = h ?? existing.height;
        existing.dimsSource = dimsSource;
        existing.mime = r.mime ?? guessMime(r.url) ?? existing.mime;
      }
      if (!existing.title && r.title) existing.title = r.title;
      if (!existing.posterUrl && r.posterUrl) existing.posterUrl = r.posterUrl;
      continue;
    }
    if (map.size >= opts.maxCandidates) break;
    const mime = r.url.startsWith('data:') ? r.url.slice(5, r.url.indexOf(';') > 0 ? r.url.indexOf(';') : r.url.indexOf(',')) : r.mime ?? guessMime(r.url);
    const variants: Variant[] = [{ url: r.url, width: w, height: h }, ...(r.variants ?? [])];
    map.set(key, {
      id: opts.newId(),
      kind: r.kind,
      origin: r.origin,
      groupId,
      sourceUrl: pageUrl,
      url: r.url,
      posterUrl: r.posterUrl ?? null,
      posterFallback: r.posterFallback ?? null,
      width: w,
      height: h,
      dimsSource,
      mime: mime || null,
      bytes: r.url.startsWith('data:') ? Math.floor((r.url.length - r.url.indexOf(',') - 1) * 0.75) : null,
      durationSec: null,
      title: r.title ?? null,
      downloadable: r.downloadable ?? true,
      variants,
      warnings: [],
      originalUrl: r.kind === 'image' ? originalUrl(r.url) : null,
    });
  }
  return [...map.values()];
}
