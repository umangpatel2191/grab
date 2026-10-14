import * as cheerio from 'cheerio';
import type { BrandColor, ColorRole } from '../../../shared/types';

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
export const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(), hsla(). Mostly transparent colors give null. */
export function parseColor(input: string): string | null {
  const s = input.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      if (h.length === 4 && parseInt(h[3] + h[3], 16) < 128) return null;
      return toHex(parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16));
    }
    if (h.length === 6 || h.length === 8) {
      if (h.length === 8 && parseInt(h.slice(6), 16) < 128) return null;
      return toHex(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
    }
    return null;
  }
  m = s.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const ch = (v: string) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    if (m[4]) {
      const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (a < 0.5) return null;
    }
    return toHex(ch(m[1]), ch(m[2]), ch(m[3]));
  }
  m = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4]) {
      const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (a < 0.5) return null;
    }
    const [r, g, b] = hslToRgb(parseFloat(m[1]), parseFloat(m[2]) / 100, parseFloat(m[3]) / 100);
    return toHex(r, g, b);
  }
  return null;
}

export function rgbOf(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Grays, near-black and near-white. Not interesting as "brand" unless the site says so explicitly. */
export function isNeutral(hex: string): boolean {
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 510;
  const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
  // low chroma catches pale tints like #EAECF0 that HSL saturation calls "colorful"
  return sat < 0.14 || max - min < 22 || l > 0.95 || l < 0.05;
}

export const colorDistance = (a: string, b: string) => dist(a, b);

/** 0 for grey, 1 for a pure vivid color. */
export function colorfulness(hex: string): number {
  const [r, g, b] = rgbOf(hex);
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

function dist(a: string, b: string) {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

export interface BrandHints {
  colors: BrandColor[];
  inlineCss: string;
  manifestUrl: string | null;
}

const NAME_ROLE: [RegExp, ColorRole][] = [
  [/(^|[-_])(primary|brand|main|theme)([-_]|$)/i, 'brand'],
  [/(accent|secondary|highlight|cta|link)/i, 'accent'],
  [/(^|[-_])(bg|background|surface)([-_]|$)/i, 'background'],
];

export function extractBrandHints(html: string, pageUrl: string): BrandHints {
  const $ = cheerio.load(html);
  const colors: BrandColor[] = [];
  const add = (raw: string | undefined, role: ColorRole, source: string, weight: number) => {
    const hex = raw ? parseColor(raw) : null;
    if (hex) colors.push({ hex, role, source, weight });
  };
  $('meta[name="theme-color"]').each((_, el) => add($(el).attr('content'), 'theme', 'theme-color', 1000));
  $('meta[name="msapplication-TileColor"], meta[name="msapplication-navbutton-color"]').each((_, el) => add($(el).attr('content'), 'theme', 'tile color', 900));
  $('link[rel="mask-icon"]').each((_, el) => add($(el).attr('color'), 'brand', 'mask icon', 900));
  let inlineCss = '';
  $('style').each((_, el) => {
    inlineCss += $(el).text().slice(0, 200_000) + '\n';
  });
  let manifestUrl: string | null = null;
  const mf = $('link[rel="manifest"]').first().attr('href');
  if (mf) {
    try {
      const u = new URL(mf, pageUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') manifestUrl = u.toString();
    } catch {
      /* ignore */
    }
  }
  return { colors, inlineCss: inlineCss.slice(0, 400_000), manifestUrl };
}

export function colorsFromManifest(json: string): BrandColor[] {
  try {
    const m = JSON.parse(json) as { theme_color?: unknown; background_color?: unknown };
    const out: BrandColor[] = [];
    if (typeof m.theme_color === 'string') {
      const hex = parseColor(m.theme_color);
      if (hex) out.push({ hex, role: 'theme', source: 'app manifest', weight: 950 });
    }
    if (typeof m.background_color === 'string') {
      const hex = parseColor(m.background_color);
      if (hex) out.push({ hex, role: 'background', source: 'app manifest', weight: 400 });
    }
    return out;
  } catch {
    return [];
  }
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]{5,40}\)|hsla?\([^)]{5,40}\)/g;

/** Brand-ish colors from CSS text: named custom properties first, then the most-used non-neutral colors. */
export interface PageUsage {
  /** How many elements use each class. */
  classes: Map<string, number>;
  /** Colors written in style="" attributes and arbitrary-value classes. */
  inlineColors: string[];
}

/** What the page's HTML actually uses, so stylesheet colors can be weighted by real use. */
export function usageFromHtml(html: string): PageUsage {
  const $ = cheerio.load(html);
  const classes = new Map<string, number>();
  const inlineColors: string[] = [];
  $('[class]').each((_, el) => {
    for (const c of ($(el).attr('class') || '').split(/\s+/)) {
      if (!c) continue;
      classes.set(c, (classes.get(c) ?? 0) + 1);
      const arb = c.match(/-\[(#[0-9a-fA-F]{3,8})\]$/);
      if (arb) inlineColors.push(arb[1]);
    }
  });
  $('[style]').each((_, el) => {
    for (const m of ($(el).attr('style') || '').matchAll(/(?:background(?:-color)?|color|border-color|fill)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/gi)) inlineColors.push(m[1]);
  });
  return { classes, inlineColors: inlineColors.slice(0, 2000) };
}

export function colorsFromCss(css: string, usage?: PageUsage): BrandColor[] {
  const out: BrandColor[] = [];
  const text = css.slice(0, 600_000);
  // custom properties, first definition wins (that is usually :root, not a dark-mode override)
  const vars = new Map<string, string>();
  for (const m of text.matchAll(/(--[\w-]{1,60})\s*:\s*([^;}{]{1,120})/g)) {
    if (!vars.has(m[1])) vars.set(m[1], m[2].trim());
  }
  const resolve = (v: string, depth = 0): string => {
    if (depth > 6) return v;
    return v.replace(/var\(\s*(--[\w-]{1,60})\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name: string, fb?: string) => {
      const got = vars.get(name);
      return got !== undefined ? resolve(got, depth + 1) : (fb ?? '').trim();
    });
  };
  const colorOf = (v: string) => parseColor(resolve(v)) ?? parseChannels(resolve(v));

  // Colors by where they are used: buttons and links carry the brand. With the page's HTML at hand
  // a rule only counts as often as the page really uses its classes, so the colors of libraries
  // and themes that ship CSS for things this page never shows simply drop out.
  const scores = new Map<string, number>();
  const usedVars = new Set<string>();
  const markVars = (value: string, depth = 0) => {
    for (const r of value.matchAll(/var\(\s*(--[\w-]{1,60})/g)) {
      if (usedVars.has(r[1]) || depth > 6) continue;
      usedVars.add(r[1]);
      const inner = vars.get(r[1]);
      if (inner) markVars(inner, depth + 1);
    }
  };
  const bump = (hex: string | null, by: number) => {
    if (!hex || isNeutral(hex)) return;
    scores.set(hex, (scores.get(hex) ?? 0) + by);
  };
  for (const m of text.matchAll(/([^{}]{1,400})\{([^{}]{1,4000})\}/g)) {
    const sel = m[1].trim();
    if (sel.startsWith('@') || /^(from|to|\d+%)/.test(sel)) continue;
    let ctx = 1;
    if (/(^|[\s,.#>])(button|\.btn|\.button|\[type=.?submit|\.cta)|btn-primary|button--primary|primary/i.test(sel)) ctx = 12;
    else if (/(^|[\s,>])a(:hover|:focus|[\s,{.:]|$)|\.link|nav|header|navbar|logo|brand|hero/i.test(sel)) ctx = 6;
    else if (/(^|[\s,>])h[1-3]\b|\.title|heading|accent|highlight|badge/i.test(sel)) ctx = 4;
    // utility-class naming (text-blue-500) and code-highlight themes: hundreds of colors nobody sees
    const stock = /\.(text|bg|border|fill|stroke|from|via|to|ring|decoration|outline|shadow)-[a-z]+-\d{2,4}\b|\.hljs|\.token\.|\.cm-|\.ace_|\.prism/i.test(sel);
    if (usage) {
      let best = -1; // -1: the selector has no classes at all
      for (const part of sel.split(',')) {
        const classes = [...part.matchAll(/\.((?:\\.|[\w-])+)/g)].map((c) => c[1].replace(/\\(.)/g, '$1'));
        if (!classes.length) {
          best = Math.max(best, 0.5);
          continue;
        }
        // a compound selector applies as often as its rarest class
        best = Math.max(best, Math.min(...classes.map((c) => usage.classes.get(c) ?? 0)));
      }
      if (best === 0) continue; // nothing on this page uses the rule
      if (best > 0.5) ctx *= Math.min(best, 40) * (/brand|primary|accent|secondary|theme|main/i.test(sel) ? 3 : 1);
      else if (stock) ctx = 0.1;
    } else if (stock) ctx = 0.1;
    markVars(m[2]);
    for (const d of m[2].matchAll(/(^|;)\s*(background(?:-color)?|color|border(?:-color)?|fill|stroke|outline-color)\s*:\s*([^;]+)/gi)) {
      const prop = d[2].toLowerCase();
      const propW = prop.startsWith('background') ? 1.5 : prop === 'color' ? 1 : 0.5;
      for (const c of resolve(d[3]).matchAll(COLOR_RE)) bump(parseColor(c[0]), ctx * propW);
    }
  }
  // colors written straight into the HTML: style="" and Tailwind's bg-[#hex]
  for (const c of usage?.inlineColors ?? []) bump(parseColor(c), 6);

  // Named brand variables (--primary, --brand…). With the page at hand, only the ones that a rule
  // the page uses actually refers to: a library's own --x-primary does not count unless used.
  for (const [name, value] of vars) {
    const role = NAME_ROLE.find(([re]) => re.test(name))?.[1];
    if (!role || /foreground|-fg\b|text|border|muted|shadow|ring|input|disabled|neutral|subtle|placeholder|error|danger|success|warning|gr[ae]y|black|white|overlay|backdrop/i.test(name)) continue;
    if (usage && !usedVars.has(name)) continue;
    const hex = colorOf(value);
    if (!hex || isNeutral(hex)) continue;
    out.push({ hex, role, source: name, weight: role === 'brand' ? 820 : role === 'accent' ? 600 : 300 });
  }

  const top = [...scores].sort((a, b) => b[1] - a[1]);
  const max = top[0]?.[1] ?? 1;
  for (const [hex, n] of top.slice(0, 8)) {
    if (usage && n < max * 0.08) break; // barely used next to the main colors: noise, not brand
    // relative to the strongest color, so a page with many rules does not drown the theme color
    out.push({ hex, role: 'palette', source: usage ? 'used on page' : 'stylesheet', weight: Math.round(Math.min(n * 4, 560) * (usage ? 0.4 + 0.6 * (n / max) : 1)) });
  }
  return out;
}

/**
 * Colors of the rendered page itself (photos and video hidden), by how much of the page they cover.
 * The first screen counts double: it is where a brand shows itself. Neutrals are kept here, marked
 * "neutral", because a real palette has its dark and light too.
 */
export async function colorsFromScreenshot(sharp: any, png: Buffer): Promise<BrandColor[]> {
  try {
    const { data, info } = await sharp(png, { limitInputPixels: 80_000_000, failOn: 'none' })
      .resize({ width: 160, kernel: 'nearest' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const firstScreen = Math.round((900 / 1366) * info.width); // rows of the first viewport at this scale
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
    let total = 0;
    for (let y = 0; y < info.height; y++) {
      const w = y < firstScreen ? 2 : 1;
      for (let x = 0; x < info.width; x++) {
        const o = (y * info.width + x) * 3;
        const r = data[o], g = data[o + 1], b = data[o + 2];
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        cur.n += w;
        cur.r += r * w;
        cur.g += g * w;
        cur.b += b * w;
        buckets.set(key, cur);
        total += w;
      }
    }
    // join neighbouring buckets (anti-aliasing, subtle gradients) into real colors
    const clusters: { hex: string; n: number }[] = [];
    for (const v of [...buckets.values()].sort((a, b) => b.n - a.n)) {
      const hex = toHex(v.r / v.n, v.g / v.n, v.b / v.n);
      const near = clusters.find((c) => dist(c.hex, hex) < 30);
      if (near) near.n += v.n;
      else if (clusters.length < 40) clusters.push({ hex, n: v.n });
    }
    const out: BrandColor[] = [];
    for (const c of clusters.sort((a, b) => b.n - a.n)) {
      const share = c.n / total;
      if (isNeutral(c.hex)) {
        if (share >= 0.02) out.push({ hex: c.hex, role: 'neutral', source: 'page', weight: Math.round(200 + share * 600), share });
        continue;
      }
      if (share < 0.005) continue; // a few pixels of an icon or anti-aliasing: not a brand color
      out.push({ hex: c.hex, role: 'brand', source: 'page', weight: Math.round(Math.min(980, 520 + Math.sqrt(share) * 900 * (0.5 + colorfulness(c.hex)))), share });
    }
    return out.slice(0, 14);
  } catch {
    return [];
  }
}

/** "59 130 246" (RGB channels) or "221 83% 53%" (HSL channels): how Tailwind and shadcn themes store colors. */
export function parseChannels(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*\/\s*[\d.]+%?)?$/);
  if (m && [m[1], m[2], m[3]].every((x) => Number(x) <= 255)) return toHex(+m[1], +m[2], +m[3]);
  m = s.match(/^([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%$/);
  if (m) {
    const [r, g, b] = hslToRgb(parseFloat(m[1]), parseFloat(m[2]) / 100, parseFloat(m[3]) / 100);
    return toHex(r, g, b);
  }
  return null;
}

/** Colors measured on the rendered page (deep scan). These match what visitors actually see. */
export function colorsFromUi(ui: { color: string; part: string }[]): BrandColor[] {
  const W: Record<string, number> = { button: 30, header: 14, link: 12, accent: 8, heading: 5 };
  const scores = new Map<string, { n: number; part: string }>();
  for (const u of ui) {
    const hex = parseColor(u.color);
    if (!hex || isNeutral(hex)) continue;
    const cur = scores.get(hex) ?? { n: 0, part: u.part };
    // a vivid color carries a brand; pale tints and greyish shades of it are supporting colors
    cur.n += (W[u.part] ?? 1) * (0.25 + colorfulness(hex));
    if ((W[u.part] ?? 0) > (W[cur.part] ?? 0)) cur.part = u.part;
    scores.set(hex, cur);
  }
  return [...scores]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 6)
    .map(([hex, v]) => ({
      hex,
      role: v.part === 'button' || v.part === 'header' ? 'brand' : 'accent',
      source: v.part === 'button' ? 'buttons' : v.part === 'header' ? 'header' : v.part === 'link' ? 'links' : v.part === 'heading' ? 'headings' : 'accents',
      weight: Math.min(980, 760 + v.n * 4),
    }));
}

/** Colors drawn inside an inline SVG logo. */
export function colorsFromSvgPaints(paints: string[]): BrandColor[] {
  const counts = new Map<string, number>();
  for (const p of paints) {
    const hex = parseColor(p);
    if (hex && !isNeutral(hex)) counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([hex, n]) => ({ hex, role: 'logo' as const, source: 'logo', weight: 760 + Math.min(n, 40) }));
}

/** Dominant non-neutral colors of an image (logo, icon). Needs sharp; returns [] without it. */
export async function colorsFromImage(sharp: any, buf: Buffer, source = 'logo'): Promise<BrandColor[]> {
  try {
    const { data, info } = await sharp(buf, { limitInputPixels: 40_000_000, failOn: 'none' })
      .resize(48, 48, { fit: 'inside', kernel: 'nearest' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i < info.width * info.height; i++) {
      const o = i * 4;
      if (data[o + 3] < 200) continue;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      if (isNeutral(toHex(r, g, b))) continue;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      cur.n++; cur.r += r; cur.g += g; cur.b += b;
      buckets.set(key, cur);
    }
    const total = [...buckets.values()].reduce((a, v) => a + v.n, 0);
    const picked: BrandColor[] = [];
    for (const v of [...buckets.values()].sort((a, b) => b.n - a.n)) {
      if (v.n < Math.max(4, total * 0.04)) break; // anti-aliased edge blends are not brand colors
      const hex = toHex(v.r / v.n, v.g / v.n, v.b / v.n);
      if (picked.some((p) => dist(p.hex, hex) < 60)) continue;
      picked.push({ hex, role: 'logo', source, weight: 700 + Math.min(v.n, 100) });
      if (picked.length >= 3) break;
    }
    return picked;
  } catch {
    return [];
  }
}

const lum = (hex: string) => {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * The final palette: brand colors strongest first (near-duplicates merged; a color several methods
 * agree on ranks higher), then the page's dark and light neutrals. Names are given by rank:
 * Primary, Secondary, Accent…, Dark, Light.
 */
export function mergeBrandColors(all: BrandColor[], cap = 10): BrandColor[] {
  const sorted = all.map((c) => ({ ...c })).sort((a, b) => b.weight - a.weight);
  const colors: BrandColor[] = [];
  const neutrals: BrandColor[] = [];
  for (const c of sorted) {
    const bucket = isNeutral(c.hex) ? neutrals : colors;
    const twin = bucket.find((o) => dist(o.hex, c.hex) < (bucket === colors ? 30 : 20));
    if (twin) {
      twin.weight += Math.min(120, Math.round(c.weight / 6));
      if (c.share !== undefined) twin.share = Math.max(twin.share ?? 0, c.share);
      continue;
    }
    bucket.push(c);
  }
  // the vivid color leads; near-black navies and pale tints are the supporting cast
  for (const c of colors) c.weight = Math.round(c.weight * (0.6 + 0.4 * colorfulness(c.hex)));
  colors.sort((a, b) => b.weight - a.weight);
  // far weaker than the main color: noise, not part of the brand
  const top = colors[0]?.weight ?? 0;
  const keep = colors.filter((c, i) => i === 0 || c.weight >= top * 0.5).slice(0, Math.max(1, cap - 2));
  keep.forEach((c, i) => (c.name = i === 0 ? 'Primary' : i === 1 ? 'Secondary' : 'Accent'));
  const pick = (test: (l: number) => boolean) => neutrals.filter((n) => test(lum(n.hex))).sort((a, b) => b.weight - a.weight)[0];
  const dark = pick((l) => l < 0.2);
  const light = pick((l) => l > 0.75);
  const out = [...keep];
  if (dark) out.push({ ...dark, role: 'neutral', name: keep.length ? 'Dark' : 'Primary' });
  if (light) out.push({ ...light, role: 'neutral', name: 'Light' });
  return out.slice(0, cap);
}
