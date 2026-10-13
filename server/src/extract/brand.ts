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

const dist = (a: string, b: string) => {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

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

/** Stock colors that frameworks ship with. A site rarely picks one of these as its brand. */
const FRAMEWORK_DEFAULTS = new Set([
  // Tailwind 500/600/700
  '#EF4444', '#DC2626', '#B91C1C', '#F97316', '#EA580C', '#F59E0B', '#D97706', '#EAB308', '#CA8A04', '#84CC16', '#65A30D',
  '#22C55E', '#16A34A', '#15803D', '#10B981', '#059669', '#14B8A6', '#0D9488', '#06B6D4', '#0891B2', '#0EA5E9', '#0284C7',
  '#3B82F6', '#2563EB', '#1D4ED8', '#6366F1', '#4F46E5', '#8B5CF6', '#7C3AED', '#A855F7', '#9333EA', '#D946EF', '#EC4899', '#DB2777', '#F43F5E', '#E11D48',
  // Bootstrap 4/5
  '#007BFF', '#0D6EFD', '#28A745', '#198754', '#DC3545', '#FFC107', '#17A2B8', '#0DCAF0', '#6610F2', '#6F42C1', '#E83E8C', '#D63384', '#FD7E14', '#20C997',
  // WordPress presets and notices, iOS blue
  '#FF6900', '#FCB900', '#7BDCB5', '#00D084', '#8ED1FC', '#0693E3', '#EB144C', '#F78DA7', '#9B51E0', '#CF2E2E', '#DC3232', '#46B450', '#FFB900', '#00A0D2', '#007AFF',
]);

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
  for (const [name, value] of vars) {
    const role = NAME_ROLE.find(([re]) => re.test(name))?.[1];
    if (!role || /foreground|-fg\b|text|border|muted|shadow|ring|input|disabled|neutral|subtle|placeholder|error|danger|success|warning|gr[ae]y|black|white|overlay|backdrop/i.test(name)) continue;
    // defaults shipped by libraries (sliders, prose, players), not chosen by the site
    if (/^--(swiper|tw-|plyr|pswp|fancybox|splide|glide|vjs|toastify|select2|flatpickr|mejs|slick|lg-|f-|wp--preset)/i.test(name)) continue;
    const hex = colorOf(value);
    if (!hex || isNeutral(hex)) continue;
    out.push({ hex, role, source: name, weight: role === 'brand' ? 820 : role === 'accent' ? 600 : 300 });
  }

  // colors by where they are used: buttons and links carry the brand, utility classes do not.
  // With the page's HTML at hand, a rule only counts as often as the page really uses its classes.
  const scores = new Map<string, number>();
  const bump = (hex: string | null, by: number) => {
    if (!hex || isNeutral(hex)) return;
    if (FRAMEWORK_DEFAULTS.has(hex)) by *= 0.2; // Tailwind / Bootstrap / WordPress stock colors
    scores.set(hex, (scores.get(hex) ?? 0) + by);
  };
  for (const m of text.matchAll(/([^{}]{1,400})\{([^{}]{1,4000})\}/g)) {
    const sel = m[1].trim();
    if (sel.startsWith('@') || /^(from|to|\d+%)/.test(sel)) continue;
    let ctx = 1;
    if (/(^|[\s,.#>])(button|\.btn|\.button|\[type=.?submit|\.cta)|btn-primary|button--primary|primary/i.test(sel)) ctx = 12;
    else if (/(^|[\s,>])a(:hover|:focus|[\s,{.:]|$)|\.link|nav|header|navbar|logo|brand|hero/i.test(sel)) ctx = 6;
    else if (/(^|[\s,>])h[1-3]\b|\.title|heading|accent|highlight|badge/i.test(sel)) ctx = 4;
    // utility frameworks and syntax-highlight themes add hundreds of colors nobody sees
    const stock = /\.(text|bg|border|fill|stroke|from|via|to|ring|decoration|outline|shadow)-[a-z]+-\d{2,4}\b|\.hljs|\.token\.|\.cm-|\.ace_|\.prism|\.alert-|\.table-|\.list-group-item-|\.btn-(secondary|success|danger|warning|info|light|dark)\b|\.(has-[a-z-]+-color)/i.test(sel);
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
    for (const d of m[2].matchAll(/(^|;)\s*(background(?:-color)?|color|border(?:-color)?|fill|stroke|outline-color)\s*:\s*([^;]+)/gi)) {
      const prop = d[2].toLowerCase();
      const propW = prop.startsWith('background') ? 1.5 : prop === 'color' ? 1 : 0.5;
      for (const c of resolve(d[3]).matchAll(COLOR_RE)) bump(parseColor(c[0]), ctx * propW);
    }
  }
  // colors written straight into the HTML: style="" and Tailwind's bg-[#hex]
  for (const c of usage?.inlineColors ?? []) bump(parseColor(c), 6);
  const top = [...scores].sort((a, b) => b[1] - a[1]);
  const max = top[0]?.[1] ?? 1;
  for (const [hex, n] of top.slice(0, 8)) {
    if (usage && n < max * 0.08) break; // barely used next to the main colors: noise, not brand
    // relative to the strongest color, so a page with many rules does not drown the theme color
    out.push({ hex, role: 'palette', source: usage ? 'used on page' : 'stylesheet', weight: Math.round(Math.min(n * 4, 560) * (usage ? 0.4 + 0.6 * (n / max) : 1)) });
  }
  return out;
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
    cur.n += W[u.part] ?? 1;
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

/** Merge sources, drop near-duplicates (keeping the strongest), order by importance, cap the list. */
export function mergeBrandColors(all: BrandColor[], cap = 10): BrandColor[] {
  const sorted = all.map((c) => ({ ...c })).sort((a, b) => b.weight - a.weight);
  const out: BrandColor[] = [];
  for (const c of sorted) {
    const twin = out.find((o) => dist(o.hex, c.hex) < 24);
    if (twin) {
      // the same color found by several methods is stronger evidence
      twin.weight += Math.min(120, Math.round(c.weight / 6));
      continue;
    }
    out.push(c);
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, cap);
}
