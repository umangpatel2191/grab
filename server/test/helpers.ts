import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { PollResponse, ScanEvent } from '../../shared/types';
import type { AppHandle } from '../src/app';

export interface Fixture {
  port: number;
  base: string;
  hits: Record<string, number>;
  close: () => Promise<void>;
}

export async function makePng(w = 64, h = 48): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
}

/** A small fake website with every awkward case we care about. */
export async function startFixture(): Promise<Fixture> {
  const png = await makePng();
  const bigPng = await makePng(5000, 100); // wider than Figma allows
  const mp4 = Buffer.concat([Buffer.from('\0\0\0\x18ftypmp42\0\0\0\0mp42isom'), Buffer.alloc(2000, 1)]);
  const hits: Record<string, number> = {};
  let base = '';

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    hits[url.pathname] = (hits[url.pathname] ?? 0) + 1;
    const send = (status: number, type: string, body: Buffer | string, extra: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': type, ...extra });
      res.end(body);
    };
    switch (true) {
      case url.pathname === '/robots.txt':
        return send(200, 'text/plain', 'User-agent: *\nDisallow: /private\n');
      case url.pathname === '/': {
        const html = `<!doctype html><html><head><title>Fixture</title>
          <meta property="og:image" content="/img/og.png"><meta property="og:image:width" content="1200">
          <link rel="stylesheet" href="/style.css">
          <link rel="icon" href="/img/fav.png" sizes="32x32"></head><body>
          <img src="/img/1.png" width="640" height="480" alt="one">
          <img srcset="/img/2-300x200.png 300w, /img/2-1200x800.png 1200w">
          <img data-src="/img/3.png"><img src="/img/pixel.png" width="1" height="1">
          <img src="/img/big.png">
          <img src="/img/not-an-image.png">
          <video poster="/img/poster.png"><source src="/video.mp4" type="video/mp4"></video>
          <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
          <a href="https://www.instagram.com/fixture_studio/">IG</a>
          <a href="https://www.linkedin.com/company/fixture">LI</a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
          </body></html>`;
        return send(200, 'text/html; charset=utf-8', html);
      }
      // a small multi-page site for the crawler
      case url.pathname === '/site':
        return send(200, 'text/html', `<html><head><title>Site</title></head><body>
          <header><a href="/site"><img class="logo" src="/img/site-logo.png" alt="Site"></a>
          <nav><a href="/site/about">About</a><a href="/site/work">Work</a><a href="/site/cart">Cart</a><a href="/img/file.pdf">PDF</a><a href="https://elsewhere.example/">Out</a></nav></header>
          <img src="/img/home.png"><img src="/img/shared.png">
          <script>window.__cfg = {"social":"https:\\/\\/www.tiktok.com\\/@fixture_tt"}</script></body></html>`);
      case url.pathname === '/site/about':
        return send(200, 'text/html', `<html><body><img src="/img/about.png"><img src="/img/shared.png"><a href="/site/team">Team</a></body></html>`);
      case url.pathname === '/site/work':
        return send(200, 'text/html', `<html><body><img src="/img/work-1.png"><img src="/img/work-2.png"><footer><a href="https://www.pinterest.com/fixturepins/">Pins</a></footer></body></html>`);
      case url.pathname === '/site/team':
        return send(200, 'text/html', `<html><body><img src="/img/team.png"></body></html>`);
      case url.pathname === '/site/extra':
        return send(200, 'text/html', `<html><body><img src="/img/extra.png"></body></html>`);
      case url.pathname === '/sitemap.xml':
        return send(200, 'application/xml', `<?xml version="1.0"?><urlset><url><loc>http://127.0.0.1:${port}/site/extra</loc></url></urlset>`);
      case url.pathname === '/brand':
        return send(200, 'text/html', `<html><head><meta name="theme-color" content="#0a7cff"><style>:root{--brand-primary:#ff6600} a{color:var(--brand-primary)}</style>
          <link rel="icon" href="/img/fav.png" sizes="32x32"></head><body><img src="/anim.gif" width="40" height="30" alt="loop"></body></html>`);
      case url.pathname === '/anim.gif':
        return send(200, 'image/gif', Buffer.from('R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=', 'base64'));
      case url.pathname === '/style.css':
        return send(200, 'text/css', '.hero{background:url(/img/css-bg.png)} @font-face{src:url(/f.woff2)}');
      case url.pathname.startsWith('/img/not-an-image'):
        return send(200, 'image/png', '<html>I am not an image</html>');
      case url.pathname === '/img/big.png':
        return send(200, 'image/png', bigPng);
      case url.pathname.startsWith('/img/') || url.pathname.startsWith('/social/'):
        return send(200, 'image/png', png);
      case url.pathname === '/video.mp4':
        return send(200, 'video/mp4', mp4, { 'content-length': String(mp4.length) });
      case url.pathname === '/video-chunked.mp4':
        res.writeHead(200, { 'content-type': 'video/mp4' }); // no content-length
        res.write(mp4);
        return void setTimeout(() => res.end(mp4), 20);
      case url.pathname === '/p2':
        return send(200, 'text/html', '<a href="https://www.instagram.com/login-required-user/">IG</a><img src="/img/1.png">');
      case url.pathname === '/private':
        return send(200, 'text/html', '<img src="/img/1.png">');
      case url.pathname === '/loop':
        return send(302, 'text/plain', '', { location: '/loop' });
      case url.pathname === '/redirect-to-page':
        return send(302, 'text/plain', '', { location: '/' });
      case url.pathname === '/slow':
        return void setTimeout(() => send(200, 'text/html', '<img src="/img/1.png">'), 3000);
      case url.pathname === '/huge':
        res.writeHead(200, { 'content-type': 'text/html' });
        res.write('<html><body>');
        for (let i = 0; i < 400; i++) res.write('<img src="/img/1.png">' + 'x'.repeat(5000));
        return void res.end('</body></html>');
      case url.pathname === '/json':
        return send(200, 'application/json', '{"a":1}');
      case url.pathname === '/404':
        return send(404, 'text/html', 'nope');
      case url.pathname === '/500':
        return send(500, 'text/html', 'boom');
      case url.pathname === '/blocked':
        return send(403, 'text/html', 'no');
      default:
        return send(404, 'text/plain', 'not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;
  return {
    port,
    base,
    hits,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export async function waitForJob(h: AppHandle, jobId: string, timeoutMs = 15000): Promise<ScanEvent[]> {
  const all: ScanEvent[] = [];
  let since = 0;
  const start = Date.now();
  for (;;) {
    const r = await h.app.inject({ method: 'GET', url: `/v1/scans/${jobId}?since=${since}` });
    const body = r.json() as PollResponse;
    all.push(...body.events);
    since = body.next;
    if (body.status !== 'running') return all;
    if (Date.now() - start > timeoutMs) throw new Error('job did not finish: ' + JSON.stringify(all.slice(-3)));
    await new Promise((res) => setTimeout(res, 40));
  }
}
