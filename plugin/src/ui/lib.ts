import type { BrandColor, Candidate } from '../../../shared/types';

export interface Filters {
  query: string;
  type: 'all' | 'image' | 'icon' | 'gif' | 'video' | 'svg';
  source: string; // 'all' or a page url
  showSmall: boolean;
  sort: 'found' | 'size' | 'type';
}

export const DEFAULT_FILTERS: Filters = { query: '', type: 'all', source: 'all', showSmall: false, sort: 'found' };
export const SMALL_SIDE = 100;

export type Measured = Record<string, { w: number; h: number }>;

export function isSvg(c: Candidate): boolean {
  return (c.mime ?? '').includes('svg') || /\.svg(\?|$)/i.test(c.url);
}

export type Category = 'image' | 'icon' | 'gif' | 'video';

export const ICON_SIDE = 256;
const ICONISH = /(^|[/_.-])(logo|logotype|wordmark|favicon|icon|icons|sprite|badge|apple-touch)([/_.@-]|\d|$)/i;

export function isGif(c: Candidate): boolean {
  return c.kind === 'image' && ((c.mime ?? '').includes('gif') || /\.gif(\?|#|$)/i.test(c.url));
}

/** Where a found file is shown on a website: videos, GIFs, icons and logos, or plain images. */
export function categoryOf(c: Candidate, m?: Measured): Category {
  if (c.kind === 'video') return 'video';
  if (isGif(c)) return 'gif';
  if (c.origin === 'favicon') return 'icon';
  // inline svgs are icons and logos unless they are drawn large
  if (c.origin === 'inline-svg') return (longestSide(c, m) ?? 0) > 400 ? 'image' : 'icon';
  const s = longestSide(c, m);
  if (s !== null && s <= ICON_SIDE && !(c.origin === 'og-image' || c.origin === 'twitter-image')) return 'icon';
  let path = c.url;
  try {
    path = new URL(c.url).pathname;
  } catch {
    /* data: uri */
  }
  if (!c.url.startsWith('data:') && (ICONISH.test(path) || /\blogo\b/i.test(c.title ?? ''))) return 'icon';
  return 'image';
}

export function dims(c: Candidate, m?: Measured): { w: number; h: number } | null {
  if (c.width && c.height) return { w: c.width, h: c.height };
  const x = m?.[c.id];
  if (x) return x;
  if (c.width) return { w: c.width, h: c.height ?? 0 };
  return null;
}

export function longestSide(c: Candidate, m?: Measured): number | null {
  const d = dims(c, m);
  return d ? Math.max(d.w, d.h) : null;
}

/** Small = icons and favicons. Unknown size is never treated as small. */
export function isSmall(c: Candidate, m?: Measured): boolean {
  if (c.kind === 'video') return false;
  if (c.origin === 'favicon') return true;
  const s = longestSide(c, m);
  return s !== null && s < SMALL_SIDE;
}

export function applyFilters(items: Candidate[], f: Filters, m: Measured): Candidate[] {
  const q = f.query.trim().toLowerCase();
  let out = items.filter((c) => {
    if (f.source !== 'all' && c.sourceUrl !== f.source) return false;
    if (f.type === 'image' && c.kind !== 'image') return false;
    if (f.type === 'video' && c.kind !== 'video') return false;
    if (f.type === 'gif' && !isGif(c)) return false;
    if (f.type === 'icon' && categoryOf(c, m) !== 'icon') return false;
    if (f.type === 'svg' && !isSvg(c)) return false;
    if (!f.showSmall && isSmall(c, m)) return false;
    if (q && !(c.url.toLowerCase().includes(q) || (c.title ?? '').toLowerCase().includes(q))) return false;
    return true;
  });
  if (f.sort === 'size') {
    out = [...out].sort((a, b) => (longestSide(b, m) ?? -1) - (longestSide(a, m) ?? -1));
  } else if (f.sort === 'type') {
    out = [...out].sort((a, b) => extLabel(a).localeCompare(extLabel(b)));
  }
  return out;
}

export function extLabel(c: Candidate): string {
  const mime = c.mime ?? '';
  if (mime.includes('svg')) return 'SVG';
  const m = mime.match(/^(?:image|video)\/([\w.+-]+)/);
  if (m) return m[1].replace('jpeg', 'jpg').replace('quicktime', 'mov').replace('x-icon', 'ico').toUpperCase().slice(0, 4);
  const u = c.url.match(/\.([a-z0-9]{2,4})(?:$|[?#])/i);
  if (u) return u[1].toUpperCase().replace('JPEG', 'JPG');
  return c.kind === 'video' ? 'VID' : 'IMG';
}

export function formatDims(c: Candidate, m?: Measured): string {
  const d = dims(c, m);
  if (!d) return '?×?';
  return d.h ? `${d.w}×${d.h}` : `${d.w}w`;
}

export function formatBytes(n: number | null): string {
  if (n === null || n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function formatDuration(s: number | null): string {
  if (!s) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

export function pageLabel(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return (u.hostname.replace(/^www\./, '') + p).slice(0, 40);
  } catch {
    return url.slice(0, 40);
  }
}


/** Colors from every scanned page, strongest first, without repeats. */
export function mergeBrand(perSource: Record<string, BrandColor[]>, cap = 12): BrandColor[] {
  const seen = new Set<string>();
  const out: BrandColor[] = [];
  for (const c of Object.values(perSource).flat().sort((a, b) => b.weight - a.weight)) {
    if (seen.has(c.hex)) continue;
    seen.add(c.hex);
    out.push(c);
    if (out.length >= cap) break;
  }
  return out;
}

export const ROLE_LABEL: Record<BrandColor['role'], string> = {
  theme: 'Theme', brand: 'Brand', accent: 'Accent', background: 'Background', logo: 'Logo', palette: 'Site',
};

export const SUPPORT_EMAIL = 'umangp737@gmail.com';

/** File name that is safe on every operating system and never collides. */
export function safeName(base: string, used: Set<string>): string {
  const clean = base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'file';
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : '';
  let name = clean;
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${stem}_${n++}${ext}`;
  used.add(name.toLowerCase());
  return name;
}

export function fileExt(c: Candidate, mime?: string | null): string {
  const m = (mime ?? c.mime ?? '').toLowerCase();
  const map: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
    'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/tiff': 'tiff', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/ogg': 'ogv',
  };
  if (map[m]) return map[m];
  const u = c.url.match(/\.([a-z0-9]{2,4})(?:$|[?#])/i);
  if (u) return u[1].toLowerCase().replace('jpeg', 'jpg');
  return c.kind === 'video' ? 'mp4' : 'jpg';
}

export function fileNameFor(c: Candidate, index: number, used: Set<string>, mime?: string | null): string {
  const base = `${hostLabel(c.sourceUrl).replace(/\./g, '-')}_${String(index + 1).padStart(3, '0')}.${fileExt(c, mime)}`;
  return safeName(base, used);
}

/** Pretty message for a reason code. Always says what happened and what to do next. */
export function reasonText(code: string, fallback?: string): string {
  const t: Record<string, string> = {
    INVALID_URL: 'That is not a valid link.',
    BLOCKED_TARGET: 'That address cannot be scanned.',
    ROBOTS_DISALLOWED: 'The site asks tools like this not to read this page.',
    TIMEOUT: 'The site took too long. Try again.',
    TOO_LARGE: 'This is too large to handle.',
    RATE_LIMITED: 'Too many requests. Wait a moment and retry.',
    UNSUPPORTED_SOURCE: 'This link cannot be read here. Open it instead.',
    LOGIN_REQUIRED: 'This page needs a login.',
    BLOCKED_BY_SITE: 'The site is blocking automatic access right now.',
    NOT_FOUND: 'Nothing was found here.',
    HTTP_ERROR: 'The site returned an error.',
    NETWORK_ERROR: 'Could not reach the site.',
    NOT_HTML: 'This link is not a web page.',
    NOT_MEDIA: 'The file is not a real image or video.',
    NOT_DIRECT_MEDIA: 'This is not a direct file. Open it at the source.',
    EXPIRED_MEDIA: 'This link expired. Scan again.',
    DEEP_UNAVAILABLE: 'Deep scan is not available on this server.',
    TOOL_UNAVAILABLE: 'This server cannot read this platform.',
    CANCELED: 'Canceled.',
    INTERNAL: 'Something went wrong. Try again.',
  };
  return fallback && code === 'INTERNAL' ? fallback : t[code] ?? fallback ?? 'Something went wrong.';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-100px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
