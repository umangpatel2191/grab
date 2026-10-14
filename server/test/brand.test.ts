import { describe, expect, it } from 'vitest';
import { colorsFromCss, colorsFromImage, colorsFromManifest, colorsFromSvgPaints, colorsFromUi, extractBrandHints, isNeutral, mergeBrandColors, parseChannels, parseColor, usageFromHtml, colorsFromScreenshot, colorDistance } from '../src/extract/brand';
import { getSharp } from '../src/media';

describe('color parsing', () => {
  it('parses hex, rgb and hsl and rejects junk and transparent', () => {
    expect(parseColor('#f60')).toBe('#FF6600');
    expect(parseColor('#2B50FF')).toBe('#2B50FF');
    expect(parseColor('#2b50ff80')).toBe('#2B50FF');
    expect(parseColor('#2b50ff10')).toBeNull();
    expect(parseColor('rgb(43, 80, 255)')).toBe('#2B50FF');
    expect(parseColor('rgba(43 80 255 / 0.2)')).toBeNull();
    expect(parseColor('hsl(0, 100%, 50%)')).toBe('#FF0000');
    expect(parseColor('red')).toBeNull();
    expect(parseColor('#12')).toBeNull();
  });
  it('knows neutrals', () => {
    expect(isNeutral('#FFFFFF')).toBe(true);
    expect(isNeutral('#111111')).toBe(true);
    expect(isNeutral('#888888')).toBe(true);
    expect(isNeutral('#FF4D2E')).toBe(false);
  });
});

describe('brand hints', () => {
  const html = `<head><meta name="theme-color" content="#0a7cff"><meta name="msapplication-TileColor" content="#ff0066">
    <link rel="manifest" href="/site.webmanifest"><link rel="mask-icon" href="/m.svg" color="#5bbad5">
    <style>:root{--brand-primary:#ff6600;--accent:rgb(0,170,120);--bg:#ffffff;--unrelated:#123456} a{color:#ff6600} b{color:#ff6600} i{color:#7a5cff}</style></head>`;
  it('reads meta colors, inline css and the manifest url', () => {
    const h = extractBrandHints(html, 'https://x.com/a/');
    expect(h.colors.map((c) => c.hex).sort()).toEqual(['#0A7CFF', '#5BBAD5', '#FF0066']);
    expect(h.manifestUrl).toBe('https://x.com/site.webmanifest');
    expect(h.inlineCss).toContain('--brand-primary');
  });
  it('finds named css variables and the most used colors, ignoring unrelated vars and neutrals', () => {
    const c = colorsFromCss(extractBrandHints(html, 'https://x.com/').inlineCss);
    expect(c.find((x) => x.source === '--brand-primary')).toMatchObject({ hex: '#FF6600', role: 'brand' });
    expect(c.find((x) => x.source === '--accent')).toMatchObject({ hex: '#00AA78', role: 'accent' });
    expect(c.find((x) => x.source === '--bg')).toBeUndefined();
    expect(c.find((x) => x.source === '--unrelated')).toBeUndefined();
    expect(c.find((x) => x.role === 'palette' && x.hex === '#FF6600')).toBeTruthy();
  });
  it('reads manifest colors and survives bad json', () => {
    expect(colorsFromManifest('{"theme_color":"#112233","background_color":"#fff"}').map((c) => c.hex)).toEqual(['#112233', '#FFFFFF']);
    expect(colorsFromManifest('not json')).toEqual([]);
    expect(colorsFromManifest('{"theme_color":5}')).toEqual([]);
  });
  it('merges near duplicates, keeps the strongest, caps the list', () => {
    const m = mergeBrandColors([
      { hex: '#FF6600', role: 'palette', source: 's', weight: 5 },
      { hex: '#FF6702', role: 'theme', source: 't', weight: 1000 },
      { hex: '#0000FF', role: 'brand', source: 'b', weight: 800 },
    ]);
    expect(m.map((c) => c.hex)).toEqual(['#FF6702', '#0000FF']);
    const many = Array.from({ length: 30 }, (_, i) => ({ hex: `#${(i * 8).toString(16).padStart(2, '0')}${(255 - i * 8).toString(16).padStart(2, '0')}80`, role: 'palette' as const, source: 's', weight: i }));
    expect(mergeBrandColors(many, 5).length).toBeLessThanOrEqual(5);
  });
  it('gets dominant colors from a logo image', async () => {
    const sharp = await getSharp();
    if (!sharp) return;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#fff"/><rect width="60" height="100" fill="#2b50ff"/><circle cx="80" cy="50" r="15" fill="#ff4d2e"/></svg>`;
    const c = await colorsFromImage(sharp, Buffer.from(svg));
    expect(c[0].hex.startsWith('#2')).toBe(true);
    expect(c.length).toBeGreaterThanOrEqual(2);
    expect(await colorsFromImage(sharp, Buffer.from('garbage'))).toEqual([]);
  });
});

describe('brand colors that match the real site', () => {
  it('follows var() chains and reads Tailwind / shadcn channel values', () => {
    const c = colorsFromCss(':root{--blue-600:#2563eb;--color-primary:var(--blue-600);--primary:221 83% 53%;--brand-rgb:255 102 0}');
    expect(c.find((x) => x.source === '--color-primary')?.hex).toBe('#2563EB');
    expect(c.find((x) => x.source === '--primary')?.hex).toBe(parseChannels('221 83% 53%'));
    expect(c.find((x) => x.source === '--brand-rgb')?.hex).toBe('#FF6600');
    expect(parseChannels('59 130 246')).toBe('#3B82F6');
    expect(parseChannels('hello')).toBeNull();
  });
  it('ranks button and link colors above colors that are only defined in utility classes', () => {
    const css = `.btn-primary{background:#e4002b} a:hover{color:#e4002b}` + Array.from({ length: 40 }, (_, i) => `.text-blue-${i}00{color:#3b82f6}`).join('');
    const pal = colorsFromCss(css).filter((x) => x.role === 'palette');
    expect(pal[0].hex).toBe('#E4002B');
  });
  it('skips foreground / text variables that are not the brand itself', () => {
    const c = colorsFromCss(':root{--primary-foreground:#ff0000;--primary:#123abc}');
    expect(c.find((x) => x.source === '--primary-foreground')).toBeUndefined();
  });
  it('uses measured colors of buttons and the header first', () => {
    const ui = colorsFromUi([
      { color: 'rgb(228, 0, 43)', part: 'button' },
      { color: 'rgb(228, 0, 43)', part: 'button' },
      { color: 'rgb(0, 102, 204)', part: 'link' },
      { color: 'rgb(255, 255, 255)', part: 'header' },
    ]);
    expect(ui[0]).toMatchObject({ hex: '#E4002B', role: 'brand', source: 'buttons' });
    expect(ui.some((c) => c.hex === '#FFFFFF')).toBe(false);
  });
  it('reads colors drawn in an inline svg logo', () => {
    expect(colorsFromSvgPaints(['#0a66c2', '#0a66c2', 'none', '#fff'])[0].hex).toBe('#0A66C2');
  });
  it('agreement between methods raises a color', () => {
    const m = mergeBrandColors([
      { hex: '#00AA00', role: 'palette', source: 's', weight: 500 },
      { hex: '#0000AA', role: 'palette', source: 's', weight: 520 },
      { hex: '#00AA02', role: 'logo', source: 'logo', weight: 500 },
    ]);
    expect(m[0].hex).toBe('#00AA00');
  });
});

describe('brand colors from what the page really uses', () => {
  // like a Tailwind site: the stylesheet ships many stock colors, the page uses only its own two
  const css = `.bg-brand-purple{background-color:rgb(30 0 34/var(--tw-bg-opacity,1))}.text-brand-purple{color:rgb(30 0 34)}
    .bg-brand-gold{background-color:rgb(188 157 91)}.text-red-500{color:#ef4444}.bg-green-600{background-color:#16a34a}
    .wp-notice{color:#dc3232}.unused-thing{background:#ff00aa}`;
  const html = `<div class="bg-brand-purple text-white"><p class="text-brand-purple">a</p><p class="text-brand-purple">b</p>
    <span class="bg-brand-gold">c</span><a class="bg-[#25B33C]">wa</a></div>`;
  it('counts how often classes are used and reads arbitrary Tailwind colors', () => {
    const u = usageFromHtml(html);
    expect(u.classes.get('text-brand-purple')).toBe(2);
    expect(u.inlineColors).toContain('#25B33C');
  });
  it('ranks the site colors first and drops stock colors the page never uses', () => {
    const pal = colorsFromCss(css, usageFromHtml(html)).filter((c) => c.role === 'palette').map((c) => c.hex);
    expect(pal[0]).toBe('#1E0022');
    expect(pal).toContain('#BC9D5B');
    for (const stock of ['#EF4444', '#16A34A', '#DC3232', '#FF00AA']) expect(pal).not.toContain(stock);
  });
});

describe('only what the page uses', () => {
  it('ignores brand variables that no rule on the page refers to (library leftovers)', () => {
    const css = ':root{--swal2-confirm-primary:#7066e0;--brand:#fcd100} .btn{background:var(--brand)} .swal2-confirm{background:var(--swal2-confirm-primary)}';
    const c = colorsFromCss(css, usageFromHtml('<a class="btn">Go</a>'));
    expect(c.some((x) => x.hex === '#FCD100')).toBe(true);
    expect(c.some((x) => x.hex === '#7066E0')).toBe(false);
  });
  it('names the palette by rank and keeps the dark and light neutrals', () => {
    const m = mergeBrandColors([
      { hex: '#FCD100', role: 'brand', source: 'page', weight: 900 },
      { hex: '#000000', role: 'neutral', source: 'page', weight: 650 },
      { hex: '#FFFFFF', role: 'neutral', source: 'page', weight: 300 },
      { hex: '#342A0B', role: 'brand', source: 'page', weight: 300 }, // weak: dropped
    ]);
    expect(m.map((c) => `${c.name} ${c.hex}`)).toEqual(['Primary #FCD100', 'Dark #000000', 'Light #FFFFFF']);
  });
  it('a monochrome site gets its dark color as primary', () => {
    const m = mergeBrandColors([{ hex: '#08090A', role: 'theme', source: 'theme-color', weight: 1000 }, { hex: '#FFFFFF', role: 'neutral', source: 'page', weight: 300 }]);
    expect(m[0]).toMatchObject({ hex: '#08090A', name: 'Primary' });
  });
  it('reads the colors that cover a rendered page, first screen counted double', async () => {
    const sharp = await getSharp();
    if (!sharp) return;
    // 1366×1800: yellow hero on the first screen, black below, a thin white band
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1366" height="1800"><rect width="1366" height="1800" fill="#000"/><rect width="1366" height="600" fill="#fcd100"/><rect y="1700" width="1366" height="100" fill="#fff"/></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const seen = await colorsFromScreenshot(sharp, png);
    const yellow = seen.find((c) => colorDistance(c.hex, '#FCD100') < 30)!;
    expect(yellow.role).toBe('brand');
    expect(yellow.share!).toBeGreaterThan(0.3);
    expect(seen.some((c) => c.role === 'neutral' && colorDistance(c.hex, '#000000') < 20)).toBe(true);
  });
});
