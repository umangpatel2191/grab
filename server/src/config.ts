export interface Config {
  port: number;
  host: string;
  version: string;
  userAgent: string;
  /** Tests only. Never enable in production: it disables the SSRF guard. */
  allowPrivate: boolean;
  allowedPorts: number[];
  respectRobots: boolean;
  maxUrlsPerScan: number;
  maxPagesPerSite: number;
  crawlConcurrency: number;
  deepConcurrency: number;
  maxHtmlBytes: number;
  maxCssBytes: number;
  maxImageBytes: number;
  maxVideoBytes: number;
  maxCandidatesPerPage: number;
  fetchTimeoutMs: number;
  jobTtlMs: number;
  maxJobs: number;
  pageConcurrency: number;
  rateLimitPerMinute: number;
  scanRateLimitPerMinute: number;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: num('PORT', 8787),
    host: process.env.HOST ?? '0.0.0.0',
    version: '1.0.0',
    userAgent: process.env.GRAB_USER_AGENT ?? 'GRAB/1.0 (Figma plugin; image discovery for designers)',
    allowPrivate: false,
    allowedPorts: (process.env.GRAB_ALLOWED_PORTS ?? '80,443,8080,8443').split(',').map(Number).filter(Boolean),
    respectRobots: process.env.GRAB_RESPECT_ROBOTS !== '0',
    maxUrlsPerScan: num('GRAB_MAX_URLS', 10),
    maxPagesPerSite: num('GRAB_MAX_PAGES', 200),
    crawlConcurrency: num('GRAB_CRAWL_CONCURRENCY', 4),
    deepConcurrency: num('GRAB_DEEP_CONCURRENCY', 2),
    maxHtmlBytes: num('GRAB_MAX_HTML_MB', 3) * 1024 * 1024,
    maxCssBytes: 2 * 1024 * 1024,
    maxImageBytes: num('GRAB_MAX_IMAGE_MB', 25) * 1024 * 1024,
    maxVideoBytes: num('GRAB_MAX_VIDEO_MB', 50) * 1024 * 1024,
    maxCandidatesPerPage: num('GRAB_MAX_CANDIDATES', 3000),
    fetchTimeoutMs: num('GRAB_FETCH_TIMEOUT_MS', 15000),
    jobTtlMs: num('GRAB_JOB_TTL_MIN', 20) * 60 * 1000,
    maxJobs: num('GRAB_MAX_JOBS', 100),
    pageConcurrency: num('GRAB_PAGE_CONCURRENCY', 3),
    rateLimitPerMinute: num('GRAB_RATE_LIMIT', 240),
    scanRateLimitPerMinute: num('GRAB_SCAN_RATE_LIMIT', 20),
    ...overrides,
  };
}
