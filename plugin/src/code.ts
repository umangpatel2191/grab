// Figma main thread. It never touches the network: the UI fetches bytes and hands them over.
import { buildBrandBook } from './brandbook';
import type { HistoryEntry, InsertItem, InsertResult, MainToUi, Settings, UiToMain } from './shared/messages';

figma.showUI(__html__, { width: 480, height: 740, themeColors: true });

const CELL = 320;
const GAP = 24;
const COLS = 4;
const MAX_CELL_HEIGHT = 2400;

interface Batch {
  id: string;
  frame: FrameNode;
  cols: number[];
  placed: number;
  failed: number;
}

let batch: Batch | null = null;
let queue: Promise<void> = Promise.resolve();

const post = (msg: MainToUi) => figma.ui.postMessage(msg);

function startBatch(id: string, name: string) {
  const frame = figma.createFrame();
  frame.name = name;
  frame.fills = [];
  frame.clipsContent = false;
  const c = figma.viewport.center;
  frame.x = Math.round(c.x - (COLS * (CELL + GAP)) / 2);
  frame.y = Math.round(c.y - 200);
  batch = { id, frame, cols: new Array(COLS).fill(0), placed: 0, failed: 0 };
}

function shortestColumn(cols: number[]): number {
  let best = 0;
  for (let i = 1; i < cols.length; i++) if (cols[i] < cols[best]) best = i;
  return best;
}

async function placeItem(b: Batch, item: InsertItem): Promise<InsertResult> {
  let node: SceneNode | null = null;
  try {
    let h: number;
    if (item.kind === 'svg') {
      if (!item.svg) throw new Error('Empty SVG');
      const svg = figma.createNodeFromSvg(item.svg);
      node = svg;
      if (!svg.width || !svg.height) throw new Error('SVG has no size');
      svg.rescale(CELL / svg.width);
      h = svg.height;
    } else {
      if (!item.bytes || item.bytes.length === 0) throw new Error('No image data');
      const image = figma.createImage(item.bytes);
      const size = await image.getSizeAsync();
      if (!size.width || !size.height) throw new Error('Image has no size');
      h = Math.min(MAX_CELL_HEIGHT, Math.max(1, Math.round(size.height * (CELL / size.width))));
      const rect = figma.createRectangle();
      node = rect;
      rect.resize(CELL, h);
      rect.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash }];
    }
    node.name = item.name;
    const col = shortestColumn(b.cols);
    node.x = col * (CELL + GAP);
    node.y = b.cols[col];
    b.cols[col] += h + GAP;
    b.frame.appendChild(node);
    b.placed++;
    return { id: item.id, ok: true };
  } catch (err) {
    if (node) node.remove(); // never leave half-made layers behind
    b.failed++;
    const reason = err instanceof Error ? err.message : 'Could not place this image';
    return { id: item.id, ok: false, reason: /unsupported|invalid|corrupt/i.test(reason) ? 'Figma cannot read this image format' : reason };
  }
}

function finishBatch(b: Batch, canceled: boolean) {
  if (b.placed === 0) {
    b.frame.remove();
  } else {
    const usedCols = Math.min(COLS, b.placed);
    const height = Math.max(...b.cols) - GAP;
    b.frame.resize(Math.max(1, usedCols * (CELL + GAP) - GAP), Math.max(1, height));
    figma.currentPage.selection = [b.frame];
    figma.viewport.scrollAndZoomIntoView([b.frame]);
  }
  const msg = b.placed === 0
    ? 'Nothing was inserted.'
    : `Inserted ${b.placed} item${b.placed === 1 ? '' : 's'}${b.failed ? `, ${b.failed} failed` : ''}${canceled ? ' (stopped)' : ''}.`;
  figma.notify(msg, { error: b.placed === 0 });
  post({ type: 'insert:done', batchId: b.id, placed: b.placed, failed: b.failed });
  batch = null;
}

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** Brand palette: a frame of labeled swatches, plus optional local color styles. */
async function insertPalette(name: string, colors: { hex: string; label: string }[], styles: boolean) {
  const list = colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c.hex)).slice(0, 16);
  if (!list.length) {
    post({ type: 'palette:done', ok: false, message: 'No colors to insert.' });
    return;
  }
  let hasFont = true;
  try {
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  } catch {
    hasFont = false;
  }
  const frame = figma.createFrame();
  frame.name = name;
  frame.fills = [];
  frame.layoutMode = 'HORIZONTAL';
  frame.itemSpacing = 16;
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.layoutWrap = 'WRAP';
  frame.resize(6 * 136 + 5 * 16, 10);
  frame.primaryAxisSizingMode = 'FIXED';
  let made = 0;
  for (const c of list) {
    try {
      const sw = figma.createFrame();
      sw.name = c.hex.toUpperCase();
      sw.fills = [];
      sw.layoutMode = 'VERTICAL';
      sw.itemSpacing = 8;
      sw.primaryAxisSizingMode = 'AUTO';
      sw.counterAxisSizingMode = 'AUTO';
      const chip = figma.createRectangle();
      chip.name = 'Color';
      chip.resize(136, 96);
      chip.cornerRadius = 8;
      chip.fills = [{ type: 'SOLID', color: hexToRgb(c.hex) }];
      chip.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.08 }];
      chip.strokeWeight = 1;
      sw.appendChild(chip);
      if (hasFont) {
        const t = figma.createText();
        t.fontName = { family: 'Inter', style: 'Regular' };
        t.fontSize = 12;
        t.characters = `${c.hex.toUpperCase()}${c.label ? '  ' + c.label : ''}`;
        t.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }];
        sw.appendChild(t);
      }
      frame.appendChild(sw);
      if (styles) {
        const st = figma.createPaintStyle();
        st.name = `GRAB/${name.replace(/^GRAB · /, '')}/${c.hex.toUpperCase()}`;
        st.paints = [{ type: 'SOLID', color: hexToRgb(c.hex) }];
      }
      made++;
    } catch {
      /* skip a swatch that cannot be created */
    }
  }
  if (!made) {
    frame.remove();
    post({ type: 'palette:done', ok: false, message: 'Could not create the palette.' });
    return;
  }
  const v = figma.viewport.center;
  frame.x = Math.round(v.x - frame.width / 2);
  frame.y = Math.round(v.y - frame.height / 2);
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
  const message = `Added ${made} color${made === 1 ? '' : 's'}${styles ? ' and color styles' : ''}.`;
  figma.notify(message);
  post({ type: 'palette:done', ok: true, message });
}

/** Figma style name closest to a CSS weight ("700" → "Bold"), among the styles the family has. */
function styleFor(weight: string, styles: string[]): string | null {
  const names: Record<number, string[]> = {
    100: ['Thin', 'Hairline'], 200: ['ExtraLight', 'Extra Light', 'UltraLight'], 300: ['Light'], 400: ['Regular', 'Normal', 'Book', 'Roman'],
    500: ['Medium'], 600: ['SemiBold', 'Semi Bold', 'DemiBold'], 700: ['Bold'], 800: ['ExtraBold', 'Extra Bold', 'Heavy'], 900: ['Black', 'Heavy'],
  };
  const w = Math.round((parseInt(weight, 10) || 400) / 100) * 100;
  for (const n of names[w] ?? names[400]) if (styles.includes(n)) return n;
  return null;
}

/** Type specimen: one row per font in that font, plus local text styles. Fonts Figma does not have are listed by name. */
async function insertFonts(name: string, fonts: { family: string; role: string; weights: string[] }[]) {
  if (!fonts.length) {
    post({ type: 'fonts:done', ok: false, message: 'No fonts to add.' });
    return;
  }
  const available = await figma.listAvailableFontsAsync();
  const byFamily = new Map<string, string[]>();
  for (const f of available) {
    const k = f.fontName.family.toLowerCase();
    byFamily.set(k, [...(byFamily.get(k) ?? []), f.fontName.style]);
  }
  try {
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  } catch {
    /* labels fall back to the font itself */
  }
  const frame = figma.createFrame();
  frame.name = name;
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  frame.layoutMode = 'VERTICAL';
  frame.itemSpacing = 28;
  frame.paddingTop = frame.paddingBottom = frame.paddingLeft = frame.paddingRight = 32;
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.cornerRadius = 12;
  let placed = 0;
  const missing: string[] = [];
  for (const f of fonts.slice(0, 12)) {
    const styles = byFamily.get(f.family.toLowerCase());
    const row = figma.createFrame();
    row.name = f.family;
    row.fills = [];
    row.layoutMode = 'VERTICAL';
    row.itemSpacing = 6;
    row.primaryAxisSizingMode = 'AUTO';
    row.counterAxisSizingMode = 'AUTO';
    const label = figma.createText();
    try {
      label.fontName = { family: 'Inter', style: 'Regular' };
    } catch {
      /* default font */
    }
    label.fontSize = 12;
    label.fills = [{ type: 'SOLID', color: { r: 0.45, g: 0.45, b: 0.45 } }];
    const roleLabel = f.role === 'heading' ? 'Headings' : f.role === 'body' ? 'Body text' : f.role === 'button' ? 'Buttons' : 'Used on the site';
    if (!styles) {
      label.characters = `${f.family} · ${roleLabel} · not installed in Figma`;
      row.appendChild(label);
      frame.appendChild(row);
      missing.push(f.family);
      continue;
    }
    label.characters = `${f.family} · ${roleLabel}${f.weights.length ? ' · ' + f.weights.slice(0, 6).join(', ') : ''}`;
    row.appendChild(label);
    // one sample per weight the site uses (Regular when it does not say)
    const wanted = [...new Set((f.weights.length ? f.weights : ['400']).map((w) => styleFor(w.split('–')[0], styles) ?? (styles.includes('Regular') ? 'Regular' : styles[0])))].slice(0, 4);
    for (const style of wanted) {
      try {
        const fam = available.find((a) => a.fontName.family.toLowerCase() === f.family.toLowerCase())!.fontName.family;
        await figma.loadFontAsync({ family: fam, style });
        const t = figma.createText();
        t.fontName = { family: fam, style };
        t.fontSize = f.role === 'heading' ? 40 : 22;
        t.characters = f.role === 'heading' ? `${fam} ${style}` : `${fam} ${style} — The quick brown fox jumps over the lazy dog`;
        t.fills = [{ type: 'SOLID', color: { r: 0.08, g: 0.08, b: 0.08 } }];
        row.appendChild(t);
        const ts = figma.createTextStyle();
        ts.name = `GRAB/${name.replace(/^GRAB · /, '').replace(/ · Fonts$/, '')}/${roleLabel}/${fam} ${style}`;
        ts.fontName = { family: fam, style };
        ts.fontSize = t.fontSize as number;
        placed++;
      } catch {
        /* this style could not be loaded */
      }
    }
    frame.appendChild(row);
  }
  if (!placed && !missing.length) {
    frame.remove();
    post({ type: 'fonts:done', ok: false, message: 'Could not create the fonts.' });
    return;
  }
  const v = figma.viewport.center;
  frame.x = Math.round(v.x - frame.width / 2);
  frame.y = Math.round(v.y - frame.height / 2);
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
  const message = `Added ${placed} text style${placed === 1 ? '' : 's'}${missing.length ? ` · not in Figma: ${missing.join(', ')}` : ''}.`;
  figma.notify(message);
  post({ type: 'fonts:done', ok: true, message });
}

async function handle(msg: UiToMain) {
  switch (msg.type) {
    case 'storage:get': {
      const settings = ((await figma.clientStorage.getAsync('grab:settings')) as Settings | undefined) ?? null;
      const history = ((await figma.clientStorage.getAsync('grab:history')) as HistoryEntry[] | undefined) ?? null;
      const lastScan = (await figma.clientStorage.getAsync('grab:lastScan')) ?? null;
      post({ type: 'storage:data', settings, history, lastScan });
      return;
    }
    case 'storage:set':
      await figma.clientStorage.setAsync(`grab:${msg.key}`, msg.value);
      return;
    case 'insert:start':
      if (batch) finishBatch(batch, true);
      startBatch(msg.batchId, msg.frameName);
      return;
    case 'insert:chunk': {
      const b = batch;
      if (!b || b.id !== msg.batchId) return;
      const results: InsertResult[] = [];
      for (const item of msg.items) results.push(await placeItem(b, item));
      post({ type: 'insert:chunk-result', batchId: msg.batchId, results });
      return;
    }
    case 'insert:end':
      if (batch && batch.id === msg.batchId) finishBatch(batch, msg.canceled);
      return;
    case 'palette:insert':
      await insertPalette(msg.name, msg.colors, msg.styles);
      return;
    case 'brandbook:build': {
      try {
        const r = await buildBrandBook(msg.data);
        figma.notify(r.message);
        post({ type: 'brandbook:done', ...r });
      } catch (err) {
        post({ type: 'brandbook:done', ok: false, message: `Could not build the brand book: ${err instanceof Error ? err.message : 'unknown error'}` });
      }
      return;
    }
    case 'fonts:insert':
      await insertFonts(msg.name, msg.fonts);
      return;
    case 'notify':
      figma.notify(msg.message, { error: msg.error });
      return;
    case 'resize':
      figma.ui.resize(Math.min(900, Math.max(380, Math.round(msg.width))), Math.min(1000, Math.max(520, Math.round(msg.height))));
      return;
  }
}

// One message at a time, in order, so chunks can never overtake each other.
figma.ui.onmessage = (msg: UiToMain) => {
  queue = queue.then(() => handle(msg)).catch(() => undefined);
};
