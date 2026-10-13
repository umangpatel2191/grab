// Brand book builder (Figma main thread). Pages: cover, logo, colors, typography, iconography,
// imagery. Also creates color variables, color styles, text styles and icon components, so the
// result is a working design-system starter, not just a picture.
import type { BrandBookData } from './shared/messages';

const W = 1440;
const PAD = 96;
const INK: RGB = { r: 0.07, g: 0.07, b: 0.08 };
const MUTED: RGB = { r: 0.42, g: 0.42, b: 0.45 };
const LINE: RGB = { r: 0.9, g: 0.9, b: 0.91 };
const PAPER: RGB = { r: 1, g: 1, b: 1 };
const SOFT: RGB = { r: 0.965, g: 0.965, b: 0.97 };

type Font = { family: string; style: string };

function rgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
function luminance(c: RGB): number {
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrast(a: RGB, b: RGB): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const onColor = (bg: RGB) => (contrast(bg, PAPER) >= contrast(bg, INK) ? PAPER : INK);
const grade = (r: number) => (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'AA large' : 'Fail');
const solid = (c: RGB, opacity = 1): SolidPaint[] => [{ type: 'SOLID', color: c, opacity }];

/** Fonts we can actually use in this Figma file, with graceful fallbacks to Inter. */
class Type {
  private loaded = new Set<string>();
  private families = new Map<string, string[]>();
  canonical = new Map<string, string>();
  async init() {
    for (const f of await figma.listAvailableFontsAsync()) {
      const k = f.fontName.family.toLowerCase();
      this.families.set(k, [...(this.families.get(k) ?? []), f.fontName.style]);
      this.canonical.set(k, f.fontName.family);
    }
  }
  styleFor(family: string, weight: number): string {
    const styles = this.families.get(family.toLowerCase()) ?? [];
    const names: Record<number, string[]> = {
      100: ['Thin', 'Hairline'], 200: ['ExtraLight', 'Extra Light', 'UltraLight'], 300: ['Light'], 400: ['Regular', 'Normal', 'Book', 'Roman'],
      500: ['Medium'], 600: ['SemiBold', 'Semi Bold', 'DemiBold'], 700: ['Bold'], 800: ['ExtraBold', 'Extra Bold', 'Heavy'], 900: ['Black', 'Heavy'],
    };
    const w = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
    for (let d = 0; d <= 400; d += 100) {
      for (const cand of [w + d, w - d]) for (const n of names[cand] ?? []) if (styles.includes(n)) return n;
    }
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
      const fallback = { family: 'Inter', style: /bold|black|heavy/i.test(f.style) ? 'Bold' : /semi|medium/i.test(f.style) ? 'Semi Bold' : 'Regular' };
      if (f.family !== 'Inter') return this.load(fallback);
      return { family: 'Inter', style: 'Regular' };
    }
  }
  /** The installed spelling of a family, matched case-insensitively; null when Figma does not have it. */
  resolve(name: string): string | null {
    return this.canonical.get(name.toLowerCase()) ?? null;
  }
}

async function text(t: Type, chars: string, size: number, font: Font, color: RGB = INK, opts: { width?: number; lineHeight?: number; letterSpacing?: number; upper?: boolean } = {}): Promise<TextNode> {
  const f = await t.load(font);
  const n = figma.createText();
  n.fontName = f;
  n.fontSize = size;
  n.fills = solid(color);
  if (opts.lineHeight) n.lineHeight = { value: opts.lineHeight, unit: 'PIXELS' };
  if (opts.letterSpacing !== undefined) n.letterSpacing = { value: opts.letterSpacing, unit: 'PERCENT' };
  if (opts.upper) n.textCase = 'UPPER';
  n.characters = chars || ' ';
  if (opts.width) {
    n.textAutoResize = 'HEIGHT';
    n.resize(opts.width, n.height);
  }
  return n;
}

function stack(name: string, dir: 'VERTICAL' | 'HORIZONTAL', gap: number, fill: Paint[] = []): FrameNode {
  const f = figma.createFrame();
  f.name = name;
  f.layoutMode = dir;
  f.itemSpacing = gap;
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  f.fills = fill;
  f.clipsContent = false;
  return f;
}

/** A fixed-width page with the shared header: number, title, intro. */
async function page(t: Type, n: number, title: string, intro: string, host: string, display: Font): Promise<FrameNode> {
  const p = stack(`${String(n).padStart(2, '0')} · ${title}`, 'VERTICAL', 56, solid(PAPER));
  p.counterAxisSizingMode = 'FIXED';
  p.resize(W, 100);
  p.paddingTop = p.paddingBottom = PAD;
  p.paddingLeft = p.paddingRight = PAD;
  p.cornerRadius = 0;
  const head = stack('Header', 'VERTICAL', 16);
  const top = stack('Meta', 'HORIZONTAL', 12);
  top.appendChild(await text(t, String(n).padStart(2, '0'), 14, { family: 'Inter', style: 'Semi Bold' }, MUTED, { letterSpacing: 8 }));
  top.appendChild(await text(t, host, 14, { family: 'Inter', style: 'Regular' }, MUTED));
  head.appendChild(top);
  head.appendChild(await text(t, title, 72, display, INK, { letterSpacing: -2 }));
  head.appendChild(await text(t, intro, 20, { family: 'Inter', style: 'Regular' }, MUTED, { width: 760, lineHeight: 30 }));
  p.appendChild(head);
  const rule = figma.createRectangle();
  rule.name = 'Rule';
  rule.resize(W - PAD * 2, 1);
  rule.fills = solid(LINE);
  p.appendChild(rule);
  return p;
}

function placeImage(bytes: Uint8Array, w: number, h: number, mode: 'FILL' | 'FIT' = 'FILL', radius = 16): RectangleNode {
  const img = figma.createImage(bytes);
  const r = figma.createRectangle();
  r.resize(w, h);
  r.cornerRadius = radius;
  r.fills = [{ type: 'IMAGE', scaleMode: mode, imageHash: img.hash }];
  return r;
}

/** Logo as a node: vector when we have SVG, image otherwise. Fitted inside w×h. */
async function logoNode(data: BrandBookData['logo'], w: number, h: number, tint?: RGB): Promise<SceneNode | null> {
  if (!data) return null;
  try {
    if (data.svg) {
      const node = figma.createNodeFromSvg(data.svg);
      if (!node.width || !node.height) {
        node.remove();
        return null;
      }
      node.rescale(Math.min(w / node.width, h / node.height));
      if (tint) {
        for (const v of node.findAll((x) => 'fills' in x) as GeometryMixin[]) {
          if (Array.isArray(v.fills) && v.fills.length) v.fills = solid(tint);
        }
      }
      node.name = 'Logo';
      return node;
    }
    if (data.bytes) {
      const img = figma.createImage(data.bytes);
      const size = await img.getSizeAsync();
      const s = Math.min(w / size.width, h / size.height, 1.6);
      const r = figma.createRectangle();
      r.name = 'Logo';
      r.resize(Math.max(1, Math.round(size.width * s)), Math.max(1, Math.round(size.height * s)));
      r.fills = [{ type: 'IMAGE', scaleMode: 'FIT', imageHash: img.hash }];
      return r;
    }
  } catch {
    /* unreadable logo */
  }
  return null;
}

function centerIn(frame: FrameNode, node: SceneNode) {
  frame.appendChild(node);
  node.x = Math.round((frame.width - node.width) / 2);
  node.y = Math.round((frame.height - node.height) / 2);
}

export async function buildBrandBook(data: BrandBookData): Promise<{ ok: boolean; message: string }> {
  const t = new Type();
  await t.init();
  for (const s of ['Regular', 'Medium', 'Semi Bold', 'Bold']) await t.load({ family: 'Inter', style: s });

  const host = data.host;
  const colors = data.colors.slice(0, 12);
  const primary = colors.find((c) => c.label !== 'Background') ?? colors[0] ?? { hex: '#111111', label: 'Brand', source: '' };
  const primaryRgb = rgb(primary.hex);
  // the site's own heading font, when Figma has it, sets the tone of the whole book
  const headingFont = data.fonts.find((f) => f.roles[0] === 'heading') ?? data.fonts[0];
  const headingFamily = headingFont ? t.resolve(headingFont.family) : null;
  const display: Font = headingFamily ? { family: headingFamily, style: t.styleFor(headingFamily, 700) } : { family: 'Inter', style: 'Bold' };

  const section = figma.createSection();
  section.name = `GRAB · Brand Book · ${host}`;
  const pages: FrameNode[] = [];
  const made = { variables: 0, paintStyles: 0, textStyles: 0, components: 0 };
  const groupName = host.replace(/^www\./, '');

  // ---------------------------------------------------------------- 01 cover
  {
    const cover = figma.createFrame();
    cover.name = '01 · Cover';
    cover.resize(W, 900);
    cover.fills = solid(primaryRgb);
    const fg = onColor(primaryRgb);
    const logo = await logoNode(data.logo, 280, 96, data.logo?.svg ? fg : undefined);
    if (logo) {
      if (!data.logo?.svg) {
        const chip = figma.createFrame();
        chip.name = 'Logo plate';
        chip.resize(Math.max(160, logo.width + 48), logo.height + 40);
        chip.cornerRadius = 14;
        chip.fills = solid(PAPER);
        centerIn(chip, logo);
        cover.appendChild(chip);
        chip.x = PAD;
        chip.y = PAD;
      } else {
        cover.appendChild(logo);
        logo.x = PAD;
        logo.y = PAD;
      }
    }
    const label = await text(t, 'Brand Book', 16, { family: 'Inter', style: 'Semi Bold' }, fg, { letterSpacing: 12, upper: true });
    cover.appendChild(label);
    label.x = PAD;
    label.y = 360;
    const name = await text(t, data.siteName || groupName, 140, display, fg, { letterSpacing: -3, width: W - PAD * 2, lineHeight: 148 });
    cover.appendChild(name);
    name.x = PAD;
    name.y = 400;
    const meta = await text(t, `${host}  ·  Collected with GRAB  ·  ${data.date}`, 18, { family: 'Inter', style: 'Regular' }, fg, { lineHeight: 26 });
    meta.opacity = 0.75;
    cover.appendChild(meta);
    meta.x = PAD;
    meta.y = Math.max(name.y + name.height + 24, 640);
    // the palette as a strip along the bottom
    const strip = stack('Palette strip', 'HORIZONTAL', 0);
    const each = Math.floor((W - PAD * 2) / Math.max(1, colors.length));
    for (const c of colors) {
      const r = figma.createRectangle();
      r.name = c.hex;
      r.resize(each, 40);
      r.fills = solid(rgb(c.hex));
      strip.appendChild(r);
    }
    strip.cornerRadius = 10;
    strip.clipsContent = true;
    strip.strokes = solid(fg, 0.25);
    cover.appendChild(strip);
    strip.x = PAD;
    strip.y = 900 - PAD - 40;
    pages.push(cover);
  }

  // ---------------------------------------------------------------- 02 logo
  if (data.logo) {
    const p = await page(t, pages.length + 1, 'Logo', 'The logo as the site serves it, shown on light, dark and brand backgrounds. Check legibility before using a version.', host, display);
    const row = stack('Logo on backgrounds', 'HORIZONTAL', 24);
    const tile = (W - PAD * 2 - 48) / 3;
    const bgs: [string, RGB][] = [['On light', PAPER], ['On dark', INK], ['On brand', primaryRgb]];
    for (const [label, bg] of bgs) {
      const col = stack(label, 'VERTICAL', 14);
      const box = figma.createFrame();
      box.name = label;
      box.resize(tile, 320);
      box.cornerRadius = 20;
      box.fills = solid(bg);
      box.strokes = solid(LINE);
      const vector = !!data.logo.svg;
      const node = await logoNode(data.logo, tile - 120, 140, vector && bg !== PAPER ? onColor(bg) : undefined);
      if (node) centerIn(box, node);
      col.appendChild(box);
      col.appendChild(await text(t, `${label}${vector ? '' : ' · raster logo, colors as found'}`, 14, { family: 'Inter', style: 'Regular' }, MUTED));
      row.appendChild(col);
    }
    p.appendChild(row);
    if (data.favicon) {
      const fav = stack('App icon', 'HORIZONTAL', 24);
      const box = figma.createFrame();
      box.name = 'Favicon';
      box.resize(160, 160);
      box.cornerRadius = 36;
      box.fills = solid(SOFT);
      const n = await logoNode(data.favicon, 96, 96);
      if (n) centerIn(box, n);
      fav.appendChild(box);
      const info = stack('Info', 'VERTICAL', 8);
      info.appendChild(await text(t, 'App icon / favicon', 22, { family: 'Inter', style: 'Semi Bold' }));
      info.appendChild(await text(t, 'The icon browsers and phones show for the site.', 16, { family: 'Inter', style: 'Regular' }, MUTED));
      fav.appendChild(info);
      fav.counterAxisAlignItems = 'CENTER';
      p.appendChild(fav);
    }
    pages.push(p);
  }

  // ---------------------------------------------------------------- colors + variables + styles
  if (colors.length) {
    const p = await page(t, pages.length + 1, 'Color', 'Brand colors in order of importance, with the contrast of white and black text on each one (WCAG). They are also in this file as variables and color styles.', host, display);
    let collection: VariableCollection | null = null;
    try {
      collection = figma.variables.createVariableCollection(`Brand · ${groupName}`);
    } catch {
      collection = null;
    }
    const grid = stack('Swatches', 'HORIZONTAL', 24);
    grid.layoutWrap = 'WRAP';
    grid.counterAxisSpacing = 32;
    grid.primaryAxisSizingMode = 'FIXED';
    grid.resize(W - PAD * 2, 100);
    const card = (W - PAD * 2 - 24 * 3) / 4;
    const roleCount = new Map<string, number>();
    for (const c of colors) {
      const fill = rgb(c.hex);
      const n = (roleCount.get(c.label) ?? 0) + 1;
      roleCount.set(c.label, n);
      const tokenName = `${c.label.toLowerCase().replace(/\s+/g, '-')}${n > 1 ? '-' + n : ''}`;
      const col = stack(c.hex, 'VERTICAL', 0, solid(PAPER));
      col.cornerRadius = 20;
      col.strokes = solid(LINE);
      col.clipsContent = true;
      col.counterAxisSizingMode = 'FIXED';
      col.resize(card, 100);
      const chip = figma.createFrame();
      chip.name = 'Swatch';
      chip.resize(card, 200);
      chip.fills = solid(fill);
      const fg = onColor(fill);
      const aa = await text(t, 'Aa', 40, display, fg);
      chip.appendChild(aa);
      aa.x = 24;
      aa.y = 200 - 24 - aa.height;
      col.appendChild(chip);
      const body = stack('Details', 'VERTICAL', 6);
      body.paddingTop = body.paddingBottom = 20;
      body.paddingLeft = body.paddingRight = 24;
      body.appendChild(await text(t, c.label, 13, { family: 'Inter', style: 'Semi Bold' }, MUTED, { upper: true, letterSpacing: 6 }));
      body.appendChild(await text(t, c.hex.toUpperCase(), 24, { family: 'Inter', style: 'Semi Bold' }));
      body.appendChild(await text(t, `RGB ${Math.round(fill.r * 255)} ${Math.round(fill.g * 255)} ${Math.round(fill.b * 255)}`, 14, { family: 'Inter', style: 'Regular' }, MUTED));
      const cw = contrast(fill, PAPER);
      const cb = contrast(fill, INK);
      body.appendChild(await text(t, `White text ${cw.toFixed(1)}:1 ${grade(cw)}  ·  Black ${cb.toFixed(1)}:1 ${grade(cb)}`, 12, { family: 'Inter', style: 'Regular' }, MUTED));
      col.appendChild(body);
      grid.appendChild(col);
      // design-system objects
      try {
        if (collection) {
          const v = figma.variables.createVariable(tokenName, collection, 'COLOR');
          v.setValueForMode(collection.modes[0].modeId, { ...fill, a: 1 });
          v.description = `From ${host} (${c.source})`;
          made.variables++;
        }
      } catch {
        /* variables need edit access to the file */
      }
      try {
        const st = figma.createPaintStyle();
        st.name = `Brand/${groupName}/${tokenName}`;
        st.paints = solid(fill);
        st.description = `${c.hex} · from ${host}`;
        made.paintStyles++;
      } catch {
        /* ignore */
      }
    }
    p.appendChild(grid);
    pages.push(p);
  }

  // ---------------------------------------------------------------- typography + text styles
  if (data.fonts.length || data.typeScale.length) {
    const p = await page(t, pages.length + 1, 'Typography', 'The typefaces the site uses and its type scale. Sizes are the desktop values; text styles were added to this file for every font Figma has.', host, display);
    const fontsRow = stack('Typefaces', 'HORIZONTAL', 24);
    fontsRow.layoutWrap = 'WRAP';
    fontsRow.primaryAxisSizingMode = 'FIXED';
    fontsRow.resize(W - PAD * 2, 100);
    const cardW = (W - PAD * 2 - 24) / 2;
    for (const f of data.fonts.slice(0, 4)) {
      const fam = t.resolve(f.family);
      const card = stack(f.family, 'VERTICAL', 16, solid(SOFT));
      card.cornerRadius = 20;
      card.counterAxisSizingMode = 'FIXED';
      card.resize(cardW, 100);
      card.paddingTop = card.paddingBottom = card.paddingLeft = card.paddingRight = 40;
      const specimen: Font = fam ? { family: fam, style: t.styleFor(fam, f.roles[0] === 'heading' ? 700 : 400) } : { family: 'Inter', style: 'Regular' };
      card.appendChild(await text(t, 'Aa', 120, specimen, INK, { lineHeight: 130 }));
      card.appendChild(await text(t, f.family, 28, { family: 'Inter', style: 'Semi Bold' }));
      const roleText = f.roles.map((r) => (r === 'heading' ? 'Headings' : r === 'body' ? 'Body text' : r === 'button' ? 'Buttons' : 'Accents')).join(' · ');
      const src = f.source === 'google' ? 'Google Fonts' : f.source === 'adobe' ? 'Adobe Fonts' : f.source === 'self-hosted' ? 'Self-hosted' : 'System';
      card.appendChild(await text(t, `${roleText}  ·  ${src}${f.weights.length ? '  ·  ' + f.weights.slice(0, 6).join(', ') : ''}`, 14, { family: 'Inter', style: 'Regular' }, MUTED, { width: cardW - 80 }));
      card.appendChild(await text(t, fam ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789 &@?!' : `${f.family} is not installed in Figma. Install it to see the specimen.`, 18, specimen, INK, { width: cardW - 80, lineHeight: 28 }));
      fontsRow.appendChild(card);
    }
    if (data.fonts.length) p.appendChild(fontsRow);

    if (data.typeScale.length) {
      const scale = stack('Type scale', 'VERTICAL', 0);
      scale.counterAxisSizingMode = 'FIXED';
      scale.resize(W - PAD * 2, 100);
      const LABEL: Record<string, string> = { h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6', body: 'Body', button: 'Button', small: 'Small' };
      for (const s of data.typeScale) {
        const fam = t.resolve(s.family) ?? 'Inter';
        const font = await t.load({ family: fam, style: t.styleFor(fam, s.weight) });
        const row = stack(LABEL[s.tag] ?? s.tag, 'HORIZONTAL', 32);
        row.counterAxisSizingMode = 'FIXED';
        row.primaryAxisSizingMode = 'FIXED';
        row.resize(W - PAD * 2, 10);
        row.counterAxisSizingMode = 'AUTO';
        row.paddingTop = row.paddingBottom = 24;
        row.counterAxisAlignItems = 'CENTER';
        row.strokes = solid(LINE);
        row.strokeTopWeight = 0;
        row.strokeLeftWeight = 0;
        row.strokeRightWeight = 0;
        row.strokeBottomWeight = 1;
        const meta = stack('Spec', 'VERTICAL', 4);
        meta.counterAxisSizingMode = 'FIXED';
        meta.resize(240, 10);
        meta.counterAxisSizingMode = 'FIXED';
        meta.appendChild(await text(t, LABEL[s.tag] ?? s.tag, 15, { family: 'Inter', style: 'Semi Bold' }));
        const lh = s.lineHeightPx ? ` / ${Math.round(s.lineHeightPx)}` : '';
        meta.appendChild(await text(t, `${Math.round(s.sizePx)}${lh} px · ${s.weight}${s.from === 'measured' ? ' · measured' : ''}`, 13, { family: 'Inter', style: 'Regular' }, MUTED));
        meta.appendChild(await text(t, s.family + (fam === 'Inter' && s.family.toLowerCase() !== 'inter' ? ' (shown in Inter)' : ''), 13, { family: 'Inter', style: 'Regular' }, MUTED, { width: 240 }));
        row.appendChild(meta);
        const sample = await text(t, s.tag.startsWith('h') ? 'The quick brown fox jumps' : s.tag === 'button' ? 'Get started' : 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.', Math.min(s.sizePx, 120), font, INK, {
          width: W - PAD * 2 - 240 - 32,
          lineHeight: s.lineHeightPx ? Math.min(s.lineHeightPx, 140) : undefined,
          upper: s.transform === 'uppercase',
        });
        if (s.letterSpacingPx) sample.letterSpacing = { value: s.letterSpacingPx, unit: 'PIXELS' };
        row.appendChild(sample);
        scale.appendChild(row);
        try {
          const ts = figma.createTextStyle();
          ts.name = `Brand/${groupName}/${LABEL[s.tag] ?? s.tag}`;
          ts.fontName = font;
          ts.fontSize = s.sizePx;
          if (s.lineHeightPx) ts.lineHeight = { value: s.lineHeightPx, unit: 'PIXELS' };
          if (s.letterSpacingPx) ts.letterSpacing = { value: s.letterSpacingPx, unit: 'PIXELS' };
          if (s.transform === 'uppercase') ts.textCase = 'UPPER';
          ts.description = `${s.family} ${s.weight} · from ${host}`;
          made.textStyles++;
        } catch {
          /* ignore */
        }
      }
      p.appendChild(scale);
    }
    pages.push(p);
  }

  // ---------------------------------------------------------------- iconography as components
  if (data.icons.length) {
    const p = await page(t, pages.length + 1, 'Iconography', 'Icons and small graphics from the site, as editable vectors. Each one is a component, ready to reuse and recolor.', host, display);
    const grid = stack('Icons', 'HORIZONTAL', 16);
    grid.layoutWrap = 'WRAP';
    grid.counterAxisSpacing = 16;
    grid.primaryAxisSizingMode = 'FIXED';
    grid.resize(W - PAD * 2, 100);
    const cell = Math.floor((W - PAD * 2 - 16 * 9) / 10);
    for (const icon of data.icons.slice(0, 60)) {
      try {
        const box = figma.createFrame();
        box.name = 'Cell';
        box.resize(cell, cell);
        box.cornerRadius = 16;
        box.fills = solid(SOFT);
        const node = figma.createNodeFromSvg(icon.svg);
        if (!node.width || !node.height) {
          node.remove();
          box.remove();
          continue;
        }
        node.rescale(Math.min((cell * 0.45) / node.width, (cell * 0.45) / node.height));
        const comp = figma.createComponent();
        comp.name = `Icon/${groupName}/${icon.name}`;
        comp.resize(node.width, node.height);
        comp.fills = [];
        comp.appendChild(node);
        node.x = 0;
        node.y = 0;
        centerIn(box, comp);
        grid.appendChild(box);
        made.components++;
      } catch {
        /* an svg Figma cannot read */
      }
    }
    if (made.components) {
      p.appendChild(grid);
      pages.push(p);
    } else p.remove();
  }

  // ---------------------------------------------------------------- imagery moodboard
  if (data.images.length) {
    const p = await page(t, pages.length + 1, 'Imagery', 'Photography and illustration from the site: the visual mood of the brand.', host, display);
    const cols = 3;
    const gap = 24;
    const colW = (W - PAD * 2 - gap * (cols - 1)) / cols;
    const board = figma.createFrame();
    board.name = 'Moodboard';
    board.fills = [];
    board.clipsContent = false;
    const heights = new Array(cols).fill(0);
    for (const im of data.images.slice(0, 12)) {
      try {
        const img = figma.createImage(im.bytes);
        const size = await img.getSizeAsync();
        const h = Math.max(160, Math.min(colW * 1.5, Math.round((size.height / size.width) * colW)));
        const c = heights.indexOf(Math.min(...heights));
        const r = placeImage(im.bytes, colW, h, 'FILL', 16);
        r.name = im.name;
        r.x = c * (colW + gap);
        r.y = heights[c];
        heights[c] += h + gap;
        board.appendChild(r);
      } catch {
        /* skip unreadable image */
      }
    }
    board.resize(W - PAD * 2, Math.max(1, Math.max(...heights) - gap));
    p.appendChild(board);
    pages.push(p);
  }

  // ---------------------------------------------------------------- lay out side by side
  let x = 0;
  for (const p of pages) {
    section.appendChild(p);
    p.x = x;
    p.y = 0;
    x += p.width + 120;
  }
  const v = figma.viewport.center;
  section.x = Math.round(v.x - 400);
  section.y = Math.round(v.y - 400);
  section.resizeWithoutConstraints(Math.max(1, x - 120 + 160), Math.max(...pages.map((p) => p.height)) + 160);
  for (const p of pages) {
    p.x += 80;
    p.y += 80;
  }
  figma.currentPage.selection = [section];
  figma.viewport.scrollAndZoomIntoView([section]);
  const parts = [`${pages.length} pages`, made.variables && `${made.variables} color variables`, made.textStyles && `${made.textStyles} text styles`, made.components && `${made.components} icon components`].filter(Boolean);
  return { ok: true, message: `Brand book ready: ${parts.join(', ')}.` };
}
