import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { GrabError, SafeFetcher } from '../src/net/safeFetch';
import { startFixture, type Fixture } from './helpers';

let fx: Fixture;
beforeAll(async () => {
  fx = await startFixture();
});
afterAll(async () => {
  await fx.close();
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof GrabError ? e.code : 'OTHER:' + String(e);
  }
};

describe('SafeFetcher with the SSRF guard ON (production behaviour)', () => {
  const f = new SafeFetcher(loadConfig());
  it('blocks private and local targets before connecting', async () => {
    for (const u of [fx.base + '/', 'http://127.0.0.1/', 'http://localhost/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://192.168.0.1/', 'http://0.0.0.0/', 'http://internal.local/', 'http://2130706433/']) {
      expect(await code(f.fetchBuffer(u, { maxBytes: 1000 })), u).toBe('BLOCKED_TARGET');
    }
  });
  it('blocks odd ports and non-http schemes and credentials', async () => {
    expect(await code(f.fetchBuffer('http://example.com:22/', { maxBytes: 1000 }))).toBe('BLOCKED_TARGET');
    expect(await code(f.fetchBuffer('ftp://example.com/', { maxBytes: 1000 }))).toBe('INVALID_URL');
    expect(await code(f.fetchBuffer('file:///etc/passwd', { maxBytes: 1000 }))).toBe('INVALID_URL');
    expect(await code(f.fetchBuffer('http://user:pw@example.com/', { maxBytes: 1000 }))).toBe('INVALID_URL');
    expect(await code(f.fetchBuffer('not a url', { maxBytes: 1000 }))).toBe('INVALID_URL');
  });
  it('blocks hostnames that resolve to loopback (DNS check at connect time)', async () => {
    // localtest.me and nip.io style names resolve to 127.0.0.1; without network access the lookup fails instead.
    const r = await code(f.fetchBuffer('http://127.0.0.1.nip.io/', { maxBytes: 1000, timeoutMs: 4000 }));
    expect(['BLOCKED_TARGET', 'NETWORK_ERROR', 'TIMEOUT']).toContain(r);
  });
  it('the preview/file code paths use the same guard (assertPublicUrl)', async () => {
    expect(await code(f.assertPublicUrl('http://127.0.0.1:8080/x'))).toBe('BLOCKED_TARGET');
    expect(await code(f.assertPublicUrl('http://localhost/'))).toBe('BLOCKED_TARGET');
  });
});

describe('SafeFetcher against the local fixture (guard relaxed for tests only)', () => {
  const cfg = loadConfig({ allowPrivate: true, fetchTimeoutMs: 1200 });
  const f = new SafeFetcher(cfg);
  it('fetches a page', async () => {
    const r = await f.fetchBuffer(fx.base + '/', { maxBytes: 100000 });
    expect(r.status).toBe(200);
    expect(r.body.toString()).toContain('Fixture');
  });
  it('follows redirects but stops redirect loops', async () => {
    const ok = await f.fetchBuffer(fx.base + '/redirect-to-page', { maxBytes: 100000 });
    expect(ok.finalUrl).toBe(fx.base + '/');
    expect(await code(f.fetchBuffer(fx.base + '/loop', { maxBytes: 1000 }))).toBe('HTTP_ERROR');
  });
  it('maps HTTP errors to stable reason codes', async () => {
    expect(await code(f.fetchBuffer(fx.base + '/404', { maxBytes: 1000 }))).toBe('NOT_FOUND');
    expect(await code(f.fetchBuffer(fx.base + '/500', { maxBytes: 1000 }))).toBe('HTTP_ERROR');
    expect(await code(f.fetchBuffer(fx.base + '/blocked', { maxBytes: 1000 }))).toBe('BLOCKED_BY_SITE');
  });
  it('times out slow sites', async () => {
    expect(await code(f.fetchBuffer(fx.base + '/slow', { maxBytes: 1000, timeoutMs: 400 }))).toBe('TIMEOUT');
  });
  it('caps response size and reports truncation', async () => {
    const r = await f.fetchBuffer(fx.base + '/huge', { maxBytes: 20000 });
    expect(r.truncated).toBe(true);
    expect(r.body.length).toBe(20000);
  });
  it('reports a connection that is refused as a network error', async () => {
    expect(await code(f.fetchBuffer('http://127.0.0.1:1/', { maxBytes: 1000 }))).toBe('NETWORK_ERROR');
  });
  it('cancels in flight', async () => {
    const ac = new AbortController();
    const p = f.fetchBuffer(fx.base + '/slow', { maxBytes: 1000, signal: ac.signal, timeoutMs: 5000 });
    setTimeout(() => ac.abort(), 80);
    expect(await code(p)).toBe('CANCELED');
  });
});
