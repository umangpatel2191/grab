import { Readable } from 'node:stream';
import type { Candidate } from '../../shared/types';
import type { Config } from './config';
import { GrabError, type SafeFetcher } from './net/safeFetch';
import { extForMime, sniffImage, sniffVideo } from './sniff';

export interface MediaResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer | Readable;
}

let sharpPromise: Promise<any | null> | null = null;
export function getSharp(): Promise<any | null> {
  sharpPromise ??= import('sharp')
    .then((m) => {
      const sharp = m.default ?? m;
      if (process.env.GRAB_LOW_MEMORY === '1') {
        // a 512 MB server: no decoded-image cache, one image at a time per call
        sharp.cache(false);
        sharp.concurrency(1);
      }
      return sharp;
    })
    .catch(() => null);
  return sharpPromise;
}

const SAFE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'cross-origin',
  // Remote SVG is untrusted: even if opened directly it can not run scripts or load anything.
  'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
};

function decodeDataUri(uri: string): { buf: Buffer; mime: string } {
  const comma = uri.indexOf(',');
  const meta = uri.slice(5, comma);
  const mime = meta.split(';')[0] || 'application/octet-stream';
  const body = uri.slice(comma + 1);
  const buf = meta.includes(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
  return { buf, mime };
}

async function loadImageBuffer(url: string, cand: Candidate, fetcher: SafeFetcher, cfg: Config, signal?: AbortSignal) {
  if (url.startsWith('data:')) {
    const { buf } = decodeDataUri(url);
    return buf;
  }
  const res = await fetcher.fetchBuffer(url, {
    maxBytes: cfg.maxImageBytes,
    accept: 'image/*,*/*;q=0.5',
    referer: cand.sourceUrl,
    signal,
  });
  if (res.truncated) throw new GrabError('TOO_LARGE', 'This image is too large.');
  return res.body;
}

function filenameFor(cand: Candidate, mime: string): string {
  let base = 'image';
  try {
    const last = decodeURIComponent(new URL(cand.url).pathname.split('/').filter(Boolean).pop() || '');
    base = last.replace(/\.[a-z0-9]{2,5}$/i, '') || base;
  } catch {
    /* data: uris have no path */
  }
  base = base.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(0, 60) || 'media';
  return `${base}.${extForMime(mime)}`;
}

/** Small preview for the grid. Only server-created candidates reach this function. */
export async function buildPreview(cand: Candidate, width: number, fmt: 'webp' | 'png', deps: { fetcher: SafeFetcher; cfg: Config; signal?: AbortSignal }): Promise<MediaResponse> {
  const { fetcher, cfg, signal } = deps;
  const targets = (cand.kind === 'video' ? [cand.posterUrl, cand.posterFallback] : [cand.url, cand.posterFallback]).filter(Boolean) as string[];
  if (!targets.length) throw new GrabError('NOT_FOUND', 'No preview image for this item.');
  let buf: Buffer | null = null;
  let lastErr: unknown;
  for (const t of targets) {
    try {
      buf = await loadImageBuffer(t, cand, fetcher, cfg, signal);
      break;
    } catch (err) {
      lastErr = err;
      if (err instanceof GrabError && (err.code === 'BLOCKED_TARGET' || err.code === 'CANCELED')) throw err;
    }
  }
  if (!buf) throw lastErr instanceof GrabError ? lastErr : new GrabError('NETWORK_ERROR', 'Could not load the preview.');
  const mime = sniffImage(buf);
  if (!mime) throw new GrabError('NOT_MEDIA', 'This link did not return a real image.');
  const sharp = await getSharp();
  const headers: Record<string, string> = { ...SAFE_HEADERS, 'cache-control': 'private, max-age=900', 'x-grab-bytes': String(buf.length) };
  if (sharp && mime === 'image/gif' && buf.length <= 3 * 1024 * 1024) {
    // keep animation: small GIFs are shown as the real GIF
    try {
      const meta = await sharp(buf, { limitInputPixels: 80_000_000, failOn: 'none' }).metadata();
      if (meta.width && (meta.pageHeight ?? meta.height)) {
        headers['x-grab-width'] = String(meta.width);
        headers['x-grab-height'] = String(meta.pageHeight ?? meta.height);
      }
    } catch {
      /* dimensions are optional */
    }
    return { status: 200, headers: { ...headers, 'content-type': 'image/gif' }, body: buf };
  }
  if (sharp) {
    try {
      // report the ORIGINAL size so the plugin can show real dimensions without downloading the file
      const meta = await sharp(buf, { limitInputPixels: 80_000_000, failOn: 'none' }).metadata();
      if (meta.width && meta.height) {
        const swap = (meta.orientation ?? 1) >= 5;
        headers['x-grab-width'] = String(swap ? meta.height : meta.width);
        headers['x-grab-height'] = String(swap ? meta.width : meta.height);
      }
      const out = await sharp(buf, { limitInputPixels: 80_000_000, failOn: 'none' })
        .rotate()
        .resize({ width: Math.min(Math.max(width, 64), fmt === 'png' ? 2400 : 800), withoutEnlargement: true });
      const encoded = fmt === 'png' ? await out.png().toBuffer() : await out.webp({ quality: 78 }).toBuffer();
      return { status: 200, headers: { ...headers, 'content-type': fmt === 'png' ? 'image/png' : 'image/webp' }, body: encoded };
    } catch {
      /* fall through to the original bytes */
    }
  }
  if (buf.length > 5 * 1024 * 1024) throw new GrabError('TOO_LARGE', 'Preview is too large to show.');
  return { status: 200, headers: { ...headers, 'content-type': mime }, body: buf };
}

const FIGMA_NATIVE = new Set(['image/png', 'image/jpeg', 'image/gif']);

async function forFigma(buf: Buffer, mime: string): Promise<{ buf: Buffer; mime: string }> {
  if (mime === 'image/svg+xml') return { buf, mime };
  const sharp = await getSharp();
  if (!sharp) return { buf, mime };
  try {
    const meta = await sharp(buf, { limitInputPixels: 80_000_000, failOn: 'none' }).metadata();
    const tooBig = (meta.width ?? 0) > 4096 || (meta.height ?? 0) > 4096;
    if (FIGMA_NATIVE.has(mime) && !tooBig) return { buf, mime };
    let p = sharp(buf, { limitInputPixels: 80_000_000, failOn: 'none' }).rotate();
    if (tooBig) p = p.resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true });
    if (mime === 'image/jpeg') return { buf: await p.jpeg({ quality: 92 }).toBuffer(), mime };
    return { buf: await p.png().toBuffer(), mime: 'image/png' };
  } catch {
    return { buf, mime };
  }
}

/**
 * HD: when even the original is small, enlarge it 2× (up to 4096 px) with Lanczos resampling and a
 * light sharpen. This makes images crisp at larger sizes in Figma; it cannot invent detail that the
 * source never had. SVG, GIF and images that are already large are left as they are.
 */
export async function upscale(buf: Buffer, mime: string): Promise<{ buf: Buffer; mime: string }> {
  if (mime === 'image/svg+xml' || mime === 'image/gif') return { buf, mime };
  const sharp = await getSharp();
  if (!sharp) return { buf, mime };
  try {
    const meta = await sharp(buf, { limitInputPixels: 80_000_000, failOn: 'none' }).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const long = Math.max(w, h);
    if (!w || !h || long >= 1600) return { buf, mime };
    const factor = Math.min(2, 4096 / long);
    const p = sharp(buf, { limitInputPixels: 80_000_000, failOn: 'none' })
      .rotate()
      .resize({ width: Math.round(w * factor), height: Math.round(h * factor), kernel: 'lanczos3' })
      .sharpen({ sigma: 0.6, m1: 0.5, m2: 1.5 });
    if (mime === 'image/jpeg') return { buf: await p.jpeg({ quality: 93, mozjpeg: true }).toBuffer(), mime };
    return { buf: await p.png({ compressionLevel: 8 }).toBuffer(), mime: 'image/png' };
  } catch {
    return { buf, mime };
  }
}

/** Full file for download or insert. Only fetched after an explicit user action. */
export async function buildFile(
  cand: Candidate,
  opts: { figma: boolean; download: boolean; hd?: boolean },
  deps: { fetcher: SafeFetcher; cfg: Config; signal?: AbortSignal },
): Promise<MediaResponse> {
  const { fetcher, cfg, signal } = deps;
  if (!cand.downloadable) {
    throw new GrabError('NOT_DIRECT_MEDIA', 'This item is not a direct file. Open it at the source.');
  }
  const disp = (name: string) => `${opts.download ? 'attachment' : 'inline'}; filename="${name}"`;

  if (cand.kind === 'video') {
    const stream = await fetcher.fetchStream(cand.url, { maxBytes: cfg.maxVideoBytes, accept: 'video/*,*/*;q=0.5', referer: cand.sourceUrl, signal });
    if (stream.contentLength && stream.contentLength > cfg.maxVideoBytes) {
      stream.cancel();
      throw new GrabError('TOO_LARGE', `This video is larger than ${Math.round(cfg.maxVideoBytes / 1048576)} MB. Open it at the source.`);
    }
    const reader = stream.body.getReader();
    const first = await reader.read();
    const head = first.value ? Buffer.from(first.value) : Buffer.alloc(0);
    const ctype = (stream.headers.get('content-type') || '').toLowerCase();
    const mime = sniffVideo(head) ?? (ctype.startsWith('video/') ? ctype.split(';')[0] : null);
    if (!mime) {
      await reader.cancel().catch(() => undefined);
      throw new GrabError('NOT_MEDIA', 'This link did not return a video file.');
    }
    let total = head.length;
    const max = cfg.maxVideoBytes;
    async function* gen() {
      yield head;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        total += value.length;
        if (total > max) {
          await reader.cancel().catch(() => undefined);
          throw new Error('size cap reached');
        }
        yield Buffer.from(value);
      }
    }
    const headers: Record<string, string> = { ...SAFE_HEADERS, 'content-type': mime, 'content-disposition': disp(filenameFor(cand, mime)), 'cache-control': 'private, no-store' };
    if (stream.contentLength) headers['content-length'] = String(stream.contentLength);
    return { status: 200, headers, body: Readable.from(gen()) };
  }

  // The full-resolution original first (when the page used a resized copy), then the page's own URL.
  let buf: Buffer | null = null;
  let mime: string | null = null;
  if (cand.originalUrl) {
    try {
      const b = await loadImageBuffer(cand.originalUrl, cand, fetcher, cfg, signal);
      const m = sniffImage(b);
      if (m) {
        buf = b;
        mime = m;
      }
    } catch (err) {
      if (err instanceof GrabError && err.code === 'CANCELED') throw err;
      /* the guess was wrong: use the page's URL */
    }
  }
  if (!buf) {
    buf = await loadImageBuffer(cand.url, cand, fetcher, cfg, signal);
    mime = sniffImage(buf);
  }
  if (!mime) throw new GrabError('NOT_MEDIA', 'This link did not return a real image.');
  let out = { buf, mime };
  if (opts.hd) out = await upscale(out.buf, out.mime);
  if (opts.figma) out = await forFigma(out.buf, out.mime);
  return {
    status: 200,
    headers: { ...SAFE_HEADERS, 'content-type': out.mime, 'content-disposition': disp(filenameFor(cand, out.mime)), 'cache-control': 'private, no-store' },
    body: out.buf,
  };
}
