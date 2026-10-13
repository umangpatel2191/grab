import { describe, expect, it } from 'vitest';
import type { Candidate } from '../../shared/types';
import { DEFAULT_FILTERS, applyFilters, categoryOf, mergeBrand, extLabel, fileExt, fileNameFor, formatBytes, formatDims, formatDuration, isSmall, pageLabel, reasonText, safeName } from '../src/ui/lib';
import { normalizeBackend } from '../src/ui/api';

let n = 0;
const cand = (p: Partial<Candidate> = {}): Candidate => ({
  id: `c${n++}`, kind: 'image', origin: 'img', groupId: 'web', sourceUrl: 'https://www.example.com/page', url: `https://example.com/img${n}.jpg`,
  posterUrl: null, posterFallback: null, width: null, height: null, dimsSource: 'unknown', mime: null, bytes: null, durationSec: null,
  title: null, downloadable: true, variants: [], warnings: [], ...p,
});

describe('filters', () => {
  const items = [
    cand({ url: 'https://a.com/hero.jpg', width: 1200, height: 800, title: 'Hero banner' }),
    cand({ url: 'https://a.com/icon.png', width: 32, height: 32 }),
    cand({ url: 'https://a.com/favicon.png', width: 180, height: 180, origin: 'favicon' }),
    cand({ url: 'https://a.com/unknown.jpg' }),
    cand({ url: 'https://a.com/logo.svg', mime: 'image/svg+xml', width: 300, height: 100 }),
    cand({ url: 'https://a.com/clip.mp4', kind: 'video', mime: 'video/mp4', sourceUrl: 'https://b.com/' }),
  ];
  const run = (patch: object, m = {}) => applyFilters(items, { ...DEFAULT_FILTERS, ...patch }, m).map((c) => c.url.split('/').pop());

  it('hides small icons by default but never hides unknown sizes or videos', () => {
    expect(run({})).toEqual(['hero.jpg', 'unknown.jpg', 'logo.svg', 'clip.mp4']);
    expect(run({ showSmall: true })).toHaveLength(6);
  });
  it('uses sizes measured after loading when the page did not say', () => {
    const unknown = items[3];
    expect(isSmall(unknown, { [unknown.id]: { w: 16, h: 16 } })).toBe(true);
    expect(run({}, { [unknown.id]: { w: 16, h: 16 } })).not.toContain('unknown.jpg');
  });
  it('filters by type, page and search text', () => {
    expect(run({ type: 'video', showSmall: true })).toEqual(['clip.mp4']);
    expect(run({ type: 'svg', showSmall: true })).toEqual(['logo.svg']);
    expect(run({ type: 'image', showSmall: true })).not.toContain('clip.mp4');
    expect(run({ source: 'https://b.com/', showSmall: true })).toEqual(['clip.mp4']);
    expect(run({ query: 'BANNER', showSmall: true })).toEqual(['hero.jpg']);
    expect(run({ query: 'zzz', showSmall: true })).toEqual([]);
  });
  it('sorts biggest first with unknown sizes last', () => {
    expect(run({ sort: 'size', showSmall: true })[0]).toBe('hero.jpg');
    expect(run({ sort: 'size', showSmall: true }).slice(-2)).toContain('unknown.jpg');
  });
});

describe('labels and names', () => {
  it('formats sizes, durations and dimensions', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1048576)).toBe('5.0 MB');
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(null)).toBe('');
    expect(formatDims(cand({ width: 10, height: 20 }))).toBe('10×20');
    expect(formatDims(cand())).toBe('?×?');
    expect(formatDims(cand(), {})).toBe('?×?');
  });
  it('labels types from mime or extension', () => {
    expect(extLabel(cand({ mime: 'image/jpeg' }))).toBe('JPG');
    expect(extLabel(cand({ mime: 'image/svg+xml' }))).toBe('SVG');
    expect(extLabel(cand({ mime: 'video/quicktime', kind: 'video' }))).toBe('MOV');
    expect(extLabel(cand({ url: 'https://x.com/a.webp?x=1' }))).toBe('WEBP');
    expect(extLabel(cand({ url: 'https://x.com/noext', kind: 'video' }))).toBe('VID');
  });
  it('makes safe, unique file names', () => {
    const used = new Set<string>();
    expect(safeName('a/b:c*d.png', used)).toBe('a_b_c_d.png');
    expect(safeName('a_b_c_d.png', used)).toBe('a_b_c_d_2.png');
    expect(safeName('A_B_C_D.PNG', used)).toBe('A_B_C_D_3.PNG');
    expect(safeName('...hidden', new Set())).toBe('hidden');
    expect(safeName('', new Set())).toBe('file');
    expect(safeName('x'.repeat(200) + '.png', new Set()).length).toBeLessThanOrEqual(80);
  });
  it('names downloads by site and number with the real extension', () => {
    const used = new Set<string>();
    const c = cand({ mime: 'image/webp' });
    expect(fileNameFor(c, 0, used)).toBe('example-com_001.webp');
    expect(fileNameFor(c, 0, used)).toBe('example-com_001_2.webp');
    expect(fileExt(cand({ kind: 'video', url: 'https://x.com/watch' }))).toBe('mp4');
    expect(fileExt(cand({ url: 'https://x.com/a.jpeg' }))).toBe('jpg');
    expect(fileNameFor(cand({ sourceUrl: 'not a url' }), 4, new Set(), 'image/png')).toBe('source_005.png');
  });
  it('shortens page labels', () => {
    expect(pageLabel('https://www.example.com/')).toBe('example.com');
    expect(pageLabel('https://example.com/a/b/')).toBe('example.com/a/b');
    expect(pageLabel('garbage')).toBe('garbage');
  });
  it('explains every reason code in plain words', () => {
    for (const code of ['INVALID_URL', 'BLOCKED_TARGET', 'ROBOTS_DISALLOWED', 'TIMEOUT', 'LOGIN_REQUIRED', 'BLOCKED_BY_SITE', 'NOT_HTML', 'NOT_MEDIA', 'NOT_DIRECT_MEDIA', 'DEEP_UNAVAILABLE', 'UNSUPPORTED_SOURCE']) {
      expect(reasonText(code).length).toBeGreaterThan(10);
    }
    expect(reasonText('SOMETHING_NEW', 'custom')).toBe('custom');
    expect(reasonText('SOMETHING_NEW')).toBe('Something went wrong.');
  });
});

describe('server address', () => {
  it('accepts and cleans addresses, rejects junk', () => {
    expect(normalizeBackend('http://localhost:8787/')).toBe('http://localhost:8787');
    expect(normalizeBackend('my-api.onrender.com')).toBe('https://my-api.onrender.com');
    expect(normalizeBackend('  https://x.com//  ')).toBe('https://x.com');
    expect(normalizeBackend('ftp://x.com')).toBeNull();
    expect(normalizeBackend('javascript://x')).toBeNull();
    expect(normalizeBackend('localhost:8787')).toBe('http://localhost:8787');
    expect(normalizeBackend('')).toBeNull();
  });
});

describe('categories for website sections', () => {
  const c = (p: Partial<Candidate>) => cand(p);
  it('puts videos, gifs, icons/logos and plain images in the right section', () => {
    expect(categoryOf(c({ kind: 'video', url: 'https://a.com/v.mp4' }))).toBe('video');
    expect(categoryOf(c({ url: 'https://a.com/loop.gif', width: 1200, height: 800 }))).toBe('gif');
    expect(categoryOf(c({ url: 'https://a.com/x', mime: 'image/gif' }))).toBe('gif');
    expect(categoryOf(c({ origin: 'favicon', url: 'https://a.com/f.png' }))).toBe('icon');
    expect(categoryOf(c({ url: 'https://a.com/img/tiny.png', width: 64, height: 64 }))).toBe('icon');
    expect(categoryOf(c({ url: 'https://a.com/assets/Logo-dark.svg', mime: 'image/svg+xml' }))).toBe('icon');
    expect(categoryOf(c({ url: 'https://a.com/a.png', title: 'Company logo' }))).toBe('icon');
    expect(categoryOf(c({ url: 'https://a.com/hero.jpg', width: 1600, height: 900 }))).toBe('image');
    expect(categoryOf(c({ url: 'https://a.com/unknown.jpg' }))).toBe('image');
    expect(categoryOf(c({ url: 'https://a.com/social.jpg', origin: 'og-image', width: 200, height: 200 }))).toBe('image');
    expect(categoryOf(c({ url: 'https://a.com/blogger-icons-big.jpg', width: 1200, height: 800 }))).toBe('icon');
    expect(categoryOf(c({ url: 'https://a.com/pixelogic/photo.jpg', width: 1200, height: 800 }))).toBe('image');
  });
  it('uses measured sizes when the page did not say', () => {
    const x = c({ url: 'https://a.com/q.png' });
    expect(categoryOf(x, { [x.id]: { w: 48, h: 48 } })).toBe('icon');
  });
  it('filters by gif and icon', () => {
    const items = [c({ url: 'https://a.com/a.gif' }), c({ url: 'https://a.com/b.jpg', width: 900, height: 900 }), c({ url: 'https://a.com/c.png', width: 32, height: 32 })];
    const run = (type: 'gif' | 'icon') => applyFilters(items, { ...DEFAULT_FILTERS, type, showSmall: true }, {}).map((i) => i.url.split('/').pop());
    expect(run('gif')).toEqual(['a.gif']);
    expect(run('icon')).toEqual(['c.png']);
  });
  it('merges brand colors from several pages, strongest first, no repeats', () => {
    const m = mergeBrand({
      s0: [{ hex: '#111111', role: 'palette', source: 'x', weight: 5 }, { hex: '#FF6600', role: 'theme', source: 't', weight: 1000 }],
      s1: [{ hex: '#FF6600', role: 'brand', source: 'v', weight: 800 }, { hex: '#0A7CFF', role: 'logo', source: 'l', weight: 700 }],
    });
    expect(m.map((x) => x.hex)).toEqual(['#FF6600', '#0A7CFF', '#111111']);
    expect(mergeBrand({}, 3)).toEqual([]);
  });
  it('treats inline svgs as icons unless drawn large', () => {
    expect(categoryOf(cand({ origin: 'inline-svg', url: 'data:image/svg+xml,x', width: 24, height: 24 }))).toBe('icon');
    expect(categoryOf(cand({ origin: 'inline-svg', url: 'data:image/svg+xml,x', width: 1200, height: 600 }))).toBe('image');
  });
});
