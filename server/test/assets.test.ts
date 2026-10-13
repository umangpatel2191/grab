import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { originalUrl } from '../../shared/originals';
import { usageFromHtml } from '../src/extract/brand';
import { extractFonts, extractTypeScale, googleFamilies, primaryFamily } from '../src/extract/fonts';
import { cssImports, extractCssImageUrls } from '../src/extract/html';
import { upscale } from '../src/media';

describe('full-resolution originals', () => {
  const cases: [string, string | null][] = [
    ['https://a.com/wp-content/uploads/2025/12/photo-300x200.jpg', 'https://a.com/wp-content/uploads/2025/12/photo.jpg'],
    ['https://a.com/wp-content/uploads/2025/12/photo.jpg', null],
    ['https://a.com/_next/image?url=%2Fimg%2Fhero.png&w=640&q=75', 'https://a.com/img/hero.png'],
    ['https://a.com/_next/image?url=https%3A%2F%2Fcdn.b.com%2Fx.jpg&w=640&q=75', 'https://cdn.b.com/x.jpg'],
    ['https://a.com/cdn-cgi/image/width=400,quality=80/uploads/x.jpg', 'https://a.com/uploads/x.jpg'],
    ['https://a.com/_ipx/w_300/img/x.png', 'https://a.com/img/x.png'],
    ['https://res.cloudinary.com/demo/image/upload/w_300,c_fill/v1/sample.jpg', 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg'],
    ['https://static.wixstatic.com/media/abc_123.jpg/v1/fill/w_300,h_200/abc.jpg', 'https://static.wixstatic.com/media/abc_123.jpg'],
    ['https://cdn.shopify.com/s/files/1/products/shoe_400x.jpg?v=1', 'https://cdn.shopify.com/s/files/1/products/shoe.jpg?v=1'],
    ['https://cdn.shopify.com/s/files/1/products/shoe_300x300_crop_center.jpg', 'https://cdn.shopify.com/s/files/1/products/shoe.jpg'],
    ['https://images.ctfassets.net/sp/id/hash/hero.jpg?w=400&q=50&fm=webp', 'https://images.ctfassets.net/sp/id/hash/hero.jpg'],
    ['https://images.unsplash.com/photo-1?ixlib=rb-4&w=400&q=80', 'https://images.unsplash.com/photo-1'],
    ['https://other.com/img.jpg?w=400', null], // unknown host: query may matter
    ['data:image/png;base64,AAAA', null],
  ];
  for (const [input, expected] of cases) it(input.slice(0, 70), () => expect(originalUrl(input)).toBe(expected));
});

describe('stylesheets', () => {
  it('follows @import in every form and reads image-set()', () => {
    const css = `@import url("theme.css"); @import 'b.css' screen; @import url(https://fonts.googleapis.com/css2?family=Inter);
      .h{background-image:image-set("hero.avif" type("image/avif") 1x, "hero@2x.jpg" 2x)}`;
    expect(cssImports(css, 'https://a.com/css/main.css')).toEqual([
      'https://a.com/css/theme.css',
      'https://a.com/css/b.css',
      'https://fonts.googleapis.com/css2?family=Inter',
    ]);
    expect(extractCssImageUrls(css, 'https://a.com/css/main.css')).toEqual(expect.arrayContaining(['https://a.com/css/hero.avif', 'https://a.com/css/hero@2x.jpg']));
  });
});

describe('fonts', () => {
  it('reads family lists and Google Fonts links', () => {
    expect(primaryFamily(`"Outfit", -apple-system, sans-serif`)).toBe('Outfit');
    expect(primaryFamily('var(--x), system-ui')).toBeNull();
    expect(googleFamilies('https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&family=Playfair+Display:ital,wght@0,400;1,700&display=swap')).toEqual([
      { family: 'Outfit', weights: ['100–900'] },
      { family: 'Playfair Display', weights: ['400', '700'] },
    ]);
    expect(googleFamilies('https://example.com/x.css')).toEqual([]);
  });
  it('finds heading and body fonts, their files and sources, and skips icon and unused fonts', () => {
    const html = `<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700" rel="stylesheet">
      <body class="font-body"><h1 class="title">Hi</h1><p>x</p><i class="fa"></i></body>`;
    const css = `@font-face{font-family:"Brand Serif";font-weight:700;src:url(/fonts/brand.woff2) format("woff2")}
      @font-face{font-family:"Font Awesome 6";src:url(/fa.woff2)}
      :root{--font-head:"Brand Serif", serif}
      body{font-family:Outfit, sans-serif} .title{font-family:var(--font-head)} .never-used{font-family:Comic Neue}
      .fa{font-family:"Font Awesome 6"}`;
    const fonts = extractFonts(html, 'https://a.com/', [css], usageFromHtml(html));
    const by = Object.fromEntries(fonts.map((f) => [f.family, f]));
    expect(by.Outfit).toMatchObject({ source: 'google', roles: ['body'] });
    expect(by['Brand Serif']).toMatchObject({ source: 'self-hosted', roles: ['heading'] });
    expect(by['Brand Serif'].files[0]).toMatchObject({ url: 'https://a.com/fonts/brand.woff2', format: 'woff2', weight: '700' });
    expect(by['Font Awesome 6']).toBeUndefined();
    expect(by['Comic Neue']).toBeUndefined();
  });
  it('prefers what the browser measured', () => {
    const fonts = extractFonts('<p>x</p>', 'https://a.com/', ['body{font-family:Georgia}'], undefined, [{ part: 'body', family: '"Inter", sans-serif' }]);
    expect(fonts[0].family).toBe('Inter');
  });
});

describe('HD', () => {
  it('enlarges a small image 2× and leaves large images and svg alone', async () => {
    const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#e4002b' } }).jpeg().toBuffer();
    const up = await upscale(small, 'image/jpeg');
    const meta = await sharp(up.buf).metadata();
    expect([meta.width, meta.height]).toEqual([600, 400]);
    const big = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#000' } }).png().toBuffer();
    expect((await upscale(big, 'image/png')).buf).toBe(big);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    expect((await upscale(svg, 'image/svg+xml')).buf).toBe(svg);
  });
});

describe('type scale', () => {
  it('reads h1-h6 and body from CSS, desktop values, rem and clamp()', () => {
    const css = `html{font-size:62.5%} h1{font-size:clamp(3rem, 5vw, 6.4rem);font-weight:800;line-height:1.1} h2{font-size:3.2rem}
      body{font-family:"Inter",sans-serif;font-size:1.6rem;line-height:1.5} @media (max-width:600px){h1{font-size:2rem}}`;
    const s = Object.fromEntries(extractTypeScale([css], '<h1>x</h1>').map((t) => [t.tag, t]));
    expect(s.h1).toMatchObject({ sizePx: 64, weight: 800, family: 'Inter', from: 'css' });
    expect(s.h1.lineHeightPx).toBeCloseTo(70.4, 1);
    expect(s.h2.sizePx).toBe(32);
    expect(s.body).toMatchObject({ sizePx: 16, lineHeightPx: 24 });
  });
  it('reads utility classes on the real elements (Tailwind)', () => {
    const css = `.text-5xl{font-size:3rem;line-height:1}.font-bold{font-weight:700}.text-lg{font-size:1.125rem;line-height:1.75rem}`;
    const s = Object.fromEntries(extractTypeScale([css], '<h1 class="text-5xl font-bold">x</h1><p class="text-lg">y</p>').map((t) => [t.tag, t]));
    expect(s.h1).toMatchObject({ sizePx: 48, weight: 700, lineHeightPx: 48 });
    expect(s.body).toMatchObject({ sizePx: 18, lineHeightPx: 28 });
  });
  it('uses measured values from the browser as they are', () => {
    const s = extractTypeScale([], '', [{ tag: 'h1', fontFamily: '"Söhne", sans-serif', fontSize: '48px', fontWeight: '300', lineHeight: '55.2px', letterSpacing: '-0.96px', textTransform: 'none' }]);
    expect(s[0]).toMatchObject({ tag: 'h1', family: 'Söhne', sizePx: 48, weight: 300, lineHeightPx: 55.2, letterSpacingPx: -0.96, from: 'measured' });
  });
});
