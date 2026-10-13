import type { ApiError, CreateScanResponse, HealthResponse, PollResponse, ReasonCode, ScanOptions } from '../../../shared/types';

export class ApiFailure extends Error {
  constructor(
    public code: ReasonCode | 'OFFLINE' | 'BAD_BACKEND',
    message: string,
    public status = 0,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

export function normalizeBackend(raw: string): string | null {
  const s = raw.trim().replace(/\/+$/, '');
  // an explicit scheme must be http or https; "ftp://x.com" must not become "https://ftp//x.com"
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) return null;
  try {
    const bare = /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(s);
    const u = new URL(/^https?:\/\//i.test(s) ? s : `${bare ? 'http' : 'https'}://${s}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''));
  } catch {
    return null;
  }
}

export interface BytesResult {
  bytes: Uint8Array;
  mime: string;
}

export class ApiClient {
  readonly base: string;
  /** Ask the server to enlarge small images for downloads and inserts. */
  hd = false;

  constructor(base: string) {
    const n = normalizeBackend(base);
    if (!n) throw new ApiFailure('BAD_BACKEND', 'The server address in Settings is not valid.');
    this.base = n;
  }

  private async raw(path: string, init: RequestInit = {}, timeoutMs = 15000, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await fetch(this.base + path, { ...init, signal: sig });
    } catch (err) {
      if (signal?.aborted) throw new ApiFailure('CANCELED', 'Canceled.');
      if ((err as { name?: string }).name === 'TimeoutError') throw new ApiFailure('TIMEOUT', 'The server took too long to answer.');
      throw new ApiFailure('OFFLINE', 'Cannot reach the GRAB server. Check your connection and the server address in Settings.');
    }
  }

  private async json<T>(path: string, init: RequestInit = {}, timeoutMs = 15000, signal?: AbortSignal): Promise<T> {
    const res = await this.raw(path, init, timeoutMs, signal);
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* not json */
    }
    if (!res.ok) {
      const e = (body as ApiError | null)?.error;
      throw new ApiFailure(e?.code ?? 'INTERNAL', e?.message ?? `The server answered with status ${res.status}.`, res.status);
    }
    return body as T;
  }

  health(timeoutMs = 6000) {
    return this.json<HealthResponse>('/v1/health', {}, timeoutMs);
  }

  /** Free hosts sleep. Keep asking until the server answers, reporting each attempt. */
  async wake(onAttempt: (n: number) => void, signal?: AbortSignal, maxMs = 90000): Promise<HealthResponse> {
    const start = Date.now();
    for (let n = 1; ; n++) {
      onAttempt(n);
      try {
        return await this.json<HealthResponse>('/v1/health', {}, 7000, signal);
      } catch (err) {
        if (err instanceof ApiFailure && (err.code === 'CANCELED' || (err.status >= 400 && err.status < 500 && err.status !== 429))) throw err;
        if (Date.now() - start > maxMs) throw err;
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
  }

  createScan(urls: string[], options: ScanOptions) {
    return this.json<CreateScanResponse>(
      '/v1/scans',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ urls, options }) },
      75000,
    );
  }

  poll(jobId: string, since: number, signal?: AbortSignal) {
    return this.json<PollResponse>(`/v1/scans/${encodeURIComponent(jobId)}?since=${since}`, {}, 12000, signal);
  }

  async cancel(jobId: string) {
    try {
      await this.json(`/v1/scans/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, 6000);
    } catch {
      /* canceling is best effort */
    }
  }

  previewUrl(jobId: string, itemId: string, w = 360, fmt: 'webp' | 'png' = 'webp') {
    return `${this.base}/v1/scans/${encodeURIComponent(jobId)}/items/${encodeURIComponent(itemId)}/preview?w=${w}${fmt === 'png' ? '&fmt=png' : ''}`;
  }

  fileUrl(jobId: string, itemId: string, opts: { download?: boolean; figma?: boolean } = {}) {
    const q = [opts.download ? 'download=1' : '', opts.figma ? 'figma=1' : '', this.hd ? 'hd=1' : ''].filter(Boolean).join('&');
    return `${this.base}/v1/scans/${encodeURIComponent(jobId)}/items/${encodeURIComponent(itemId)}/file${q ? '?' + q : ''}`;
  }

  /** Fetch full file bytes. Only called after an explicit download or insert. */
  async bytes(url: string, signal?: AbortSignal, timeoutMs = 120000): Promise<BytesResult> {
    const path = url.startsWith(this.base) ? url.slice(this.base.length) : url;
    const res = await this.raw(path, {}, timeoutMs, signal);
    if (!res.ok) {
      let e: ApiError['error'] | undefined;
      try {
        e = ((await res.json()) as ApiError).error;
      } catch {
        /* ignore */
      }
      throw new ApiFailure(e?.code ?? 'INTERNAL', e?.message ?? `The server answered with status ${res.status}.`, res.status);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, mime: (res.headers.get('content-type') || '').split(';')[0] };
  }
}
