import dns from 'node:dns';
import { Agent, fetch as ufetch } from 'undici';
import type { ReasonCode } from '../../../shared/types';
import type { Config } from '../config';
import { isBlockedHostname, isBlockedIp } from './ipGuard';

export class GrabError extends Error {
  constructor(
    public code: ReasonCode,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'GrabError';
  }
}

export interface FetchOptions {
  signal?: AbortSignal;
  maxBytes: number;
  timeoutMs?: number;
  referer?: string;
  accept?: string;
  maxRedirects?: number;
}

export interface BufferResult {
  finalUrl: string;
  status: number;
  headers: Headers;
  body: Buffer;
  truncated: boolean;
}

export interface StreamResult {
  finalUrl: string;
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array>;
  contentLength: number | null;
  cancel: () => void;
}

function findGrabError(err: unknown): GrabError | null {
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur; i++) {
    if (cur instanceof GrabError) return cur;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

export function statusToCode(status: number): ReasonCode {
  if (status === 404 || status === 410) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 401 || status === 403) return 'BLOCKED_BY_SITE';
  return 'HTTP_ERROR';
}

/**
 * The only way the server touches the network on behalf of a user.
 * - http(s) only, no embedded credentials, restricted ports
 * - DNS is resolved by us and every address must be public (checked at connect
 *   time, so DNS rebinding cannot swap the address after validation)
 * - redirects are followed manually and every hop is validated again
 * - response size and total time are capped
 */
export class SafeFetcher {
  private agent: Agent;

  constructor(private cfg: Config) {
    const allowPrivate = cfg.allowPrivate;
    const lookup = (hostname: string, options: dns.LookupOptions, cb: (...args: any[]) => void) => {
      dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
        if (err) return cb(err, [], 4);
        const list = addrs as dns.LookupAddress[];
        if (!allowPrivate && list.some((a) => isBlockedIp(a.address))) {
          return cb(new GrabError('BLOCKED_TARGET', 'That address is not allowed.'), [], 4);
        }
        if (options.all) return cb(null, list);
        cb(null, list[0].address, list[0].family);
      });
    };
    this.agent = new Agent({
      connect: { lookup: lookup as never },
      connections: 32,
      headersTimeout: cfg.fetchTimeoutMs,
      bodyTimeout: cfg.fetchTimeoutMs * 2,
    });
  }

  validateUrl(raw: string): URL {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new GrabError('INVALID_URL', 'Not a valid link.');
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new GrabError('INVALID_URL', 'Only http and https links are supported.');
    }
    if (u.username || u.password) throw new GrabError('INVALID_URL', 'Links with credentials are not allowed.');
    if (!this.cfg.allowPrivate) {
      if (u.port && !this.cfg.allowedPorts.includes(Number(u.port))) {
        throw new GrabError('BLOCKED_TARGET', 'That port is not allowed.');
      }
      if (isBlockedHostname(u.hostname)) throw new GrabError('BLOCKED_TARGET', 'That address is not allowed.');
    }
    return u;
  }

  /** For code paths that do their own networking (a headless browser): same rules, checked up front. */
  async assertPublicUrl(raw: string): Promise<void> {
    const u = this.validateUrl(raw);
    if (this.cfg.allowPrivate) return;
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const addrs = await dns.promises.lookup(host, { all: true }).catch(() => {
      throw new GrabError('NETWORK_ERROR', 'The site could not be found.');
    });
    if (addrs.some((a) => isBlockedIp(a.address))) throw new GrabError('BLOCKED_TARGET', 'That address is not allowed.');
  }

  private headers(opts: FetchOptions): Record<string, string> {
    const h: Record<string, string> = {
      'user-agent': this.cfg.userAgent,
      accept: opts.accept ?? '*/*',
      'accept-language': 'en-US,en;q=0.8',
    };
    if (opts.referer) h.referer = opts.referer;
    return h;
  }

  private signalFor(opts: FetchOptions): AbortSignal {
    const t = AbortSignal.timeout(opts.timeoutMs ?? this.cfg.fetchTimeoutMs);
    return opts.signal ? AbortSignal.any([opts.signal, t]) : t;
  }

  private mapError(err: unknown, opts: FetchOptions): GrabError {
    const known = findGrabError(err);
    if (known) return known;
    const name = (err as { name?: string })?.name;
    if (name === 'TimeoutError') return new GrabError('TIMEOUT', 'The site took too long to answer.');
    if (name === 'AbortError') {
      return opts.signal?.aborted ? new GrabError('CANCELED', 'Canceled.') : new GrabError('TIMEOUT', 'The site took too long to answer.');
    }
    const code = (err as { cause?: { code?: string } })?.cause?.code;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new GrabError('NETWORK_ERROR', 'The site could not be found.');
    return new GrabError('NETWORK_ERROR', 'Could not connect to the site.');
  }

  private async open(url: string, opts: FetchOptions) {
    const max = opts.maxRedirects ?? 5;
    const signal = this.signalFor(opts);
    let current = url;
    for (let hop = 0; hop <= max; hop++) {
      this.validateUrl(current);
      let res;
      try {
        res = await ufetch(current, {
          dispatcher: this.agent,
          redirect: 'manual',
          signal,
          headers: this.headers(opts),
        });
      } catch (err) {
        throw this.mapError(err, opts);
      }
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!loc) throw new GrabError('HTTP_ERROR', 'The site sent a broken redirect.');
        try {
          current = new URL(loc, current).toString();
        } catch {
          throw new GrabError('HTTP_ERROR', 'The site sent a broken redirect.');
        }
        continue;
      }
      return { res, finalUrl: current, signal };
    }
    throw new GrabError('HTTP_ERROR', 'Too many redirects.');
  }

  /** Fetch a whole (small) response into memory with a hard byte cap. */
  async fetchBuffer(url: string, opts: FetchOptions): Promise<BufferResult> {
    const { res, finalUrl } = await this.open(url, opts);
    if (res.status >= 400) {
      await res.body?.cancel().catch(() => undefined);
      throw new GrabError(statusToCode(res.status), `The site answered with status ${res.status}.`, res.status);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    try {
      const reader = res.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const buf = Buffer.from(value);
          if (total + buf.length > opts.maxBytes) {
            chunks.push(buf.subarray(0, opts.maxBytes - total));
            total = opts.maxBytes;
            truncated = true;
            await reader.cancel().catch(() => undefined);
            break;
          }
          chunks.push(buf);
          total += buf.length;
        }
      }
    } catch (err) {
      throw this.mapError(err, opts);
    }
    return { finalUrl, status: res.status, headers: res.headers as unknown as Headers, body: Buffer.concat(chunks), truncated };
  }

  /** Open a response as a stream. The caller enforces the byte cap while reading. */
  async fetchStream(url: string, opts: FetchOptions): Promise<StreamResult> {
    const { res, finalUrl } = await this.open(url, opts);
    if (res.status >= 400) {
      await res.body?.cancel().catch(() => undefined);
      throw new GrabError(statusToCode(res.status), `The site answered with status ${res.status}.`, res.status);
    }
    if (!res.body) throw new GrabError('HTTP_ERROR', 'The site sent an empty answer.');
    const cl = Number(res.headers.get('content-length'));
    const body = res.body as unknown as ReadableStream<Uint8Array>;
    return {
      finalUrl,
      status: res.status,
      headers: res.headers as unknown as Headers,
      body,
      contentLength: Number.isFinite(cl) && cl > 0 ? cl : null,
      cancel: () => void body.cancel().catch(() => undefined),
    };
  }

  async close() {
    await this.agent.close();
  }
}
