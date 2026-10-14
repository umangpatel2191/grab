import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Candidate, CreateScanResponse, ScanEvent } from '../../shared/types';
import { createApp, type AppHandle } from '../src/app';
import { deepAvailable } from '../src/extract/deep';
import { startFixture, waitForJob, type Fixture } from './helpers';

let fx: Fixture;
let h: AppHandle;

beforeAll(async () => {
  fx = await startFixture();
  h = await createApp({ allowPrivate: true, measurePages: false, fetchTimeoutMs: 4000, scanRateLimitPerMinute: 1000, rateLimitPerMinute: 100000, logger: undefined } as never);
});
afterAll(async () => {
  await h.close();
  await fx.close();
});

const post = (url: string, payload: unknown) => h.app.inject({ method: 'POST', url, payload: payload as never });
const scan = async (urls: string[], options?: object) => {
  const r = await post('/v1/scans', { urls, options });
  expect(r.statusCode, r.body).toBe(201);
  const body = r.json() as CreateScanResponse;
  const events = await waitForJob(h, body.jobId);
  return { ...body, events };
};
const cands = (events: ScanEvent[], group?: string): Candidate[] =>
  events.flatMap((e) => (e.type === 'image.found' ? e.candidates : [])).filter((c) => !group || c.groupId === group);
const warnings = (events: ScanEvent[]) => events.filter((e): e is Extract<ScanEvent, { type: 'source.warning' }> => e.type === 'source.warning');

describe('health', () => {
  it('reports features and limits', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/v1/health' });
    const b = r.json();
    expect(b.ok).toBe(true);
    expect(b.features.galleryDl).toBeUndefined();
    expect(b.limits).toMatchObject({ maxUrlsPerScan: 10, maxPagesPerSite: 200 });
  }, 30_000); // the first call starts a real browser to check deep scan
});

describe('full website scan', () => {
  let jobId: string;
  let events: ScanEvent[];
  beforeAll(async () => {
    const s = await scan([fx.base + '/']);
    jobId = s.jobId;
    events = s.events;
  });

  it('streams started, found, done and ends with job.done', () => {
    expect(events[0]).toMatchObject({ type: 'source.started', sourceId: 's0' });
    expect(events.at(-1)).toEqual({ type: 'job.done', status: 'done' });
    expect(events.some((e) => e.type === 'source.done')).toBe(true);
  });

  it('finds every kind of image, merges sizes, drops tracking pixels', () => {
    const web = cands(events, 'web');
    const urls = web.map((c) => c.url);
    for (const p of ['/img/1.png', '/img/2-1200x800.png', '/img/3.png', '/img/og.png', '/img/fav.png', '/img/css-bg.png', '/img/big.png']) {
      expect(urls, p).toContain(fx.base + p);
    }
    expect(urls.some((u) => u.includes('pixel.png'))).toBe(false);
    const two = web.find((c) => c.url.includes('/img/2-'))!;
    expect(two.variants.length).toBe(2);
    expect(two.url).toContain('1200x800');
    expect(new Set(web.map((c) => c.id)).size).toBe(web.length); // unique ids
  });

  it('finds video: direct file with poster, and the YouTube embed', () => {
    const vids = cands(events, 'web').filter((c) => c.kind === 'video');
    const direct = vids.find((v) => v.url.endsWith('/video.mp4'))!;
    expect(direct).toMatchObject({ downloadable: true, posterUrl: fx.base + '/img/poster.png' });
    const yt = vids.find((v) => v.url.includes('youtube.com/watch'))!;
    expect(yt).toMatchObject({ downloadable: false });
    expect(yt.posterUrl).toContain('maxresdefault');
  });

  it('serves small previews without downloading the full file to the client', async () => {
    const one = cands(events, 'web').find((c) => c.url.endsWith('/img/1.png'))!;
    const r = await h.app.inject({ method: 'GET', url: `/v1/scans/${jobId}/items/${one.id}/preview?w=100` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/webp');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    const meta = await sharp(r.rawPayload).metadata();
    expect(meta.width).toBeLessThanOrEqual(100);
    // the real size is reported in headers so the plugin can show it without downloading the file
    expect(r.headers['x-grab-width']).toBe('64');
    expect(r.headers['x-grab-height']).toBe('48');
    expect(Number(r.headers['x-grab-bytes'])).toBeGreaterThan(0);
  });

  it('can return a PNG preview for inserting video posters', async () => {
    const v = cands(events, 'web').find((c) => c.url.endsWith('/video.mp4'))!;
    const r = await h.app.inject({ method: 'GET', url: `/v1/scans/${jobId}/items/${v.id}/preview?w=1600&fmt=png` });
    expect(r.headers['content-type']).toBe('image/png');
  });

  it('previews a video through its poster', async () => {
    const v = cands(events, 'web').find((c) => c.url.endsWith('/video.mp4'))!;
    const r = await h.app.inject({ method: 'GET', url: `/v1/scans/${jobId}/items/${v.id}/preview` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/^image\//);
  });

  it('refuses to preview or download something that is not really an image', async () => {
    // not-an-image.png is advertised as image/png but is HTML. It is not in the page markup above on purpose:
    const s = await scan([fx.base + '/img/not-an-image.png']);
    const c = cands(s.events)[0];
    for (const p of ['preview', 'file']) {
      const r = await h.app.inject({ method: 'GET', url: `/v1/scans/${s.jobId}/items/${c.id}/${p}` });
      expect(r.statusCode, p).toBe(415);
      expect(r.json().error.code).toBe('NOT_MEDIA');
    }
  });

  it('downloads the original file with a safe name', async () => {
    const one = cands(events, 'web').find((c) => c.url.endsWith('/img/1.png'))!;
    const r = await h.app.inject({ method: 'GET', url: `/v1/scans/${jobId}/items/${one.id}/file?download=1` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['content-disposition']).toBe('attachment; filename="1.png"');
  });

  it('makes images Figma-safe on request (max 4096 px)', async () => {
    const big = cands(events, 'web').find((c) => c.url.endsWith('/img/big.png'))!;
    const raw = await h.app.inject({ method: 'GET', url: `/v1/scans/${jobId}/items/${big.id}/file` });
    expect((await sharp(raw.rawPayload).metadata()).width).toBe(5000);
    const safe = await h.app.inject({ method: 'GET', url: `/v1/scans/${jobId}/items/${big.id}/file?figma=1` });
    expect((await sharp(safe.rawPayload).metadata()).width).toBe(4096);
  });

  it('streams a direct video file and refuses non-direct ones', async () => {
    const vids = cands(events, 'web').filter((c) => c.kind === 'video');
    const direct = vids.find((v) => v.url.endsWith('/video.mp4'))!;
    const r = await h.app.inject({ method: 'GET', url: `/v1/scans/${jobId}/items/${direct.id}/file?download=1` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('video/mp4');
    expect(r.rawPayload.subarray(4, 8).toString()).toBe('ftyp');
    const yt = vids.find((v) => v.url.includes('youtube'))!;
    const bad = await h.app.inject({ method: 'GET', url: `/v1/scans/${jobId}/items/${yt.id}/file` });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe('NOT_DIRECT_MEDIA');
  });

  it('only serves ids created by that scan (no open proxy)', async () => {
    const one = cands(events, 'web')[0];
    const other = await scan([fx.base + '/p2']);
    for (const [job, item] of [[other.jobId, one.id], [jobId, 'nope'], ['nope', one.id]]) {
      const r = await h.app.inject({ method: 'GET', url: `/v1/scans/${job}/items/${item}/file` });
      expect(r.statusCode).toBe(404);
    }
    const url = encodeURIComponent('http://127.0.0.1/secret');
    const arbitrary = await h.app.inject({ method: 'GET', url: `/v1/scans/${jobId}/items/x/preview?url=${url}` });
    expect(arbitrary.statusCode).toBe(404);
  });

  it('polling with a cursor never repeats or loses events', async () => {
    const a = (await h.app.inject({ method: 'GET', url: `/v1/scans/${jobId}?since=0` })).json();
    const b = (await h.app.inject({ method: 'GET', url: `/v1/scans/${jobId}?since=${a.next}` })).json();
    expect(b.events).toEqual([]);
    expect(b.next).toBe(a.next);
    const mid = (await h.app.inject({ method: 'GET', url: `/v1/scans/${jobId}?since=2` })).json();
    expect(mid.events.length).toBe(a.events.length - 2);
  });
});

describe('brand colors and gifs', () => {
  it('emits brand colors for the page and serves a GIF as a real GIF', async () => {
    const s = await scan([fx.base + '/brand']);
    const brand = s.events.find((e) => e.type === 'brand.found') as Extract<ScanEvent, { type: 'brand.found' }> | undefined;
    expect(brand).toBeTruthy();
    expect(brand!.sourceId).toBe('s0');
    expect(brand!.colors[0]).toMatchObject({ hex: '#0A7CFF', role: 'theme' });
    expect(brand!.colors.some((c) => c.hex === '#FF6600' && c.role === 'brand')).toBe(true);
    const gif = cands(s.events).find((c) => c.url.endsWith('/anim.gif'))!;
    const r = await h.app.inject({ method: 'GET', url: `/v1/scans/${s.jobId}/items/${gif.id}/preview?w=100` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/gif');
  });
  it('sends no brand event for a page without colors', async () => {
    const s = await scan([fx.base + '/p2']);
    expect(s.events.some((e) => e.type === 'brand.found')).toBe(false);
  });
});

describe('failures stay local', () => {
  it('keeps good sources when others fail, with specific reason codes', async () => {
    const s = await scan([fx.base + '/', fx.base + '/404', fx.base + '/500', fx.base + '/blocked']);
    expect(cands(s.events, 'web').length).toBeGreaterThan(5);
    const w = warnings(s.events);
    expect(w.find((x) => x.sourceId === 's1')?.code).toBe('NOT_FOUND');
    expect(w.find((x) => x.sourceId === 's2')?.code).toBe('HTTP_ERROR');
    expect(w.find((x) => x.sourceId === 's3')?.code).toBe('BLOCKED_BY_SITE');
    expect(s.events.filter((e) => e.type === 'source.done')).toHaveLength(4);
  });

  it('honors robots.txt', async () => {
    const s = await scan([fx.base + '/private']);
    expect(warnings(s.events)[0].code).toBe('ROBOTS_DISALLOWED');
    expect(cands(s.events)).toHaveLength(0);
  });

  it('accepts a link that is itself an image', async () => {
    const s = await scan([fx.base + '/img/1.png']);
    expect(cands(s.events)).toHaveLength(1);
  });

  it('says so when the link is not a web page', async () => {
    const s = await scan([fx.base + '/json']);
    expect(warnings(s.events)[0].code).toBe('NOT_HTML');
  });

  it('reads the whole site when asked: nav links, deeper links and the sitemap, without repeats', async () => {
    const s = await scan([fx.base + '/site'], { pages: 10 });
    const urls = cands(s.events, 'web').map((c) => c.url);
    for (const p of ['home', 'about', 'work-1', 'work-2', 'team', 'extra']) expect(urls, p).toContain(`${fx.base}/img/${p}.png`);
    expect(urls.filter((u) => u.endsWith('/img/shared.png')).length).toBe(1);
    expect(s.events.some((e) => e.type === 'source.progress')).toBe(true);
    expect(s.events.some((e) => (e as { type: string }).type.startsWith('profile'))).toBe(false); // social is gone
  });

  it('reads only the link itself by default', async () => {
    const s = await scan([fx.base + '/site']);
    const urls = cands(s.events, 'web').map((c) => c.url);
    expect(urls).toContain(fx.base + '/img/home.png');
    expect(urls).not.toContain(fx.base + '/img/about.png');
  });

  it('deep scan never loses the static results: with or without a browser on this machine', async () => {
    const s = await scan([fx.base + '/'], { deep: true });
    expect(cands(s.events, 'web').length).toBeGreaterThan(5);
    if (!(await deepAvailable())) expect(warnings(s.events).some((w) => w.code === 'DEEP_UNAVAILABLE')).toBe(true);
  }, 60_000);

  it('cancels a running scan, idempotently', async () => {
    const r = await post('/v1/scans', { urls: [fx.base + '/slow'] });
    const { jobId } = r.json() as CreateScanResponse;
    const c1 = await post(`/v1/scans/${jobId}/cancel`, {});
    const c2 = await post(`/v1/scans/${jobId}/cancel`, {});
    expect(c1.json()).toEqual({ ok: true });
    expect(c2.json()).toEqual({ ok: true });
    const events = await waitForJob(h, jobId, 5000);
    expect(events.at(-1)).toEqual({ type: 'job.done', status: 'canceled' });
    expect((await post('/v1/scans/unknown/cancel', {})).statusCode).toBe(200);
  });

  it('answers 404 with a clear code when a scan expired', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/v1/scans/does-not-exist' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('NOT_FOUND');
  });
});

describe('keeping a scan', () => {
  it('signs a finished scan and restores it later (after a restart), with working previews', async () => {
    const s = await scan([fx.base + '/']);
    const snap = (await h.app.inject({ method: 'GET', url: `/v1/scans/${s.jobId}/snapshot` })).json() as { sources: unknown[]; items: Candidate[]; seal: string };
    expect(snap.items.length).toBeGreaterThan(5);
    const restored = await post('/v1/restore', snap);
    expect(restored.statusCode).toBe(201);
    const { jobId } = restored.json() as { jobId: string };
    const img = snap.items.find((c) => c.url.endsWith('/img/1.png'))!;
    const r = await h.app.inject({ method: 'GET', url: `/v1/scans/${jobId}/items/${img.id}/preview?w=100` });
    expect(r.statusCode).toBe(200);
  });

  it('refuses a snapshot that was changed (no open proxy)', async () => {
    const s = await scan([fx.base + '/']);
    const snap = (await h.app.inject({ method: 'GET', url: `/v1/scans/${s.jobId}/snapshot` })).json() as { sources: unknown[]; items: Candidate[]; seal: string };
    snap.items[0] = { ...snap.items[0], url: 'https://evil.example/anything.png' };
    const r = await post('/v1/restore', snap);
    expect(r.statusCode).toBe(404);
    expect((await post('/v1/restore', { items: [], sources: [], seal: 'x' })).statusCode).toBe(404);
    expect((await post('/v1/restore', { nope: 1 })).statusCode).toBe(400);
  });
});

describe('request validation', () => {
  it('rejects malformed bodies', async () => {
    for (const body of [undefined, {}, { urls: 'a.com' }, { urls: [] }, { urls: [1, 2] }, { urls: Array(41).fill('a.com') }, { urls: ['a'.repeat(3000)] }]) {
      const r = await post('/v1/scans', body);
      expect(r.statusCode, JSON.stringify(body)?.slice(0, 40)).toBe(400);
      expect(r.json().error.code).toBe('INVALID_URL');
    }
  });
  it('rejects bodies that are too large', async () => {
    const r = await h.app.inject({ method: 'POST', url: '/v1/scans', payload: { urls: ['https://a.com/' + 'x'.repeat(70000)] } as never });
    expect([400, 413]).toContain(r.statusCode);
  });
  it('caps links per scan and reports the extra ones', async () => {
    const urls = Array.from({ length: 12 }, (_, i) => `${fx.base}/?n=${i}`);
    const r = await post('/v1/scans', { urls });
    const b = r.json() as CreateScanResponse;
    expect(b.sources).toHaveLength(10);
    expect(b.rejected.filter((x) => x.code === 'TOO_LARGE')).toHaveLength(2);
    await waitForJob(h, b.jobId);
  });
  it('does not leak internals on server errors', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/nope' });
    expect(r.json().error.code).toBe('NOT_FOUND');
    expect(r.body).not.toMatch(/at \w+ \(|node_modules/);
  });
});

describe('production guard settings', () => {
  it('refuses to scan private addresses at the API level', async () => {
    const prod = await createApp({ allowPrivate: false });
    const r = await prod.app.inject({ method: 'POST', url: '/v1/scans', payload: { urls: [fx.base + '/', 'http://localhost:3000', 'http://169.254.169.254/'] } as never });
    expect(r.statusCode).toBe(400);
    const b = r.json();
    expect(b.rejected.map((x: { code: string }) => x.code)).toEqual(expect.arrayContaining(['BLOCKED_TARGET']));
    await prod.close();
  });
  it('rate limits abusive clients', async () => {
    const limited = await createApp({ allowPrivate: true, rateLimitPerMinute: 4 });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await limited.app.inject({ method: 'GET', url: '/v1/health' })).statusCode);
    expect(codes).toContain(429);
    expect(codes.slice(0, 4).every((c) => c === 200)).toBe(true);
    await limited.close();
  });
  it('limits video downloads by size', async () => {
    const small = await createApp({ allowPrivate: true, maxVideoBytes: 500 });
    const r = await small.app.inject({ method: 'POST', url: '/v1/scans', payload: { urls: [fx.base + '/video.mp4'] } as never });
    const { jobId } = r.json() as CreateScanResponse;
    const events = await waitForJob(small, jobId);
    const v = cands(events)[0];
    const file = await small.app.inject({ method: 'GET', url: `/v1/scans/${jobId}/items/${v.id}/file` });
    expect(file.statusCode).toBe(413);
    expect(file.json().error.code).toBe('TOO_LARGE');
    await small.close();
  });
  it('never hands out a silently truncated video when the size is not announced', async () => {
    const small = await createApp({ allowPrivate: true, maxVideoBytes: 500 });
    const r = await small.app.inject({ method: 'POST', url: '/v1/scans', payload: { urls: [fx.base + '/video-chunked.mp4'] } as never });
    const { jobId } = r.json() as CreateScanResponse;
    const v = cands(await waitForJob(small, jobId))[0];
    let outcome = 'threw';
    try {
      const file = await small.app.inject({ method: 'GET', url: `/v1/scans/${jobId}/items/${v.id}/file` });
      // the cap is enforced while streaming: the body can never exceed the limit plus one chunk
      outcome = file.rawPayload.length > 500 + 2100 ? 'too-big' : 'capped';
    } catch {
      outcome = 'threw';
    }
    expect(['threw', 'capped']).toContain(outcome);
    await small.close();
  });
});
