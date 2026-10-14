import { zipSync } from 'fflate';
import type { BrandColor, Candidate, FontInfo, TypeStyle } from '../../../shared/types';
import type { BrandBookData, InsertItem } from '../shared/messages';
import { ApiClient, ApiFailure } from './api';
import { sendToMain, waitForChunkResult, waitForInsertDone } from './bridge';
import { ROLE_LABEL, categoryOf, fileExt, fileNameFor, hostLabel, isSvg, safeName, type Measured } from './lib';

export const ZIP_MAX_FILES = 100;
export const ZIP_MAX_BYTES = 200 * 1024 * 1024;
const INSERT_CHUNK = 5;

export interface Failure {
  id: string;
  reason: string;
}

export interface Progress {
  done: number;
  total: number;
  failed: number;
}

export function failureText(err: unknown): string {
  if (err instanceof ApiFailure) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

/** Run async work with at most `size` tasks at once, in order of the list. */
export async function pool<T, R>(items: T[], size: number, fn: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const results = new Array<R>(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      if (signal?.aborted) return;
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

export function saveBlob(bytes: Uint8Array, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadOne(api: ApiClient, jobId: string, c: Candidate, index = 0): Promise<void> {
  const { bytes, mime } = await api.bytes(api.fileUrl(jobId, c.id, { download: true }));
  const name = fileNameFor(c, index, new Set(), mime);
  saveBlob(bytes, name, mime);
}

export interface ZipResult {
  ok: number;
  failures: Failure[];
  skipped: number;
  canceled: boolean;
}

/** Download many files into one ZIP, built in the browser, with hard limits and a failure list. */
export async function downloadZip(
  api: ApiClient,
  jobId: string,
  items: Candidate[],
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<ZipResult> {
  const picked = items.filter((c) => c.downloadable).slice(0, ZIP_MAX_FILES);
  const skipped = items.length - picked.length;
  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  const used = new Set<string>();
  const failures: Failure[] = [];
  let total = 0;
  let done = 0;
  await pool(
    picked,
    3,
    async (c, i) => {
      try {
        if (total > ZIP_MAX_BYTES) throw new Error('ZIP size limit reached');
        const { bytes, mime } = await api.bytes(api.fileUrl(jobId, c.id, { download: true }), signal);
        total += bytes.length;
        files[fileNameFor(c, i, used, mime)] = [bytes, { level: 0 }];
      } catch (err) {
        if (!signal.aborted) failures.push({ id: c.id, reason: failureText(err) });
      } finally {
        done++;
        onProgress({ done, total: picked.length, failed: failures.length });
      }
    },
    signal,
  );
  const ok = Object.keys(files).length;
  if (ok > 0 && !signal.aborted) {
    saveBlob(zipSync(files), `grab_${hostLabel(picked[0].sourceUrl).replace(/\./g, '-')}_${ok}-files.zip`, 'application/zip');
  }
  return { ok, failures, skipped, canceled: signal.aborted };
}

export interface InsertSummary {
  placed: number;
  failures: Failure[];
  canceled: boolean;
}

function layerName(c: Candidate, index: number, used: Set<string>): string {
  const n = fileNameFor(c, index, used).replace(/\.[a-z0-9]+$/i, '');
  return c.kind === 'video' ? `${n} (video poster)` : n;
}

async function toInsertItem(api: ApiClient, jobId: string, c: Candidate, name: string, signal: AbortSignal): Promise<InsertItem> {
  if (c.kind === 'video') {
    // Figma plugins cannot rely on video upload (plan and size limits), so the poster frame is inserted.
    const r = await api.bytes(api.previewUrl(jobId, c.id, 1600, 'png'), signal, 60000);
    return { id: c.id, name, kind: 'raster', bytes: r.bytes };
  }
  const r = await api.bytes(api.fileUrl(jobId, c.id, { figma: true }), signal, 90000);
  if (r.mime.includes('svg') || isSvg(c)) {
    return { id: c.id, name, kind: 'svg', svg: new TextDecoder().decode(r.bytes) };
  }
  return { id: c.id, name, kind: 'raster', bytes: r.bytes };
}

/** Insert in small chunks so the editor stays responsive; one broken item never stops the rest. */
export async function insertIntoFigma(
  api: ApiClient,
  jobId: string,
  items: Candidate[],
  frameName: string,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<InsertSummary> {
  const batchId = Math.random().toString(36).slice(2);
  const failures: Failure[] = [];
  const used = new Set<string>();
  const names = items.map((c, i) => layerName(c, i, used));
  let placed = 0;
  let handled = 0;
  sendToMain({ type: 'insert:start', batchId, frameName, total: items.length });
  try {
    for (let start = 0; start < items.length; start += INSERT_CHUNK) {
      if (signal.aborted) break;
      const slice = items.slice(start, start + INSERT_CHUNK);
      const prepared = await Promise.all(
        slice.map(async (c, k) => {
          try {
            return await toInsertItem(api, jobId, c, names[start + k], signal);
          } catch (err) {
            if (!signal.aborted) failures.push({ id: c.id, reason: failureText(err) });
            return null;
          }
        }),
      );
      const ready = prepared.filter((x): x is InsertItem => x !== null);
      if (ready.length && !signal.aborted) {
        sendToMain({ type: 'insert:chunk', batchId, items: ready });
        try {
          const results = await waitForChunkResult(batchId);
          for (const r of results) {
            if (r.ok) placed++;
            else failures.push({ id: r.id, reason: r.reason ?? 'Could not place this image' });
          }
        } catch (err) {
          for (const r of ready) failures.push({ id: r.id, reason: failureText(err) });
        }
      }
      handled += slice.length;
      onProgress({ done: handled, total: items.length, failed: failures.length });
      await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
    }
  } finally {
    sendToMain({ type: 'insert:end', batchId, canceled: signal.aborted });
    await waitForInsertDone(batchId);
  }
  return { placed, failures, canceled: signal.aborted };
}

export { fileExt, safeName };

// ------------------------------------------------------------------ brand book ---

export interface BrandSource {
  items: Candidate[];
  colors: BrandColor[];
  fonts: FontInfo[];
  typeScale: TypeStyle[];
  host: string;
  measured: Measured;
}

async function limitAll<T, R>(list: T[], n: number, fn: (x: T) => Promise<R | null>): Promise<R[]> {
  const out: (R | null)[] = new Array(list.length).fill(null);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, list.length) }, async () => {
      while (i < list.length) {
        const k = i++;
        out[k] = await fn(list[k]).catch(() => null);
      }
    }),
  );
  return out.filter((x): x is R => x !== null);
}

async function asGraphic(api: ApiClient, jobId: string, c: Candidate, signal: AbortSignal): Promise<{ svg?: string; bytes?: Uint8Array } | null> {
  if (isSvg(c) || c.origin === 'inline-svg') {
    const r = await api.bytes(api.fileUrl(jobId, c.id, { figma: true }), signal, 30000);
    return { svg: new TextDecoder().decode(r.bytes) };
  }
  const r = await api.bytes(api.previewUrl(jobId, c.id, 1200, 'png'), signal, 45000);
  return { bytes: r.bytes };
}

/**
 * How light a logo is: the average luminance of its visible pixels, measured by drawing it on a
 * canvas. The brand book uses it to never put a white logo on white (or a black one on black).
 */
async function withTone<T extends { svg?: string; bytes?: Uint8Array } | null>(g: T): Promise<T> {
  if (!g) return g;
  try {
    const blob = g.svg ? new Blob([g.svg], { type: 'image/svg+xml' }) : new Blob([g.bytes! as BlobPart], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((ok, fail) => {
        img.onload = () => ok();
        img.onerror = () => fail(new Error('unreadable'));
        img.src = url;
      });
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      const s = Math.min(64 / (img.naturalWidth || 64), 64 / (img.naturalHeight || 64));
      ctx.drawImage(img, 0, 0, (img.naturalWidth || 64) * s, (img.naturalHeight || 64) * s);
      const d = ctx.getImageData(0, 0, 64, 64).data;
      let sum = 0;
      let n = 0;
      const lin = (v: number) => (v <= 10 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4));
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
        n++;
      }
      if (n > 20) return { ...g, lum: sum / n };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    /* unknown tone: the brand book plays safe */
  }
  return g;
}

/** Collects everything the brand book needs: palette, type, logo, icons and the strongest images. */
export async function collectBrandBook(api: ApiClient, jobId: string, src: BrandSource, onStep: (text: string) => void, signal: AbortSignal): Promise<BrandBookData> {
  const area = (c: Candidate) => {
    const m = src.measured[c.id];
    const w = m?.w ?? c.width ?? 0;
    const h = m?.h ?? c.height ?? (w ? w * 0.66 : 0);
    return w * h;
  };
  const logoCand = src.items.find((c) => c.role === 'logo') ?? null;
  const favCand = src.items.filter((c) => c.origin === 'favicon').sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0] ?? null;
  onStep('Getting the logo');
  const logo = logoCand ? await asGraphic(api, jobId, logoCand, signal).then(withTone).catch(() => null) : null;
  const favicon = favCand && favCand !== logoCand ? await asGraphic(api, jobId, favCand, signal).then(withTone).catch(() => null) : null;

  onStep('Getting icons');
  const iconCands = src.items
    .filter((c) => c !== logoCand && c.kind === 'image' && categoryOf(c, src.measured) === 'icon' && (isSvg(c) || c.origin === 'inline-svg'))
    .slice(0, 60);
  const used = new Set<string>();
  const icons = await limitAll(iconCands, 6, async (c) => {
    const g = await asGraphic(api, jobId, c, signal);
    if (!g?.svg || g.svg.length > 200_000) return null;
    const name = (c.title || fileNameFor(c, 0, used).replace(/\.[a-z0-9]+$/i, '')).replace(/[/\\]+/g, '-').slice(0, 40) || 'icon';
    return withTone({ name, svg: g.svg });
  });

  onStep('Getting key images');
  const imageCands = src.items
    .filter((c) => c !== logoCand && c.kind === 'image' && categoryOf(c, src.measured) === 'image' && !isSvg(c))
    .sort((a, b) => area(b) - area(a))
    .slice(0, 12);
  const images = await limitAll(imageCands, 4, async (c) => {
    const r = await api.bytes(api.previewUrl(jobId, c.id, 1200, 'png'), signal, 45000);
    return { name: (c.title || fileNameFor(c, 0, used)).slice(0, 60), bytes: r.bytes };
  });

  const name = src.host.replace(/^www\./, '').split('.')[0];
  return {
    host: src.host,
    siteName: name.charAt(0).toUpperCase() + name.slice(1),
    date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    colors: src.colors.map((c) => ({ hex: c.hex, label: c.name ?? ROLE_LABEL[c.role], source: c.source, share: c.share })),
    fonts: src.fonts,
    typeScale: src.typeScale,
    logo,
    favicon,
    icons,
    images,
  };
}

/** Design tokens (W3C draft format, also read by Tokens Studio) plus a Tailwind theme snippet. */
export function exportTokens(src: BrandSource): void {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const color: Record<string, unknown> = {};
  const count = new Map<string, number>();
  for (const c of src.colors) {
    const base = slug(c.name ?? ROLE_LABEL[c.role]);
    const n = (count.get(base) ?? 0) + 1;
    count.set(base, n);
    color[n > 1 ? `${base}-${n}` : base] = { $type: 'color', $value: c.hex, $description: `from ${c.source}` };
  }
  const fontFamily: Record<string, unknown> = {};
  for (const f of src.fonts) fontFamily[slug(f.roles[0] ?? 'font')] ??= { $type: 'fontFamily', $value: f.family };
  const typography: Record<string, unknown> = {};
  for (const t of src.typeScale) {
    typography[t.tag] = {
      $type: 'typography',
      $value: { fontFamily: t.family, fontSize: `${t.sizePx}px`, fontWeight: t.weight, ...(t.lineHeightPx ? { lineHeight: `${t.lineHeightPx}px` } : {}), ...(t.letterSpacingPx ? { letterSpacing: `${t.letterSpacingPx}px` } : {}) },
    };
  }
  const tokens = { $description: `Design tokens collected from ${src.host} with GRAB`, color, fontFamily, typography };
  const tailwind = {
    theme: {
      extend: {
        colors: Object.fromEntries(Object.entries(color).map(([k, v]) => [k, (v as { $value: string }).$value])),
        fontFamily: Object.fromEntries(Object.entries(fontFamily).map(([k, v]) => [k, [(v as { $value: string }).$value, 'sans-serif']])),
        fontSize: Object.fromEntries(src.typeScale.map((t) => [t.tag, [`${t.sizePx / 16}rem`, { lineHeight: t.lineHeightPx ? `${t.lineHeightPx / 16}rem` : 'normal', fontWeight: String(t.weight) }]])),
      },
    },
  };
  const enc = new TextEncoder();
  const host = src.host.replace(/^www\./, '').replace(/\./g, '-');
  saveBlob(
    zipSync({
      'tokens.json': enc.encode(JSON.stringify(tokens, null, 2)),
      'tailwind.theme.json': enc.encode(JSON.stringify(tailwind, null, 2)),
    }),
    `grab_${host}_design-tokens.zip`,
    'application/zip',
  );
}
