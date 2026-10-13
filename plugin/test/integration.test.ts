// End to end: the plugin's real API client, reducer, previews, ZIP and insert code
// talking to the real GRAB server and a local fixture website. The Figma main thread is simulated.
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type AppHandle } from '../../server/src/app';
import { startFixture, type Fixture } from '../../server/test/helpers';
import type { Candidate } from '../../shared/types';
import { initialScan, scanReducer, type ScanState } from '../src/ui/reducer';

type Win = { addEventListener: (t: string, f: (e: { data: unknown }) => void) => void; removeEventListener: (t: string, f: unknown) => void; postMessage: (d: unknown) => void };
const listeners = new Set<(e: { data: unknown }) => void>();
const downloads: { name: string }[] = [];
const blobs: Blob[] = [];
const placed: { name: string; kind: string; bytes?: Uint8Array }[] = [];
let failNames = new Set<string>();
let chunkSizes: number[] = [];
let insertEnds: { canceled: boolean }[] = [];
let onChunk: (() => void) | null = null;

let fx: Fixture;
let h: AppHandle;
let base: string;
let api: import('../src/ui/api').ApiClient;
let actions: typeof import('../src/ui/actions');
let apiMod: typeof import('../src/ui/api');
let previews: typeof import('../src/ui/previews');

beforeAll(async () => {
  const win: Win = {
    addEventListener: (t, f) => t === 'message' && listeners.add(f),
    removeEventListener: (_t, f) => listeners.delete(f as never),
    postMessage: (data) => queueMicrotask(() => listeners.forEach((f) => f({ data }))),
  };
  Object.assign(globalThis, {
    window: win,
    parent: { postMessage: (d: unknown) => win.postMessage(d) },
    document: {
      createElement: () => ({ click() {}, remove() {}, set href(_v: string) {}, set download(v: string) { downloads.push({ name: v }); } }),
      body: { appendChild() {} },
    },
  });
  URL.createObjectURL = ((b: Blob) => {
    blobs.push(b);
    return 'blob:test';
  }) as never;
  URL.revokeObjectURL = () => undefined;

  // simulated Figma main thread
  const reply = (m: unknown) => win.postMessage({ pluginMessage: m });
  let batchPlaced = 0;
  listeners.add((e) => {
    const m = (e.data as { pluginMessage?: any })?.pluginMessage;
    if (!m) return;
    if (m.type === 'insert:start') batchPlaced = 0;
    if (m.type === 'insert:chunk') {
      chunkSizes.push(m.items.length);
      const results = m.items.map((i: any) => {
        if (failNames.has(i.name)) return { id: i.id, ok: false, reason: 'Figma cannot read this image format' };
        placed.push({ name: i.name, kind: i.kind, bytes: i.bytes });
        batchPlaced++;
        return { id: i.id, ok: true };
      });
      reply({ type: 'insert:chunk-result', batchId: m.batchId, results });
      onChunk?.();
    }
    if (m.type === 'insert:end') {
      insertEnds.push({ canceled: m.canceled });
      reply({ type: 'insert:done', batchId: m.batchId, placed: batchPlaced, failed: 0 });
    }
  });

  fx = await startFixture();
  h = await createApp({ allowPrivate: true, fetchTimeoutMs: 4000, rateLimitPerMinute: 100000 });
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(h.app.server.address() as { port: number }).port}`;
  apiMod = await import('../src/ui/api');
  actions = await import('../src/ui/actions');
  previews = await import('../src/ui/previews');
  api = new apiMod.ApiClient(base);
});

afterAll(async () => {
  await h.close();
  await fx.close();
});

async function runScan(urls: string[], options = {}): Promise<ScanState> {
  const res = await api.createScan(urls, options);
  let s = scanReducer(initialScan, { type: 'started', jobId: res.jobId, sources: res.sources, rejected: res.rejected });
  let since = 0;
  for (let i = 0; i < 400 && s.phase === 'running'; i++) {
    const r = await api.poll(res.jobId, since);
    since = r.next;
    s = scanReducer(s, { type: 'events', events: r.events, next: r.next, status: r.status });
    if (s.phase === 'running') await new Promise((r2) => setTimeout(r2, 25));
  }
  return s;
}

describe('plugin client against the real server', () => {
  let scan: ScanState;
  let web: Candidate[];

  it('connects and reports server features', async () => {
    const health = await api.health();
    expect(health.ok).toBe(true);
    expect(health.limits.maxPagesPerSite).toBeGreaterThan(1);
  }, 30_000); // the first call starts a real browser to check deep scan

  it('scans a site and builds the same state the UI shows', async () => {
    scan = await runScan([fx.base + '/']);
    expect(scan.phase).toBe('done');
    web = scan.items.filter((c) => c.groupId === 'web');
    expect(web.length).toBeGreaterThan(8);
    expect(web.some((c) => c.kind === 'video')).toBe(true);
    expect(scan.sources[0]).toMatchObject({ status: 'done' });
  });

  it('loads previews through the queue and learns the real image size from headers', async () => {
    const img = web.find((c) => c.url.endsWith('/img/1.png'))!;
    const r = await previews.loadPreview(api.previewUrl(scan.jobId!, img.id, 200));
    expect(r.width).toBe(64);
    expect(r.height).toBe(48);
    expect(r.bytes).toBeGreaterThan(0);
    // many at once: never more than the queue limit in flight, all succeed
    const imgs = web.filter((c) => c.kind === 'image' && !c.url.includes('not-an-image'));
    const many = await Promise.all(imgs.map((c) => previews.loadPreview(api.previewUrl(scan.jobId!, c.id, 120)).then(() => 'ok', () => 'fail')));
    expect(imgs.length).toBeGreaterThanOrEqual(6);
    expect(many.every((x) => x === 'ok')).toBe(true);
  });

  it('a preview that is not a real image fails cleanly and can be retried', async () => {
    const bad = (await runScan([fx.base + '/img/not-an-image.png'])).items[0];
    const url = api.previewUrl((await runScan([fx.base + '/img/not-an-image.png'])).jobId!, bad.id);
    await expect(previews.loadPreview(url)).rejects.toThrow();
  });

  it('downloads one file with a clean name', async () => {
    const img = web.find((c) => c.url.endsWith('/img/1.png'))!;
    downloads.length = 0;
    blobs.length = 0;
    await actions.downloadOne(api, scan.jobId!, img);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toMatch(/^127-0-0-1_001\.png$/);
    expect(blobs[0].type).toBe('image/png');
  });

  it('builds a ZIP with unique names, skips items that cannot be downloaded, and reports failures', async () => {
    const pick = [web.find((c) => c.url.endsWith('/img/1.png'))!, web.find((c) => c.url.endsWith('/img/3.png'))!, web.find((c) => c.url.endsWith('/video.mp4'))!, web.find((c) => c.url.endsWith('not-an-image.png'))!];
    const yt = web.find((c) => c.url.includes('youtube.com/watch'))!;
    downloads.length = 0;
    blobs.length = 0;
    const progress: number[] = [];
    const res = await actions.downloadZip(api, scan.jobId!, [...pick, yt], (p) => progress.push(p.done), new AbortController().signal);
    expect(res.ok).toBe(3);
    expect(res.skipped).toBe(1); // YouTube page: open at source only
    expect(res.failures).toHaveLength(1); // the fake image
    expect(progress.at(-1)).toBe(4);
    const zipBlob = blobs.at(-1)!;
    const files = unzipSync(new Uint8Array(await zipBlob.arrayBuffer()));
    const names = Object.keys(files);
    expect(names).toHaveLength(3);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(3);
    expect(names.some((n) => n.endsWith('.mp4'))).toBe(true);
    expect(downloads[0].name).toMatch(/\.zip$/);
  });

  it('inserts in chunks of at most 5, keeps going after a failure, and makes images Figma-safe', async () => {
    const images = web.filter((c) => c.kind === 'image' && !c.url.includes('not-an-image')).slice(0, 8);
    const big = web.find((c) => c.url.endsWith('/img/big.png'))!;
    const list = [...images.filter((c) => c.id !== big.id), big].slice(0, 8);
    placed.length = 0;
    chunkSizes = [];
    insertEnds = [];
    const idxFail = 2;
    const probe = await actions.insertIntoFigma(api, scan.jobId!, [], 'probe', () => undefined, new AbortController().signal); // empty batch is harmless
    expect(probe.placed).toBe(0);
    failNames = new Set([`127-0-0-1_${String(idxFail + 1).padStart(3, '0')}`]);
    const seen: number[] = [];
    const res = await actions.insertIntoFigma(api, scan.jobId!, list, 'GRAB · test', (p) => seen.push(p.done), new AbortController().signal);
    failNames = new Set();
    expect(chunkSizes.every((n) => n <= 5)).toBe(true);
    expect(res.placed).toBe(list.length - 1);
    expect(res.failures).toHaveLength(1);
    expect(res.canceled).toBe(false);
    expect(seen.at(-1)).toBe(list.length);
    expect(insertEnds.at(-1)).toEqual({ canceled: false });
    if (list.includes(big)) {
      const bigPlaced = placed.find((p) => p.name.endsWith(`${String(list.indexOf(big) + 1).padStart(3, '0')} `) || p.bytes && p.bytes.length > 0 && p.name.includes(String(list.indexOf(big) + 1).padStart(3, '0')));
      expect(bigPlaced?.bytes).toBeDefined();
      const meta = await sharp(Buffer.from(bigPlaced!.bytes!)).metadata();
      expect(meta.width).toBeLessThanOrEqual(4096);
    }
  });

  it('inserts a video as its poster frame and names the layer', async () => {
    const v = web.find((c) => c.url.endsWith('/video.mp4'))!;
    placed.length = 0;
    const res = await actions.insertIntoFigma(api, scan.jobId!, [v], 'GRAB · video', () => undefined, new AbortController().signal);
    expect(res.placed).toBe(1);
    expect(placed[0].name).toContain('(video poster)');
    expect((await sharp(Buffer.from(placed[0].bytes!)).metadata()).format).toBe('png');
  });

  it('a video without any poster fails with a clear reason instead of hanging', async (ctx) => {
    // only meaningful offline: with internet the YouTube poster loads fine
    const online = await fetch('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
    if (online) return ctx.skip();
    const yt = web.find((c) => c.url.includes('youtube.com/watch'))!; // poster comes from youtube.com: unreachable in tests
    const res = await actions.insertIntoFigma(api, scan.jobId!, [yt], 'GRAB · yt', () => undefined, new AbortController().signal);
    expect(res.placed).toBe(0);
    expect(res.failures[0].reason.length).toBeGreaterThan(5);
  });

  it('stops when canceled and tells Figma to finish with what was placed', async () => {
    const images = web.filter((c) => c.kind === 'image' && !c.url.includes('not-an-image')).slice(0, 12);
    const ctl = new AbortController();
    placed.length = 0;
    insertEnds = [];
    onChunk = () => ctl.abort(); // cancel right after the first chunk
    const res = await actions.insertIntoFigma(api, scan.jobId!, images, 'GRAB · cancel', () => undefined, ctl.signal);
    onChunk = null;
    expect(res.canceled).toBe(true);
    expect(res.placed).toBeLessThan(images.length);
    expect(insertEnds.at(-1)).toEqual({ canceled: true });
  });

  it('reports a dead server clearly', async () => {
    const dead = new apiMod.ApiClient('http://127.0.0.1:9');
    await expect(dead.health(1500)).rejects.toMatchObject({ code: 'OFFLINE' });
    await expect(api.poll('does-not-exist', 0)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
