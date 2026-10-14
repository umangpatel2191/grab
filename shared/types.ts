// Types shared by the backend and the Figma plugin UI.

export type MediaKind = 'image' | 'video';

export type Origin =
  | 'img'
  | 'srcset'
  | 'picture'
  | 'css-background'
  | 'og-image'
  | 'twitter-image'
  | 'favicon'
  | 'lazy-attribute'
  | 'link'
  | 'script-json'
  | 'data-uri'
  | 'video'
  | 'og-video'
  | 'embed'
  | 'inline-svg';

export type ReasonCode =
  | 'INVALID_URL'
  | 'BLOCKED_TARGET'
  | 'ROBOTS_DISALLOWED'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'RATE_LIMITED'
  | 'UNSUPPORTED_SOURCE'
  | 'LOGIN_REQUIRED'
  | 'BLOCKED_BY_SITE'
  | 'NOT_FOUND'
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'NOT_HTML'
  | 'NOT_MEDIA'
  | 'NOT_DIRECT_MEDIA'
  | 'EXPIRED_MEDIA'
  | 'DEEP_UNAVAILABLE'
  | 'TOOL_UNAVAILABLE'
  | 'CANCELED'
  | 'INTERNAL';

export interface Variant {
  url: string;
  width: number | null;
  height: number | null;
}

export interface Candidate {
  /** Stable id inside one job. Never a raw URL. */
  id: string;
  kind: MediaKind;
  origin: Origin;
  /** Source group: always "web". */
  groupId: string;
  /** Page (or profile) that contained the reference. */
  sourceUrl: string;
  url: string;
  /** Poster / preview image for videos (and the HD image for social items). */
  posterUrl: string | null;
  /** Used if the poster fails (for example YouTube maxres is missing). */
  posterFallback: string | null;
  width: number | null;
  height: number | null;
  dimsSource: 'attr' | 'url' | 'unknown';
  mime: string | null;
  /** Estimated or verified byte size; null when unknown. */
  bytes: number | null;
  durationSec: number | null;
  title: string | null;
  /** True when the server can stream the real file (direct media). */
  downloadable: boolean;
  variants: Variant[];
  /** The full-resolution file when the page used a resized copy (a guess: tried first, then url). */
  originalUrl?: string | null;
  /** "logo" for the site's own logo. */
  role?: 'logo' | null;
  warnings: string[];
}

export type ColorRole = 'theme' | 'brand' | 'accent' | 'background' | 'logo' | 'palette' | 'neutral';

export interface BrandColor {
  hex: string; // "#RRGGBB"
  role: ColorRole;
  /** Where it came from, in plain words: "theme-color", "--primary", "logo", "stylesheet". */
  source: string;
  /** Higher means more prominent on the page. */
  weight: number;
  /** Palette name given after ranking: Primary, Secondary, Accent, Dark, Light. */
  name?: string;
  /** Share of the rendered page this color covers (0–1), when measured. */
  share?: number;
}

export interface FontFile {
  url: string;
  format: string | null;
  weight: string;
  style: string;
}

export interface FontInfo {
  family: string;
  /** Where the page uses it, from the most important: heading, body, button, other. */
  roles: ('heading' | 'body' | 'button' | 'other')[];
  source: 'google' | 'adobe' | 'self-hosted' | 'system';
  weights: string[];
  /** Font files the site serves (not offered for download: fonts carry their own licenses). */
  files: FontFile[];
  /** How strongly the page uses it; higher first. */
  weight: number;
}

/** One step of the site's type scale, as the page renders it. */
export interface TypeStyle {
  /** h1…h6, body, button, link, small */
  tag: string;
  family: string;
  sizePx: number;
  weight: number;
  lineHeightPx: number | null;
  letterSpacingPx: number | null;
  transform: string | null;
  /** "measured" from the rendered page, or "css" from the stylesheets. */
  from: 'measured' | 'css';
}

export type ScanEvent =
  | { type: 'fonts.found'; sourceId: string; fonts: FontInfo[]; typeScale?: TypeStyle[] }
  | { type: 'brand.found'; sourceId: string; colors: BrandColor[] }
  | { type: 'source.started'; sourceId: string; url: string }
  | { type: 'image.found'; sourceId: string; candidates: Candidate[] }
  | { type: 'source.warning'; sourceId: string; code: ReasonCode; message: string }
  | { type: 'source.progress'; sourceId: string; pagesDone: number; pagesTotal: number; url: string }
  | { type: 'source.done'; sourceId: string; count: number }
  | { type: 'job.done'; status: 'done' | 'canceled' }

export interface ScanOptions {
  deep?: boolean;
  /** How many pages of each website to read (1 = only the link itself). Same-site links and the sitemap are followed. */
  pages?: number;
}

export interface CreateScanRequest {
  urls: string[];
  options?: ScanOptions;
}

export interface CreateScanResponse {
  jobId: string;
  sources: { id: string; url: string }[];
  rejected: { input: string; code: ReasonCode }[];
}

export interface PollResponse {
  status: 'running' | 'done' | 'canceled';
  next: number;
  events: ScanEvent[];
}

export interface HealthResponse {
  ok: true;
  version: string;
  features: {
    thumbnails: boolean;
    deepScan: boolean;
  };
  limits: {
    maxUrlsPerScan: number;
    maxPagesPerSite?: number;
    maxImageMb: number;
    maxVideoMb: number;
  };
}

export interface ApiError {
  error: { code: ReasonCode; message: string };
}

