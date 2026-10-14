// Brand guidelines deck (Figma main thread): 16:9 slides on one grid, set in the brand's own
// typeface when Figma has it. Every text and logo is placed on a background it is legible on.
// It also creates color variables, color styles, text styles and icon components, so the result
// is a working design-system starter as well as a presentation.
import type { BrandBookData } from './shared/messages';

const W = 1920;
const H = 1080;
const M = 120; // outer margin
const INK: RGB = { r: 0.067, g: 0.067, b: 0.075 };
const PAPER: RGB = { r: 1, g: 1, b: 1 };
const LINE_ON_LIGHT = 0.1; // opacity of hairlines

type Font = { family: string; style: string };
type Graphic = BrandBookData['logo'];

// ------------------------------------------------------------------ color math

function rgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
const hexOf = (c: RGB) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
function lum(c: RGB): number {
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
const ratio = (l1: number, l2: number) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
const contrast = (a: RGB, b: RGB) => ratio(lum(a), lum(b));
const mix = (a: RGB, b: RGB, t: number): RGB => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
const grade = (r: number) => (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'AA Large' : 'Fail');
const solid = (c: RGB, opacity = 1): SolidPaint[] => [{ type: 'SOLID', color: c, opacity }];
function hsl(c: RGB): string {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === c.r ? (c.g - c.b) / d + (c.g < c.b ? 6 : 0) : max === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4;
    h *= 60;
  }
  return `${Math.round(h)}° ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// ------------------------------------------------------------------ fonts

class Type {
  private styles = new Map<string, string[]>();
  private names = new Map<string, string>();
  private loaded = new Set<string>();
  async init() {
    for (const f of await figma.listAvailableFontsAsync()) {
      const k = f.fontName.family.toLowerCase();
      this.styles.set(k, [...(this.styles.get(k) ?? []), f.fontName.style]);
      this.names.set(k, f.fontName.family);
    }
  }
  /** The installed spelling of a family, or null when Figma does not have it. */
  resolve(name: string): string | null {
    return this.names.get(name.toLowerCase()) ?? null;
  }
  styleFor(family: string, weight: number): string {
    const styles = this.styles.get(family.toLowerCase()) ?? [];
    const names: Record<number, string[]> = {
      100: ['Thin', 'Hairline'], 200: ['ExtraLight', 'Extra Light', 'UltraLight'], 300: ['Light'], 400: ['Regular', 'Normal', 'Book', 'Roman'],
      500: ['Medium'], 600: ['SemiBold', 'Semi Bold', 'DemiBold'], 700: ['Bold'], 800: ['ExtraBold', 'Extra Bold', 'Heavy'], 900: ['Black', 'Heavy'],
    };
    const w = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
    for (let d = 0; d <= 400; d += 100) for (const cand of [w + d, w - d]) for (const n of names[cand] ?? []) if (styles.includes(n)) return n;
    return styles.includes('Regular') ? 'Regular' : styles[0] ?? 'Regular';
  }
  async load(f: Font): Promise<Font> {
    const key = `${f.family}|${f.style}`;
    if (this.loaded.has(key)) return f;
    try {
      await figma.loadFontAsync(f);
      this.loaded.add(key);
      return f;
    } catch {
      if (f.family === 'Inter') return { family: 'Inter', style: 'Regular' };
      return this.load({ family: 'Inter', style: /bold|black|heavy/i.test(f.style) ? 'Bold' : /semi|medium/i.test(f.style) ? 'Semi Bold' : 'Regular' });
    }
  }
}

// ------------------------------------------------------------------ building blocks

interface Ctx {
  t: Type;
  display: Font; // brand heading font (or Inter Bold)
  displayLight: Font;
  body: Font;
  bodyMedium: Font;
  bodySemi: Font;
  brandName: string;
  host: string;
}

async function txt(ctx: Ctx, chars: string, size: number, font: Font, color: RGB, o: { w?: number; lh?: number; ls?: number; upper?: boolean; opacity?: number; align?: 'LEFT' | 'CENTER' | 'RIGHT' } = {}): Promise<TextNode> {
  const f = await ctx.t.load(font);
  const n = figma.createText();
  n.fontName = f;
  n.fontSize = size;
  n.fills = solid(color, o.opacity ?? 1);
  if (o.lh) n.lineHeight = { value: o.lh, unit: 'PIXELS' };
  if (o.ls !== undefined) n.letterSpacing = { value: o.ls, unit: 'PERCENT' };
  if (o.upper) n.textCase = 'UPPER';
  if (o.align) n.textAlignHorizontal = o.align;
  n.characters = chars || ' ';
  if (o.w) {
    n.textAutoResize = 'HEIGHT';
    n.resize(o.w, n.height);
  }
  return n;
}

function put<T extends SceneNode>(parent: FrameNode, node: T, x: number, y: number): T {
  parent.appendChild(node);
  node.x = Math.round(x);
  node.y = Math.round(y);
  return node;
}

function rect(w: number, h: number, fill: RGB, radius = 0, opacity = 1): RectangleNode {
  const r = figma.createRectangle();
  r.resize(Math.max(1, w), Math.max(1, h));
  r.fills = solid(fill, opacity);
  r.cornerRadius = radius;
  return r;
}

function box(name: string, w: number, h: number, fill: RGB | null, radius = 0): FrameNode {
  const f = figma.createFrame();
  f.name = name;
  f.resize(Math.max(1, w), Math.max(1, h));
  f.fills = fill ? solid(fill) : [];
  f.cornerRadius = radius;
  f.clipsContent = true;
  return f;
}

/** The text color for a background: whichever of the palette's dark and light reads best. */
function inkOn(bg: RGB, dark: RGB, light: RGB): RGB {
  const cd = contrast(bg, dark);
  const cl = contrast(bg, light);
  if (Math.max(cd, cl) >= 4.5) return cd >= cl ? dark : light;
  return contrast(bg, INK) >= contrast(bg, PAPER) ? INK : PAPER;
}

/** A slide with the shared chrome: section label top-left, brand + page number in the footer. */
async function slide(ctx: Ctx, n: number, section: string, bg: RGB, ink: RGB): Promise<FrameNode> {
  const s = box(`${String(n).padStart(2, '0')} — ${section}`, W, H, bg);
  const label = await txt(ctx, `${String(n).padStart(2, '0')}  —  ${section}`, 18, ctx.bodyMedium, ink, { ls: 8, upper: true, opacity: 0.6 });
  put(s, label, M, 72);
  const brand = await txt(ctx, ctx.brandName, 18, ctx.bodySemi, ink, { opacity: 0.8 });
  put(s, brand, M, H - 72 - brand.height);
  const right = await txt(ctx, `Brand Guidelines  ·  ${String(n).padStart(2, '0')}`, 18, ctx.body, ink, { opacity: 0.5, align: 'RIGHT' });
  put(s, right, W - M - right.width, H - 72 - right.height);
  return s;
}

/** Logo as a vector (optionally recolored to one color) or as an image, fitted inside w×h. */
async function logoNode(g: Graphic, w: number, h: number, mono?: RGB): Promise<SceneNode | null> {
  if (!g) return null;
  try {
    if (g.svg) {
      const node = figma.createNodeFromSvg(g.svg);
      if (!node.width || !node.height) {
        node.remove();
        return null;
      }
      node.rescale(Math.min(w / node.width, h / node.height));
      if (mono) {
        for (const v of node.findAll(() => true)) {
          const geo = v as GeometryMixin & SceneNode;
          if ('fills' in geo && Array.isArray(geo.fills) && geo.fills.length) geo.fills = solid(mono);
          if ('strokes' in geo && Array.isArray(geo.strokes) && geo.strokes.length) geo.strokes = solid(mono);
        }
      }
      node.name = 'Logo';
      return node;
    }
    if (g.bytes) {
      const img = figma.createImage(g.bytes);
      const size = await img.getSizeAsync();
      const k = Math.min(w / size.width, h / size.height);
      const r = figma.createRectangle();
      r.name = 'Logo';
      r.resize(Math.max(1, Math.round(size.width * k)), Math.max(1, Math.round(size.height * k)));
      r.fills = [{ type: 'IMAGE', scaleMode: 'FIT', imageHash: img.hash }];
      return r;
    }
  } catch {
    /* unreadable logo */
  }
  return null;
}

/** Can the logo, as it is, be read on this background? Unknown tone counts as "only on white". */
function logoReads(g: Graphic, bg: RGB): boolean {
  if (!g) return false;
  if (g.lum === undefined) return lum(bg) > 0.8;
  return ratio(g.lum, lum(bg)) >= 2.2;
}

/** Recolor the slide's own label and footer texts that sit inside a region painted another color. */
function recolorChrome(s: FrameNode, x0: number, x1: number, color: RGB) {
  for (const node of s.children) {
    if (node.type !== 'TEXT') continue;
    const cx = node.x + node.width / 2;
    if ((node.y < 130 || node.y > H - 130) && cx >= x0 && cx <= x1) {
      const op = (node.fills as SolidPaint[])[0]?.opacity ?? 1;
      node.fills = solid(color, op);
    }
  }
}

function centerIn(frame: FrameNode, node: SceneNode, dy = 0) {
  frame.appendChild(node);
  node.x = Math.round((frame.width - node.width) / 2);
  node.y = Math.round((frame.height - node.height) / 2 + dy);
}

// ------------------------------------------------------------------ the deck

export async function buildBrandBook(data: BrandBookData): Promise<{ ok: boolean; message: string }> {
  const t = new Type();
  await t.init();
  for (const s of ['Regular', 'Medium', 'Semi Bold', 'Bold', 'Light']) await t.load({ family: 'Inter', style: s });

  const groupName = data.host.replace(/^www\./, '');
  const chroma = data.colors.filter((c) => !/^(dark|light)$/i.test(c.label));
  const darkC = data.colors.find((c) => /^dark$/i.test(c.label));
  const lightC = data.colors.find((c) => /^light$/i.test(c.label));
  const DARK = darkC ? rgb(darkC.hex) : INK;
  const LIGHT = lightC ? rgb(lightC.hex) : PAPER;
  const primary = chroma[0] ? rgb(chroma[0].hex) : DARK;
  const secondary = chroma[1] ? rgb(chroma[1].hex) : mix(primary, PAPER, 0.55);
  const accent = chroma[2] ? rgb(chroma[2].hex) : mix(primary, DARK, 0.45);
  const SOFT = mix(PAPER, primary, 0.06); // a whisper of the brand on light slides

  const headingFont = data.fonts.find((f) => f.roles[0] === 'heading') ?? data.fonts[0];
  const bodyFontInfo = data.fonts.find((f) => f.roles[0] === 'body' && f !== headingFont) ?? data.fonts.find((f) => f !== headingFont);
  const headFam = headingFont ? t.resolve(headingFont.family) : null;
  const ctx: Ctx = {
    t,
    display: headFam ? { family: headFam, style: t.styleFor(headFam, 700) } : { family: 'Inter', style: 'Bold' },
    displayLight: headFam ? { family: headFam, style: t.styleFor(headFam, 300) } : { family: 'Inter', style: 'Light' },
    body: { family: 'Inter', style: 'Regular' },
    bodyMedium: { family: 'Inter', style: 'Medium' },
    bodySemi: { family: 'Inter', style: 'Semi Bold' },
    brandName: data.siteName || groupName,
    host: data.host,
  };
  const made = { variables: 0, paintStyles: 0, textStyles: 0, components: 0 };
  const slides: FrameNode[] = [];
  const next = () => slides.length + 1;
  // the contents list exactly the slides that will be made, with their real numbers
  const sections: { title: string; n: number }[] = [];
  {
    let n = 3;
    if (data.logo) sections.push({ title: 'Logo', n }), (n += 2);
    if (data.colors.length) sections.push({ title: 'Color', n: n++ });
    if (data.fonts.length) sections.push({ title: 'Typography', n: n++ });
    if (data.typeScale.length) sections.push({ title: 'Type scale', n: n++ });
    if (data.icons.length) sections.push({ title: 'Iconography', n: n++ });
    if (data.images.length) sections.push({ title: 'Imagery', n: n++ });
  }

  // ---------------------------------------------------------------- cover
  {
    const ink = inkOn(primary, DARK, LIGHT);
    const s = box('01 — Cover', W, H, primary);
    // geometry in the secondary and accent colors: the brand's own palette as the artwork
    const big = figma.createEllipse();
    big.resize(1100, 1100);
    big.fills = solid(contrast(secondary, primary) > 1.15 ? secondary : mix(primary, ink, 0.12));
    put(s, big, W - 760, H - 640);
    const ring = figma.createEllipse();
    ring.resize(560, 560);
    ring.fills = [];
    ring.strokes = solid(ink, 0.35);
    ring.strokeWeight = 2;
    put(s, ring, W - 980, 120);
    const dot = figma.createEllipse();
    dot.resize(140, 140);
    dot.fills = solid(contrast(accent, primary) > 1.15 ? accent : ink, contrast(accent, primary) > 1.15 ? 1 : 0.15);
    put(s, dot, W - 560, 230);
    // logo: as is when it reads on the brand color, otherwise as a one-color version
    if (data.logo) {
      const mono = logoReads(data.logo, primary) ? undefined : data.logo.svg ? ink : undefined;
      const node = await logoNode(data.logo, 360, 110, mono);
      if (node) {
        if (!data.logo.svg && !logoReads(data.logo, primary)) {
          // a raster logo that does not read here sits on a plate it does read on
          const plateBg = logoReads(data.logo, PAPER) ? PAPER : DARK;
          const plate = box('Logo plate', node.width + 64, node.height + 48, plateBg, 16);
          centerIn(plate, node);
          put(s, plate, M, M);
        } else put(s, node, M, M);
      }
    }
    put(s, await txt(ctx, 'Brand Guidelines', 22, ctx.bodySemi, ink, { ls: 14, upper: true, opacity: 0.85 }), M, 470);
    const name = await txt(ctx, ctx.brandName, 190, ctx.display, ink, { ls: -4, w: 1200, lh: 190 });
    put(s, name, M, 520);
    put(s, await txt(ctx, `${data.host}   ·   ${data.date}`, 22, ctx.body, ink, { opacity: 0.7 }), M, H - 72 - 26);
    // palette chips along the bottom right
    let x = W - M;
    for (const c of [...data.colors].reverse()) {
      const chip = figma.createEllipse();
      chip.resize(44, 44);
      chip.fills = solid(rgb(c.hex));
      chip.strokes = solid(ink, 0.4);
      chip.strokeWeight = 2;
      x -= 44;
      put(s, chip, x, H - 72 - 44);
      x -= 10;
    }
    slides.push(s);
  }

  // ---------------------------------------------------------------- contents
  {
    const ink = inkOn(PAPER, DARK, LIGHT);
    const s = await slide(ctx, next() + 0, 'Contents', PAPER, ink);
    s.name = '02 — Contents';
    const band = rect(560, H, primary);
    put(s, band, W - 560, 0);
    s.insertChild(0, band);
    const bandInk = inkOn(primary, DARK, LIGHT);
    recolorChrome(s, W - 560, W, bandInk);
    put(s, await txt(ctx, 'Contents', 120, ctx.display, ink, { ls: -3 }), M, 170);
    put(s, await txt(ctx, `A guide to the ${ctx.brandName} identity, collected from the live website: the logo, colors, typography${data.icons.length ? ', icons' : ''}${data.images.length ? ' and imagery' : ''} as they are used today.`, 26, ctx.body, ink, { w: 900, lh: 40, opacity: 0.7 }), M, 340);
    let y = 480;
    for (let i = 0; i < sections.length; i++) {
      const num = await txt(ctx, String(sections[i].n).padStart(2, '0'), 30, ctx.display, contrast(primary, PAPER) >= 3 ? primary : ink);
      put(s, num, M, y);
      put(s, await txt(ctx, sections[i].title, 38, ctx.bodySemi, ink), M + 110, y - 4);
      const rule = rect(1000, 1, ink, 0, LINE_ON_LIGHT);
      put(s, rule, M, y + 66);
      y += 80;
    }
    const big = await txt(ctx, ctx.brandName.charAt(0).toUpperCase(), 520, ctx.display, bandInk, { opacity: 0.18 });
    put(s, big, W - 560 + (560 - big.width) / 2, (H - big.height) / 2);
    slides.push(s);
  }

  // ---------------------------------------------------------------- logo
  if (data.logo) {
    const ink = inkOn(SOFT, DARK, LIGHT);
    const s = await slide(ctx, next(), 'Logo', SOFT, ink);
    put(s, await txt(ctx, 'Logo', 120, ctx.display, ink, { ls: -3 }), M, 150);
    put(s, await txt(ctx, 'The primary logo as the website serves it. Give it room: keep clear space around it at least the height of its mark, and never stretch, recolor or add effects.', 24, ctx.body, ink, { w: 620, lh: 38, opacity: 0.7 }), M, 330);
    // the stage: the background the logo reads best on
    const stageBg = logoReads(data.logo, PAPER) ? PAPER : DARK;
    const stage = box('Primary logo', 1040, 700, stageBg, 32);
    const node = await logoNode(data.logo, 640, 280);
    if (node) centerIn(stage, node);
    // clear-space guide
    if (node) {
      const pad = Math.min(80, node.height * 0.5);
      const guide = rect(node.width + pad * 2, node.height + pad * 2, inkOn(stageBg, DARK, LIGHT), 6, 0);
      guide.strokes = solid(primary.r + primary.g + primary.b < 2.6 ? primary : inkOn(stageBg, DARK, LIGHT), 0.6);
      guide.strokeWeight = 2;
      guide.dashPattern = [10, 8];
      guide.name = 'Clear space';
      put(stage, guide, node.x - pad, node.y - pad);
    }
    put(s, stage, W - M - 1040, 160);
    put(s, await txt(ctx, 'Primary logo · clear space shown dashed', 18, ctx.body, ink, { opacity: 0.55 }), W - M - 1040, 880);
    slides.push(s);

    // variations: only on backgrounds where the logo (or a one-color version) reads
    const s2 = await slide(ctx, next(), 'Logo variations', PAPER, inkOn(PAPER, DARK, LIGHT));
    const ink2 = inkOn(PAPER, DARK, LIGHT);
    put(s2, await txt(ctx, 'Variations', 96, ctx.display, ink2, { ls: -3 }), M, 150);
    const tiles: { label: string; bg: RGB; mono?: RGB }[] = [];
    for (const [label, bg] of [['On light', PAPER], ['On dark', DARK], ['On brand', primary], ['On tint', mix(PAPER, primary, 0.14)]] as [string, RGB][]) {
      if (logoReads(data.logo, bg)) tiles.push({ label, bg });
      else if (data.logo.svg) tiles.push({ label: `${label} · one color`, bg, mono: inkOn(bg, DARK, LIGHT) });
    }
    if (data.logo.svg && !tiles.some((x) => x.mono)) tiles.push({ label: 'Reversed · one color', bg: DARK, mono: inkOn(DARK, DARK, LIGHT) });
    const shown = tiles.slice(0, 4);
    const tw = (W - M * 2 - 32 * (shown.length - 1)) / Math.max(1, shown.length);
    for (let i = 0; i < shown.length; i++) {
      const tile = box(shown[i].label, tw, 520, shown[i].bg, 28);
      if (contrast(shown[i].bg, PAPER) < 1.1) tile.strokes = solid(ink2, LINE_ON_LIGHT), (tile.strokeWeight = 1);
      const n = await logoNode(data.logo, tw - 120, 160, shown[i].mono);
      if (n) centerIn(tile, n);
      put(s2, tile, M + i * (tw + 32), 340);
      put(s2, await txt(ctx, shown[i].label, 20, ctx.bodyMedium, ink2, { opacity: 0.7 }), M + i * (tw + 32), 884);
    }
    if (data.favicon) {
      const iconTile = box('App icon', 120, 120, logoReads(data.favicon, PAPER) ? mix(PAPER, primary, 0.08) : DARK, 30);
      const n = await logoNode(data.favicon, 76, 76);
      if (n) centerIn(iconTile, n);
      put(s2, iconTile, W - M - 120, 160);
      put(s2, await txt(ctx, 'App icon', 16, ctx.body, ink2, { opacity: 0.55, align: 'RIGHT' }), W - M - 120 - 100, 290);
    }
    slides.push(s2);
  }

  // ---------------------------------------------------------------- color (+ variables and styles)
  if (data.colors.length) {
    const ink = inkOn(PAPER, DARK, LIGHT);
    const s = await slide(ctx, next(), 'Color', PAPER, ink);
    put(s, await txt(ctx, 'Color', 120, ctx.display, ink, { ls: -3 }), M, 150);
    put(s, await txt(ctx, 'Brand colors in order of importance, with how much of the website each one covers and the contrast of text on it.', 24, ctx.body, ink, { w: 760, lh: 36, opacity: 0.7 }), M, 320);
    // proportion bar: measured coverage when known, else 60 / 30 / 10 by rank
    const bar = box('Proportion', W - M * 2, 28, null, 14);
    const shares = data.colors.map((c, i) => c.share ?? [0.6, 0.3, 0.1, 0.06, 0.04, 0.03, 0.02, 0.02][i] ?? 0.02);
    const sum = shares.reduce((a, b) => a + b, 0) || 1;
    let bx = 0;
    data.colors.forEach((c, i) => {
      const w = Math.max(12, (shares[i] / sum) * (W - M * 2));
      put(bar, rect(w, 28, rgb(c.hex)), bx, 0);
      bx += w;
    });
    bar.strokes = solid(ink, LINE_ON_LIGHT);
    put(s, bar, M, 440);
    // cards
    const list = data.colors.slice(0, 6);
    const cw = (W - M * 2 - 24 * (list.length - 1)) / list.length;
    let collection: VariableCollection | null = null;
    try {
      collection = figma.variables.createVariableCollection(`Brand · ${groupName}`);
    } catch {
      collection = null;
    }
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const fill = rgb(c.hex);
      const on = inkOn(fill, DARK, LIGHT);
      const card = box(`${c.label} ${c.hex}`, cw, 470, fill, 28);
      if (contrast(fill, PAPER) < 1.15) (card.strokes = solid(ink, LINE_ON_LIGHT)), (card.strokeWeight = 1);
      put(card, await txt(ctx, c.label, 30, ctx.display, on), 32, 32);
      put(card, await txt(ctx, c.hex.toUpperCase(), 24, ctx.bodySemi, on), 32, 300);
      put(card, await txt(ctx, `RGB ${Math.round(fill.r * 255)} ${Math.round(fill.g * 255)} ${Math.round(fill.b * 255)}`, 16, ctx.body, on, { opacity: 0.75 }), 32, 340);
      put(card, await txt(ctx, `HSL ${hsl(fill)}`, 16, ctx.body, on, { opacity: 0.75 }), 32, 366);
      const cw2 = contrast(fill, PAPER);
      const cb2 = contrast(fill, INK);
      put(card, await txt(ctx, `Aa white ${cw2.toFixed(1)} ${grade(cw2)}   ·   Aa black ${cb2.toFixed(1)} ${grade(cb2)}`, 14, ctx.bodyMedium, on, { opacity: 0.8, w: cw - 64 }), 32, 410);
      put(s, card, M + i * (cw + 24), 500);
      const token = c.label.toLowerCase().replace(/\s+/g, '-') + (list.findIndex((x) => x.label === c.label) !== i ? `-${i + 1}` : '');
      try {
        if (collection) {
          const v = figma.variables.createVariable(token, collection, 'COLOR');
          v.setValueForMode(collection.modes[0].modeId, { ...fill, a: 1 });
          v.description = `${c.hex} · from ${data.host} (${c.source})`;
          made.variables++;
        }
      } catch {
        /* variables need edit access */
      }
      try {
        const st = figma.createPaintStyle();
        st.name = `Brand/${groupName}/${token}`;
        st.paints = solid(fill);
        st.description = `${c.hex} · from ${data.host}`;
        made.paintStyles++;
      } catch {
        /* ignore */
      }
    }
    slides.push(s);
  }

  // ---------------------------------------------------------------- typography
  if (data.fonts.length) {
    const s = await slide(ctx, next(), 'Typography', PAPER, inkOn(PAPER, DARK, LIGHT));
    const ink = inkOn(PAPER, DARK, LIGHT);
    const panel = box('Specimen', 820, H, DARK, 0);
    const pInk = inkOn(DARK, DARK, LIGHT);
    const glyphColor = contrast(primary, DARK) >= 3 ? primary : pInk;
    put(panel, await txt(ctx, 'Aa', 420, ctx.display, glyphColor, { lh: 440 }), M, 200);
    put(panel, await txt(ctx, headingFont ? headingFont.family : 'Inter', 28, ctx.bodySemi, pInk, { opacity: 0.85 }), M, 720);
    put(s, panel, 0, 0);
    // the slide label and footer sit on the dark panel: recolor them so they stay legible
    s.insertChild(0, panel);
    recolorChrome(s, 0, 820, pInk);
    const x0 = 820 + 120;
    const wR = W - x0 - M;
    put(s, await txt(ctx, 'Typography', 96, ctx.display, ink, { ls: -3 }), x0, 150);
    let y = 310;
    for (const f of [headingFont, bodyFontInfo].filter(Boolean).slice(0, 2) as typeof data.fonts) {
      const fam = t.resolve(f.family);
      const face: Font = fam ? { family: fam, style: t.styleFor(fam, f.roles[0] === 'heading' ? 700 : 400) } : { family: 'Inter', style: 'Regular' };
      const role = f.roles.map((r) => (r === 'heading' ? 'Headings' : r === 'body' ? 'Body text' : r === 'button' ? 'Buttons' : 'Accents')).join(' · ');
      const src = f.source === 'google' ? 'Google Fonts' : f.source === 'adobe' ? 'Adobe Fonts' : f.source === 'self-hosted' ? 'Self-hosted' : 'System';
      put(s, await txt(ctx, role, 18, ctx.bodyMedium, ink, { ls: 8, upper: true, opacity: 0.55 }), x0, y);
      put(s, await txt(ctx, f.family, 56, face, ink), x0, y + 34);
      put(s, await txt(ctx, `${src}${f.weights.length ? '   ·   Weights ' + f.weights.slice(0, 6).join(', ') : ''}${fam ? '' : '   ·   not installed in Figma, shown in Inter'}`, 18, ctx.body, ink, { opacity: 0.6, w: wR }), x0, y + 112);
      put(s, await txt(ctx, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz  0123456789', 26, face, ink, { lh: 40, w: wR, opacity: 0.9 }), x0, y + 158);
      y += 330;
    }
    slides.push(s);
  }

  // ---------------------------------------------------------------- type scale (+ text styles)
  if (data.typeScale.length) {
    const ink = inkOn(SOFT, DARK, LIGHT);
    const s = await slide(ctx, next(), 'Type scale', SOFT, ink);
    put(s, await txt(ctx, 'Type scale', 96, ctx.display, ink, { ls: -3 }), M, 150);
    const LABEL: Record<string, string> = { h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6', body: 'Body', button: 'Button', small: 'Small' };
    const rows = data.typeScale.slice(0, 8);
    const avail = H - 300 - 150;
    const rowH = avail / rows.length;
    let y = 300;
    for (const st of rows) {
      const fam = t.resolve(st.family) ?? 'Inter';
      const font = await t.load({ family: fam, style: t.styleFor(fam, st.weight) });
      put(s, await txt(ctx, LABEL[st.tag] ?? st.tag, 18, ctx.bodySemi, ink), M, y + 6);
      put(s, await txt(ctx, `${Math.round(st.sizePx)}${st.lineHeightPx ? ' / ' + Math.round(st.lineHeightPx) : ''} px · ${st.weight}`, 15, ctx.body, ink, { opacity: 0.55 }), M, y + 32);
      const size = Math.min(st.sizePx, rowH * 0.8, 96);
      const sample = await txt(ctx, st.tag.startsWith('h') ? `${ctx.brandName} — the quick brown fox` : st.tag === 'button' ? 'Get started' : 'The quick brown fox jumps over the lazy dog, and the dog does not mind at all.', size, font, ink, { upper: st.transform === 'uppercase', w: W - M * 2 - 320 });
      if (sample.height > rowH - 8) sample.textAutoResize = 'TRUNCATE', sample.resize(W - M * 2 - 320, rowH - 8);
      put(s, sample, M + 320, y);
      put(s, rect(W - M * 2, 1, ink, 0, LINE_ON_LIGHT), M, y + rowH - 6);
      y += rowH;
      try {
        const ts = figma.createTextStyle();
        ts.name = `Brand/${groupName}/${LABEL[st.tag] ?? st.tag}`;
        ts.fontName = font;
        ts.fontSize = st.sizePx;
        if (st.lineHeightPx) ts.lineHeight = { value: st.lineHeightPx, unit: 'PIXELS' };
        if (st.letterSpacingPx) ts.letterSpacing = { value: st.letterSpacingPx, unit: 'PIXELS' };
        if (st.transform === 'uppercase') ts.textCase = 'UPPER';
        ts.description = `${st.family} ${st.weight} · from ${data.host}`;
        made.textStyles++;
      } catch {
        /* ignore */
      }
    }
    slides.push(s);
  }

  // ---------------------------------------------------------------- iconography (+ components)
  if (data.icons.length) {
    const ink = inkOn(PAPER, DARK, LIGHT);
    const s = await slide(ctx, next(), 'Iconography', PAPER, ink);
    put(s, await txt(ctx, 'Iconography', 96, ctx.display, ink, { ls: -3 }), M, 150);
    put(s, await txt(ctx, 'Icons from the website as editable vectors. Each one is a component, ready to reuse and recolor.', 22, ctx.body, ink, { w: 700, lh: 34, opacity: 0.7 }), M, 290);
    const cols = 10;
    const gap = 20;
    const cell = (W - M * 2 - gap * (cols - 1)) / cols;
    let i = 0;
    for (const icon of data.icons.slice(0, 40)) {
      try {
        const node = figma.createNodeFromSvg(icon.svg);
        if (!node.width || !node.height) {
          node.remove();
          continue;
        }
        node.rescale(Math.min((cell * 0.42) / node.width, (cell * 0.42) / node.height));
        const comp = figma.createComponent();
        comp.name = `Icon/${groupName}/${icon.name}`;
        comp.resize(node.width, node.height);
        comp.fills = [];
        comp.appendChild(node);
        node.x = 0;
        node.y = 0;
        // light icons (white on a dark site) get a dark tile so they can be seen
        const tileBg = icon.lum !== undefined && icon.lum > 0.55 ? DARK : mix(PAPER, primary, 0.07);
        const tile = box('Icon', cell, cell, tileBg, 22);
        centerIn(tile, comp);
        const row = Math.floor(i / cols);
        if (row > 3) {
          tile.remove();
          break;
        }
        put(s, tile, M + (i % cols) * (cell + gap), 400 + row * (cell + gap));
        made.components++;
        i++;
      } catch {
        /* an svg Figma cannot read */
      }
    }
    if (made.components) slides.push(s);
    else s.remove();
  }

  // ---------------------------------------------------------------- imagery: editorial bento
  if (data.images.length) {
    const ink = inkOn(DARK, DARK, LIGHT);
    const s = await slide(ctx, next(), 'Imagery', DARK, ink);
    put(s, await txt(ctx, 'Imagery', 96, ctx.display, ink, { ls: -3 }), M, 150);
    const gx = M;
    const gy = 300;
    const gw = W - M * 2;
    const gh = H - gy - 150;
    const gap = 20;
    const colW = (gw - gap * 3) / 4;
    const rowH = (gh - gap) / 2;
    const cells = [
      { x: 0, y: 0, w: colW * 2 + gap, h: gh }, // hero
      { x: (colW + gap) * 2, y: 0, w: colW, h: rowH },
      { x: (colW + gap) * 3, y: 0, w: colW, h: rowH },
      { x: (colW + gap) * 2, y: rowH + gap, w: colW * 2 + gap, h: rowH },
    ];
    for (let i = 0; i < Math.min(cells.length, data.images.length); i++) {
      try {
        const img = figma.createImage(data.images[i].bytes);
        const r = rect(cells[i].w, cells[i].h, DARK, 22);
        r.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: img.hash }];
        r.name = data.images[i].name;
        put(s, r, gx + cells[i].x, gy + cells[i].y);
      } catch {
        /* skip */
      }
    }
    slides.push(s);
    // the rest as a calm grid
    if (data.images.length > 4) {
      const s2 = await slide(ctx, next(), 'Imagery', PAPER, inkOn(PAPER, DARK, LIGHT));
      const rest = data.images.slice(4, 12);
      const cw = (gw - gap * 3) / 4;
      const ch = (H - 220 - 150 - gap) / 2;
      rest.forEach((im, i) => {
        try {
          const img = figma.createImage(im.bytes);
          const r = rect(cw, ch, DARK, 18);
          r.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: img.hash }];
          r.name = im.name;
          put(s2, r, M + (i % 4) * (cw + gap), 180 + Math.floor(i / 4) * (ch + gap));
        } catch {
          /* skip */
        }
      });
      slides.push(s2);
    }
  }

  // ---------------------------------------------------------------- closing
  {
    const bg = DARK;
    const ink = inkOn(bg, DARK, LIGHT);
    const s = box(`${String(next()).padStart(2, '0')} — At a glance`, W, H, bg);
    const glow = figma.createEllipse();
    glow.resize(900, 900);
    glow.fills = solid(contrast(primary, bg) > 1.3 ? primary : mix(bg, ink, 0.1), 0.9);
    put(s, glow, W - 620, -260);
    put(s, await txt(ctx, 'At a glance', 22, ctx.bodySemi, ink, { ls: 14, upper: true, opacity: 0.7 }), M, 140);
    put(s, await txt(ctx, ctx.brandName, 150, ctx.display, ink, { ls: -4, w: 1100, lh: 150 }), M, 190);
    let x = M;
    for (const c of data.colors.slice(0, 8)) {
      const chip = figma.createEllipse();
      chip.resize(88, 88);
      chip.fills = solid(rgb(c.hex));
      chip.strokes = solid(ink, 0.3);
      chip.strokeWeight = 2;
      put(s, chip, x, 560);
      put(s, await txt(ctx, c.hex.toUpperCase(), 14, ctx.bodyMedium, ink, { opacity: 0.7 }), x, 660);
      x += 120;
    }
    const fonts = data.fonts.slice(0, 2).map((f) => f.family).join('  +  ');
    if (fonts) put(s, await txt(ctx, fonts, 30, ctx.bodySemi, ink), M, 740);
    put(s, await txt(ctx, `Collected from ${data.host} with GRAB · ${data.date}. Colors, type and assets as published on the website; check usage rights before reuse.`, 18, ctx.body, ink, { opacity: 0.55, w: 1100, lh: 28 }), M, H - 72 - 56);
    slides.push(s);
  }

  // ---------------------------------------------------------------- arrange in a section, 3 per row
  const section = figma.createSection();
  section.name = `GRAB · Brand Guidelines · ${groupName}`;
  const gapX = 160;
  const gapY = 200;
  const pad = 160;
  slides.forEach((sl, i) => {
    section.appendChild(sl);
    sl.x = pad + (i % 3) * (W + gapX);
    sl.y = pad + Math.floor(i / 3) * (H + gapY);
  });
  const rowsN = Math.ceil(slides.length / 3);
  section.resizeWithoutConstraints(pad * 2 + 3 * W + 2 * gapX, pad * 2 + rowsN * H + (rowsN - 1) * gapY);
  const v = figma.viewport.center;
  section.x = Math.round(v.x - section.width / 2);
  section.y = Math.round(v.y - section.height / 2);
  figma.currentPage.selection = [section];
  figma.viewport.scrollAndZoomIntoView([section]);
  const parts = [`${slides.length} slides`, made.variables && `${made.variables} color variables`, made.textStyles && `${made.textStyles} text styles`, made.components && `${made.components} icon components`].filter(Boolean);
  return { ok: true, message: `Brand guidelines ready: ${parts.join(', ')}.` };
}

export { hexOf };
