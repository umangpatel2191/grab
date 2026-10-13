import { describe, expect, it } from 'vitest';
import { extractCssImageUrls, extractFromHtml, parseSrcset } from '../src/extract/html';

let n = 0;
const opts = { maxCandidates: 500, newId: () => `id${n++}` };
const page = 'https://example.com/blog/post';
const run = (html: string, extra: string[] = []) => extractFromHtml(html, page, opts, extra);
const urls = (html: string) => run(html).candidates.map((c) => c.url);

describe('srcset parsing', () => {
  it('handles widths, densities and urls with commas', () => {
    expect(parseSrcset('a.jpg 480w, b.jpg 800w')).toEqual([
      { url: 'a.jpg', w: 480, x: null },
      { url: 'b.jpg', w: 800, x: null },
    ]);
    expect(parseSrcset('a.jpg 1x,b.jpg 2x')).toHaveLength(2);
    expect(parseSrcset('https://cdn.x/w=100,h=100/a.jpg 2x')[0].url).toBe('https://cdn.x/w=100,h=100/a.jpg');
    expect(parseSrcset('a.jpg')).toEqual([{ url: 'a.jpg', w: null, x: null }]);
    expect(parseSrcset('')).toEqual([]);
  });
});

describe('image extraction', () => {
  it('finds img src, relative urls, lazy attributes and srcset', () => {
    const html = `<img src="/a.jpg" width="300" height="200" alt="Alpha">
      <img data-src="b.png"><img data-lazy-src="//cdn.example.com/c.webp">
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="1" height="1">
      <img srcset="s-480.jpg 480w, s-1200.jpg 1200w">`;
    const r = run(html);
    const u = r.candidates.map((c) => c.url);
    expect(u).toContain('https://example.com/a.jpg');
    expect(u).toContain('https://example.com/blog/b.png');
    expect(u).toContain('https://cdn.example.com/c.webp');
    expect(u.some((x) => x.startsWith('data:'))).toBe(false); // 1x1 tracking pixel dropped
    const a = r.candidates.find((c) => c.url.endsWith('/a.jpg'))!;
    expect(a).toMatchObject({ width: 300, height: 200, title: 'Alpha', dimsSource: 'attr' });
    const s = r.candidates.filter((c) => c.url.includes('/s-'));
    expect(s.map((c) => c.width).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([480, 1200]);
  });

  it('merges the same picture at several sizes and keeps the biggest as the main one', () => {
    const html = `<img src="https://cdn.x.com/p/hero-300x200.jpg"><img srcset="https://cdn.x.com/p/hero-1200x800.jpg 1200w">`;
    const r = run(html);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].url).toContain('1200x800');
    expect(r.candidates[0].variants).toHaveLength(2);
  });

  it('reads picture/source, noscript, meta images, favicons and direct links', () => {
    const html = `<head><meta property="og:image" content="/og.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
      <meta name="twitter:image" content="/tw.jpg"><link rel="icon" href="/fav.png" sizes="32x32"><link rel="apple-touch-icon" href="/touch.png" sizes="180x180"></head>
      <picture><source srcset="/p.avif 800w" type="image/avif"><img src="/p.jpg"></picture>
      <noscript><img src="/lazy-fallback.jpg"></noscript>
      <a href="/full/photo.jpg"><img src="/thumb.jpg"></a><a href="/doc.pdf">pdf</a>`;
    const r = run(html);
    const u = r.candidates.map((c) => c.url);
    for (const x of ['/og.jpg', '/tw.jpg', '/fav.png', '/touch.png', '/p.avif', '/p.jpg', '/lazy-fallback.jpg', '/full/photo.jpg', '/thumb.jpg']) {
      expect(u).toContain('https://example.com' + x);
    }
    expect(u.some((x) => x.endsWith('.pdf'))).toBe(false);
    expect(r.candidates.find((c) => c.url.endsWith('/og.jpg'))).toMatchObject({ width: 1200, height: 630, origin: 'og-image' });
    expect(r.candidates.find((c) => c.url.endsWith('/fav.png'))?.origin).toBe('favicon');
  });

  it('collects css backgrounds from inline style, <style>, lazy attributes and stylesheets', () => {
    const html = `<div style="background-image:url('/bg1.jpg')"></div><div data-bg="/bg2.jpg"></div>
      <style>.a{background:url(bg3.png)} @font-face{src:url(/f.woff2)}</style>`;
    const u = urls(html);
    for (const x of ['https://example.com/bg1.jpg', 'https://example.com/bg2.jpg', 'https://example.com/blog/bg3.png']) expect(u).toContain(x);
    expect(u.some((x) => x.includes('woff2'))).toBe(false);
    expect(run('<p>x</p>', ['https://example.com/css-bg.jpg']).candidates[0].url).toBe('https://example.com/css-bg.jpg');
    expect(extractCssImageUrls('a{background:url(x.png)} b{src:url(f.woff)}', 'https://e.com/s/')).toEqual(['https://e.com/s/x.png']);
  });

  it('reads image urls from JSON-LD and Next.js data', () => {
    const html = `<script type="application/ld+json">{"image":["https:\\/\\/e.com\\/ld.jpg"]}</script>
      <script id="__NEXT_DATA__" type="application/json">{"props":{"img":"https://e.com/next.webp?w=1\\u0026h=2"}}</script>`;
    const u = urls(html);
    expect(u).toContain('https://e.com/ld.jpg');
    expect(u).toContain('https://e.com/next.webp?w=1&h=2');
  });

  it('respects <base href>', () => {
    expect(urls('<base href="https://static.example.org/assets/"><img src="x.png">')).toEqual(['https://static.example.org/assets/x.png']);
  });

  it('never returns javascript:, blob:, mailto: or oversized data uris', () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(200000);
    const html = `<img src="javascript:alert(1)"><img src="blob:https://e.com/x"><img src="${huge}"><img src="/ok.png">`;
    expect(urls(html)).toEqual(['https://example.com/ok.png']);
  });

  it('survives malformed and empty html', () => {
    expect(() => run('<<<<>>>><img src=')).not.toThrow();
    expect(run('').candidates).toEqual([]);
    expect(run('<div><img src="/a.jpg">').candidates).toHaveLength(1); // unclosed div
    expect(run('<img src="/a.jpg"').candidates).toHaveLength(0); // tag cut off at end of file: not a real tag
  });

  it('caps the number of candidates', () => {
    const html = Array.from({ length: 50 }, (_, i) => `<img src="/i${i}.jpg">`).join('');
    const r = extractFromHtml(html, page, { maxCandidates: 10, newId: opts.newId });
    expect(r.candidates).toHaveLength(10);
  });
});

describe('video extraction', () => {
  it('reads <video>, <source>, poster, og:video and picks mp4 first', () => {
    const html = `<video poster="/poster.jpg" width="640" height="360"><source src="/v.webm" type="video/webm"><source src="/v.mp4" type="video/mp4"></video>
      <meta property="og:video" content="https://cdn.e.com/clip.mp4">`;
    const r = run(html);
    const vids = r.candidates.filter((c) => c.kind === 'video');
    expect(vids).toHaveLength(2);
    const v = vids.find((c) => c.origin === 'video')!;
    expect(v).toMatchObject({ url: 'https://example.com/v.mp4', posterUrl: 'https://example.com/poster.jpg', downloadable: true, width: 640 });
    expect(v.variants.map((x) => x.url)).toContain('https://example.com/v.webm');
  });
  it('marks streaming playlists as not directly downloadable', () => {
    const r = run(`<video src="/live.m3u8" poster="/p.jpg"></video>`);
    expect(r.candidates[0]).toMatchObject({ kind: 'video', downloadable: false });
  });
  it('turns YouTube and Vimeo embeds into video items with HD posters', () => {
    const html = `<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0"></iframe><iframe data-src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>
      <iframe src="https://player.vimeo.com/video/12345"></iframe><lite-youtube videoid="aaaaaaaaaaa"></lite-youtube>`;
    const vids = run(html).candidates.filter((c) => c.kind === 'video');
    expect(vids).toHaveLength(3); // duplicate youtube embed merged
    const yt = vids.find((v) => v.url.includes('dQw4w9WgXcQ'))!;
    expect(yt.posterUrl).toContain('maxresdefault');
    expect(yt.posterFallback).toContain('hqdefault');
    expect(yt.downloadable).toBe(false);
  });
  it('a video with no usable source still shows its poster as an image', () => {
    const r = run('<video poster="/only-poster.jpg"></video>');
    expect(r.candidates[0]).toMatchObject({ kind: 'image', url: 'https://example.com/only-poster.jpg' });
  });
});

describe('inline svg and stylesheet discovery', () => {
  it('turns inline svg icons into standalone svg files, including sprite icons', () => {
    const html = `<svg style="display:none"><symbol id="i-star" viewBox="0 0 24 24"><path d="M1 1h22v22z"/></symbol></svg>
      <button><svg width="16" height="16" aria-label="Search"><path d="M0 0h16v16z" fill="currentColor"/></svg></button>
      <svg class="icon"><use href="#i-star"></use></svg>
      <svg width="20" height="20"></svg>`;
    const svgs = run(html).candidates.filter((c) => c.origin === 'inline-svg');
    expect(svgs).toHaveLength(2);
    expect(svgs[0]).toMatchObject({ mime: 'image/svg+xml', width: 16, height: 16, title: 'Search' });
    const sprite = decodeURIComponent(svgs[1].url.split(',')[1]);
    expect(sprite).toContain('viewBox="0 0 24 24"');
    expect(sprite).toContain('<path');
    expect(decodeURIComponent(svgs[0].url)).not.toContain('currentColor');
  });
  it('lists stylesheets', () => {
    expect(run('<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="https://cdn.e.com/b.css">').stylesheets).toEqual(['https://example.com/a.css', 'https://cdn.e.com/b.css']);
  });
});
