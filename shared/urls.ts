import type { ReasonCode } from './types';

export interface ParsedInput {
  valid: string[];
  invalid: { input: string; code: ReasonCode }[];
  duplicates: number;
}

const TRAILING_JUNK = /[)\]}>.,;:'"!?]+$/;
const LEADING_JUNK = /^[(\[{<'"]+/;

/** Normalize one user-typed link. Returns null when it cannot be a web link. */
export function normalizeUrl(raw: string): string | null {
  let s = raw.trim().replace(LEADING_JUNK, '').replace(TRAILING_JUNK, '');
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) {
    // mailto:, javascript:, ftp:, data: ... are never valid here
    return null;
  }
  if (s.startsWith('//')) s = 'https:' + s;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.hostname || !u.hostname.includes('.') && !isIpLiteral(u.hostname)) return null;
  u.hash = '';
  if (u.pathname === '') u.pathname = '/';
  return u.toString();
}

function isIpLiteral(host: string): boolean {
  return host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host);
}

/** Split pasted text (lines, commas, spaces) and normalize every link. */
export function parseUrlInput(text: string, maxUrls = 10): ParsedInput {
  const out: ParsedInput = { valid: [], invalid: [], duplicates: 0 };
  const seen = new Set<string>();
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  for (const part of parts) {
    const n = normalizeUrl(part);
    if (!n) {
      out.invalid.push({ input: part.slice(0, 200), code: 'INVALID_URL' });
      continue;
    }
    const key = dedupeKey(n);
    if (seen.has(key)) {
      out.duplicates++;
      continue;
    }
    seen.add(key);
    if (out.valid.length >= maxUrls) {
      out.invalid.push({ input: part.slice(0, 200), code: 'TOO_LARGE' });
      continue;
    }
    out.valid.push(n);
  }
  return out;
}

function dedupeKey(url: string): string {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '') || '/';
  return `${host}${path}${u.search}`;
}

// --------------------------------------------------------------- variants ---

const SIZE_SUFFIX = /[-_@](\d{2,5})x(\d{2,5})(?=\.[a-z0-9]+$)/i;
const SCALE_SUFFIX = /@[1-4]x(?=\.[a-z0-9]+$)/i;
const SIZE_PARAMS = new Set(['w', 'h', 'width', 'height', 'q', 'quality', 'fit', 'crop', 'auto', 'dpr', 'fm', 'format', 'resize', 'size', 'ixlib', 's']);

/** Key that groups the same picture at several sizes. */
export function variantKey(url: string): string {
  if (url.startsWith('data:')) return url.slice(0, 120) + url.length;
  try {
    const u = new URL(url);
    let path = u.pathname.replace(SIZE_SUFFIX, '').replace(SCALE_SUFFIX, '');
    const kept = [...u.searchParams.entries()]
      .filter(([k]) => !SIZE_PARAMS.has(k.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return `${u.hostname.replace(/^www\./, '')}${path}${kept ? '?' + kept : ''}`;
  } catch {
    return url;
  }
}

export function dimsFromUrl(url: string): { width: number; height: number } | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(SIZE_SUFFIX);
    if (m) return { width: Number(m[1]), height: Number(m[2]) };
  } catch {
    /* ignore */
  }
  return null;
}

export const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp|ico|tiff?|heic)(?=($|[?#]))/i;
export const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv|m3u8|mpd)(?=($|[?#]))/i;
export const DIRECT_VIDEO_EXT = /\.(mp4|webm|mov|m4v)(?=($|[?#]))/i;

export function guessMime(url: string): string | null {
  const m = url.match(/\.(jpe?g|png|gif|webp|avif|svg|bmp|ico|tiff?|heic|mp4|webm|mov|m4v|ogv|m3u8|mpd)(?=($|[?#]))/i);
  if (!m) return null;
  const e = m[1].toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', tif: 'image/tiff',
    tiff: 'image/tiff', heic: 'image/heic', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    m4v: 'video/mp4', ogv: 'video/ogg', m3u8: 'application/vnd.apple.mpegurl', mpd: 'application/dash+xml',
  };
  return map[e] ?? null;
}
