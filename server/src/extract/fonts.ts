import * as cheerio from 'cheerio';
import type { FontFile, FontInfo, TypeStyle } from '../../../shared/types';
import type { PageUsage } from './brand';

type Role = FontInfo['roles'][number];

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|emoji|math|fangsong|inherit|initial|unset|revert|-apple-system|blinkmacsystemfont|apple color emoji|segoe ui emoji|segoe ui symbol|noto color emoji)$/i;
const SYSTEM = /^(arial|helvetica|helvetica neue|segoe ui|roboto|tahoma|verdana|times|times new roman|georgia|courier|courier new|consolas|menlo|monaco|sf pro|sf pro text|sf pro display|ubuntu|cantarell|oxygen|fira sans|droid sans|liberation sans)$/i;
// Icon fonts are assets of their own kind, not typography
const ICON_FONT = /awesome|icomoon|glyphicons|material ?icons|material symbols|dashicons|eicons|ionicons|feather|bootstrap-icons|themify|linearicons|elegantIcons|fontello|swiper-icons|slick|revicons|^ico/i;

const clean = (f: string) => f.trim().replace(/^['"]|['"]$/g, '').trim();

/** First real family in a font-family list ("Outfit", sans-serif → Outfit). */
export function primaryFamily(list: string): string | null {
  for (const part of list.split(',')) {
    const f = clean(part);
    if (!f || /^var\(/i.test(f) || GENERIC.test(f)) continue;
    return f;
  }
  return null;
}

/** Families and weights in a Google Fonts CSS link (css and css2 APIs). */
export function googleFamilies(href: string): { family: string; weights: string[] }[] {
  try {
    const u = new URL(href);
    if (!/fonts\.(googleapis|bunny)\.net$|fonts\.googleapis\.com$/i.test(u.hostname)) return [];
    const out: { family: string; weights: string[] }[] = [];
    for (const raw of u.searchParams.getAll('family')) {
      for (const one of raw.split('|')) {
        const [name, spec = ''] = one.split(':');
        const weights = new Set<string>();
        // css2: wght@400;700 or ital,wght@0,400;1,700 or wght@100..900 ; css1: 400,700italic
        const at = spec.split('@')[1] ?? spec;
        for (const w of at.split(/[;,]/)) {
          const m = w.match(/(\d{3})(?:\.\.(\d{3}))?/);
          if (m) weights.add(m[2] ? `${m[1]}–${m[2]}` : m[1]);
        }
        out.push({ family: name.replace(/\+/g, ' ').trim(), weights: [...weights] });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function sourceOf(urls: string[], family: string, googleNames: Set<string>): FontInfo['source'] {
  if (googleNames.has(family.toLowerCase()) || urls.some((u) => /fonts\.gstatic\.com|fonts\.bunny\.net/i.test(u))) return 'google';
  if (urls.some((u) => /use\.typekit\.net|p\.typekit\.net/i.test(u))) return 'adobe';
  if (urls.length) return 'self-hosted';
  return 'system';
}

/**
 * Typography of a page: @font-face files, Google/Adobe font links, and which family the page
 * uses for headings, body text and buttons (from CSS rules weighted by real use, and from the
 * rendered page when a deep scan measured it).
 */
export function extractFonts(
  html: string,
  pageUrl: string,
  cssTexts: string[],
  usage?: PageUsage,
  measured?: { part: Role; family: string }[],
): FontInfo[] {
  const $ = cheerio.load(html);
  const css = [$('style').map((_, el) => $(el).text()).get().join('\n'), ...cssTexts].join('\n').slice(0, 3_000_000);
  const vars = new Map<string, string>();
  for (const m of css.matchAll(/(--[\w-]{1,60})\s*:\s*([^;}{]{1,200})/g)) if (!vars.has(m[1])) vars.set(m[1], m[2].trim());
  const resolve = (v: string, d = 0): string =>
    d > 5 ? v : v.replace(/var\(\s*(--[\w-]{1,60})\s*(?:,\s*([^)]*))?\)/g, (_, n: string, fb?: string) => resolve(vars.get(n) ?? fb ?? '', d + 1));

  const fonts = new Map<string, { family: string; files: FontFile[]; weights: Set<string>; roles: Map<Role, number>; score: number }>();
  const get = (family: string) => {
    const key = family.toLowerCase();
    let f = fonts.get(key);
    if (!f) {
      f = { family, files: [], weights: new Set(), roles: new Map(), score: 0 };
      fonts.set(key, f);
    }
    return f;
  };

  // @font-face: the files the site serves
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const body = m[1];
    const fam = body.match(/font-family\s*:\s*([^;]+)/i);
    if (!fam) continue;
    const family = clean(fam[1]);
    if (!family || ICON_FONT.test(family)) continue;
    const weight = (body.match(/font-weight\s*:\s*([^;]+)/i)?.[1] ?? '400').trim().replace(/\s+/, '–');
    const style = (body.match(/font-style\s*:\s*([^;]+)/i)?.[1] ?? 'normal').trim();
    const f = get(family);
    f.weights.add(weight);
    for (const s of (body.match(/src\s*:\s*([^;]+)/i)?.[1] ?? '').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)\s*(?:format\(\s*['"]?([\w-]+)['"]?\s*\))?/gi)) {
      try {
        const url = new URL(s[1], pageUrl).toString();
        if (!url.startsWith('data:') && f.files.length < 24 && !f.files.some((x) => x.url === url)) f.files.push({ url, format: s[2] ?? null, weight, style });
      } catch {
        /* ignore */
      }
    }
  }

  // Google Fonts links
  const googleNames = new Set<string>();
  $('link[href]').each((_, el) => {
    for (const g of googleFamilies(new URL($(el).attr('href')!, pageUrl).toString())) {
      if (!g.family || ICON_FONT.test(g.family)) continue;
      googleNames.add(g.family.toLowerCase());
      const f = get(g.family);
      g.weights.forEach((w) => f.weights.add(w));
      f.score += 5;
    }
  });
  for (const m of css.matchAll(/@import\s+url\(\s*['"]?([^'")]+fonts\.googleapis\.com[^'")]+)/gi)) {
    for (const g of googleFamilies(m[1])) {
      googleNames.add(g.family.toLowerCase());
      g.weights.forEach((w) => get(g.family).weights.add(w));
    }
  }

  // Which family each part of the page uses
  const ROLE_W: Record<Role, number> = { heading: 40, body: 50, button: 20, other: 1 };
  const addRole = (family: string | null, role: Role, by: number) => {
    if (!family || ICON_FONT.test(family)) return;
    const f = get(family);
    f.roles.set(role, (f.roles.get(role) ?? 0) + by);
    f.score += by;
  };
  for (const m of css.matchAll(/([^{}@]{1,400})\{([^{}]{1,4000})\}/g)) {
    const sel = m[1].trim();
    if (/^font-face$|^(from|to|\d+%)$/i.test(sel) || css[(m.index ?? 1) - 1] === '@') continue; // @font-face, keyframes
    const decl = m[2].match(/(?:^|;)\s*font-family\s*:\s*([^;]+)/i) ?? m[2].match(/(?:^|;)\s*font\s*:[^;]*?\d(?:px|rem|em|%)[^;,]*?\s+((?:['"][^'"]+['"]|[\w-]+)(?:\s*,[^;]+)?)/i);
    if (!decl) continue;
    const family = primaryFamily(resolve(decl[1]));
    if (!family) continue;
    let uses = 1;
    if (usage) {
      const classes = [...sel.matchAll(/\.((?:\\.|[\w-])+)/g)].map((c) => c[1].replace(/\\(.)/g, '$1'));
      if (classes.length) {
        uses = Math.max(...classes.map((c) => usage.classes.get(c) ?? 0));
        if (uses === 0) continue; // nothing on the page uses this rule
      }
    }
    const role: Role = /(^|[\s,>])(html|body|:root|p)(\s*[,{:]|$)/i.test(sel)
      ? 'body'
      : /(^|[\s,>])h[1-3]\b|heading|title|display|hero/i.test(sel)
        ? 'heading'
        : /button|\.btn|cta/i.test(sel)
          ? 'button'
          : 'other';
    addRole(family, role, ROLE_W[role] * Math.min(uses, 20));
  }
  // what the browser actually used beats any guess from CSS
  for (const m of measured ?? []) addRole(primaryFamily(m.family), m.part, ROLE_W[m.part] * 10);

  const out: FontInfo[] = [];
  for (const f of fonts.values()) {
    const urls = f.files.map((x) => x.url);
    const source = sourceOf(urls, f.family, googleNames);
    // a font that is only declared (theme leftovers) and never used is noise
    if (!f.roles.size && f.score < 5 && source !== 'google') continue;
    if (source === 'system' && !f.roles.has('body') && !f.roles.has('heading')) continue;
    const roles = [...f.roles].sort((a, b) => b[1] - a[1]).map(([r]) => r);
    out.push({
      family: f.family,
      roles: roles.length ? roles : ['other'],
      source: SYSTEM.test(f.family) && !urls.length && source !== 'google' ? 'system' : source,
      weights: [...f.weights].sort(),
      files: f.files,
      weight: Math.round(f.score),
    });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 12);
}

// ------------------------------------------------------------------ type scale ---

const TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'button', 'small'];

/** Removes @media blocks that only apply to small screens, so the desktop scale wins. */
function desktopCss(css: string): string {
  let out = '';
  let i = 0;
  const re = /@media[^{]*max-width[^{]*\{/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    out += css.slice(i, m.index);
    let depth = 1;
    let j = m.index + m[0].length;
    for (; j < css.length && depth > 0; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
    }
    i = j;
    re.lastIndex = j;
  }
  return out + css.slice(i);
}

/** CSS length to px at desktop size. clamp() and min()/max() take their largest value. */
/** `base` is what 1em means (the element's font size), `root` what 1rem means. */
export function toPx(raw: string, base = 16, root = base): number | null {
  const v = raw.trim().toLowerCase();
  const fn = v.match(/^(?:clamp|max|min)\((.*)\)$/);
  if (fn) {
    const parts = fn[1].split(',').map((p) => toPx(p, base, root)).filter((n): n is number => n !== null);
    return parts.length ? Math.max(...parts) : null;
  }
  const m = v.match(/^(-?[\d.]+)(px|rem|em|pt|%)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2] ?? 'px';
  if (unit === 'px') return n;
  if (unit === 'rem') return n * root;
  if (unit === 'em') return n * base;
  if (unit === 'pt') return (n * 4) / 3;
  return (n / 100) * base;
}

const weightOf = (w: string | undefined) => {
  if (!w) return null;
  const t = w.trim().toLowerCase();
  if (t === 'bold' || t === 'bolder') return 700;
  if (t === 'normal') return 400;
  if (t === 'lighter') return 300;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
};

/** Measured styles from the browser, as plain strings. */
export interface MeasuredType {
  tag: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
}

/**
 * The site's type scale: h1–h6, body, button and small text. Measured values from the rendered
 * page are exact; otherwise the desktop CSS for those tags is followed (later rules win, like the
 * cascade) with browser defaults filling the gaps.
 */
export function extractTypeScale(cssTexts: string[], html: string, measured?: MeasuredType[]): TypeStyle[] {
  if (measured?.length) {
    const out: TypeStyle[] = [];
    for (const m of measured) {
      const size = toPx(m.fontSize);
      if (!size || out.some((o) => o.tag === m.tag)) continue;
      const lh = m.lineHeight === 'normal' ? null : toPx(m.lineHeight, size);
      const ls = m.letterSpacing === 'normal' ? null : toPx(m.letterSpacing, size);
      out.push({
        tag: m.tag,
        family: primaryFamily(m.fontFamily) ?? m.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
        sizePx: Math.round(size * 10) / 10,
        weight: weightOf(m.fontWeight) ?? 400,
        lineHeightPx: lh ? Math.round(lh * 10) / 10 : null,
        letterSpacingPx: ls ? Math.round(ls * 100) / 100 : null,
        transform: m.textTransform && m.textTransform !== 'none' ? m.textTransform : null,
        from: 'measured',
      });
    }
    return out.sort((a, b) => TAGS.indexOf(a.tag) - TAGS.indexOf(b.tag));
  }

  const $ = cheerio.load(html);
  const css = desktopCss([$('style').map((_, el) => $(el).text()).get().join('\n'), ...cssTexts].join('\n').slice(0, 3_000_000));
  const vars = new Map<string, string>();
  for (const m of css.matchAll(/(--[\w-]{1,60})\s*:\s*([^;}{]{1,200})/g)) if (!vars.has(m[1])) vars.set(m[1], m[2].trim());
  const resolve = (v: string, d = 0): string =>
    d > 5 ? v : v.replace(/var\(\s*(--[\w-]{1,60})\s*(?:,\s*([^)]*))?\)/g, (_, n: string, fb?: string) => resolve(vars.get(n) ?? fb ?? '', d + 1));
  // html { font-size: 62.5% } changes what 1rem means
  let rootPx = 16;
  for (const m of css.matchAll(/(?:^|[}\s,])html\s*\{([^}]*)\}/gi)) {
    const fs = m[1].match(/font-size\s*:\s*([^;]+)/i);
    const px = fs ? toPx(resolve(fs[1]), 16) : null;
    if (px) rootPx = px;
  }
  const DEFAULT: Record<string, [number, number]> = { h1: [2, 700], h2: [1.5, 700], h3: [1.17, 700], h4: [1, 700], h5: [0.83, 700], h6: [0.67, 700], body: [1, 400], button: [0.8333, 400], small: [0.8333, 400] };
  const found = new Map<string, { size?: number; weight?: number; lh?: number | null; ls?: number | null; family?: string; transform?: string }>();
  for (const m of css.matchAll(/([^{}@]{1,400})\{([^{}]{1,4000})\}/g)) {
    const sels = m[1].split(',').map((s) => s.trim().toLowerCase());
    const decl = m[2];
    for (const tag of TAGS) {
      // the bare tag, or the common .h1 / .text-h1 helper classes
      if (!sels.some((s) => s === tag || s === `.${tag}` || (tag === 'body' && (s === 'html body' || s === ':root body')))) continue;
      const cur = found.get(tag) ?? {};
      const get = (prop: string) => decl.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;!]+)`, 'i'))?.[1];
      const fsz = get('font-size');
      const size = fsz ? toPx(resolve(fsz), rootPx, rootPx) : null;
      if (size) cur.size = size;
      const w = weightOf(get('font-weight') && resolve(get('font-weight')!));
      if (w) cur.weight = w;
      const lh = get('line-height');
      if (lh) {
        const r = resolve(lh).trim();
        cur.lh = r === 'normal' ? null : /^[\d.]+$/.test(r) ? parseFloat(r) * (cur.size ?? rootPx * (DEFAULT[tag]?.[0] ?? 1)) : toPx(r, cur.size ?? rootPx, rootPx);
      }
      const ls = get('letter-spacing');
      if (ls) cur.ls = resolve(ls).trim() === 'normal' ? null : toPx(resolve(ls), cur.size ?? rootPx, rootPx);
      const ff = get('font-family');
      if (ff) cur.family = primaryFamily(resolve(ff)) ?? cur.family;
      const tt = get('text-transform');
      if (tt) cur.transform = tt.trim();
      found.set(tag, cur);
    }
  }
  // utility-class sites (Tailwind and co.) style the element itself: <h1 class="text-5xl font-bold">
  const single = new Map<string, string>();
  for (const m of css.matchAll(/(?:^|[}\s])\.((?:\\.|[\w-])+)\s*\{([^{}]{1,600})\}/g)) {
    const cls = m[1].replace(/\\(.)/g, '$1');
    single.set(cls, (single.get(cls) ?? '') + ';' + m[2]);
  }
  const ELEMENT: Record<string, string> = { h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', body: 'main p, article p, p', button: 'button, a[class*="btn"], a[class*="button"]' };
  for (const [tag, sel] of Object.entries(ELEMENT)) {
    const el = $(sel).first();
    const classes = (el.attr('class') || '').split(/\s+/).filter(Boolean);
    if (!classes.length) continue;
    const cur = found.get(tag) ?? {};
    for (const c of classes) {
      const decl = single.get(c);
      if (!decl) continue;
      const get = (prop: string) => [...decl.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;!]+)`, 'gi'))].pop()?.[1];
      const fsz = get('font-size');
      const size = fsz ? toPx(resolve(fsz), rootPx, rootPx) : null;
      if (size) cur.size = size;
      const w = weightOf(get('font-weight') && resolve(get('font-weight')!));
      if (w) cur.weight = w;
      const lh = get('line-height');
      if (lh) {
        const r = resolve(lh).trim();
        cur.lh = /^[\d.]+$/.test(r) ? parseFloat(r) * (cur.size ?? rootPx) : toPx(r, cur.size ?? rootPx, rootPx);
      }
      const ls = get('letter-spacing');
      if (ls) cur.ls = toPx(resolve(ls), cur.size ?? rootPx, rootPx);
      const ff = get('font-family');
      if (ff) cur.family = primaryFamily(resolve(ff)) ?? cur.family;
      const tt = get('text-transform');
      if (tt) cur.transform = tt.trim();
    }
    found.set(tag, cur);
  }
  const bodyFamily = found.get('body')?.family ?? 'sans-serif';
  const out: TypeStyle[] = [];
  for (const tag of TAGS) {
    const f = found.get(tag);
    if (!f && !['h1', 'h2', 'h3', 'body'].includes(tag)) continue;
    const [scale, w] = DEFAULT[tag];
    const size = f?.size ?? scale * rootPx;
    out.push({
      tag,
      family: f?.family ?? (tag.startsWith('h') ? found.get('h1')?.family ?? bodyFamily : bodyFamily),
      sizePx: Math.round(size * 10) / 10,
      weight: f?.weight ?? w,
      lineHeightPx: f?.lh ? Math.round(f.lh * 10) / 10 : null,
      letterSpacingPx: f?.ls ? Math.round(f.ls * 100) / 100 : null,
      transform: f?.transform && f.transform !== 'none' ? f.transform : null,
      from: 'css',
    });
  }
  return out;
}
