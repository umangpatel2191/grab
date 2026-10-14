// Builds the Figma Community listing images (1920×1080) from real plugin screenshots.
//   node plugin/scripts/community-images.mjs <screenshots-dir> <out-dir>
// Screenshots: light-home-filled.png, light-results.png, light-images.png, light-preview.png, light-fonts.png
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { chromium } = require('playwright');

const [shotsDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const img = (name) => 'data:image/png;base64,' + fs.readFileSync(path.join(shotsDir, name)).toString('base64');
const icon = 'data:image/png;base64,' + fs.readFileSync(new URL('../assets/icon-256.png', import.meta.url)).toString('base64');

const YELLOW = '#FFD60A';
const base = `
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; }
    body { width: 1920px; height: 1080px; overflow: hidden; font-family: Inter, system-ui, sans-serif; background: #0d0d0f; color: #fff; position: relative; }
    .glow { position: absolute; border-radius: 50%; filter: blur(120px); opacity: .55; }
    .grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px); background-size: 64px 64px; mask-image: radial-gradient(circle at 30% 40%, #000 0, transparent 75%); }
    .safe { position: absolute; left: 60px; right: 60px; top: 0; bottom: 0; }
    .brand { position: absolute; left: 100px; top: 96px; display: flex; align-items: center; gap: 18px; font-weight: 700; font-size: 34px; letter-spacing: -0.5px; }
    .brand img { width: 64px; height: 64px; border-radius: 16px; }
    .eyebrow { align-self: flex-start; display: inline-block; padding: 10px 18px; border-radius: 999px; background: rgba(255,214,10,.12); color: ${YELLOW}; font-weight: 600; font-size: 22px; letter-spacing: .5px; border: 1px solid rgba(255,214,10,.35); }
    h1 { font-size: 92px; line-height: 1.02; letter-spacing: -3.5px; font-weight: 800; }
    h1 em { font-style: normal; color: ${YELLOW}; }
    p.sub { font-size: 30px; line-height: 1.45; color: rgba(255,255,255,.72); max-width: 760px; }
    .copy { position: absolute; left: 100px; top: 250px; width: 860px; display: flex; flex-direction: column; gap: 34px; }
    ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 18px; }
    li { font-size: 26px; color: rgba(255,255,255,.85); display: flex; gap: 16px; align-items: center; }
    li::before { content: ''; width: 12px; height: 12px; border-radius: 50%; background: ${YELLOW}; flex: none; box-shadow: 0 0 0 6px rgba(255,214,10,.15); }
    .win { position: absolute; border-radius: 28px; overflow: hidden; background: #fff; box-shadow: 0 50px 120px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08); }
    .win .bar { height: 44px; background: #1e1e21; display: flex; align-items: center; gap: 9px; padding: 0 18px; }
    .win .bar i { width: 13px; height: 13px; border-radius: 50%; background: #3a3a3f; display: block; }
    .win .bar span { margin-left: 14px; font-size: 15px; color: rgba(255,255,255,.6); font-weight: 500; }
    .win img.shot { display: block; width: 100%; }
    .chip { position: absolute; display: flex; align-items: center; gap: 14px; padding: 14px 20px 14px 14px; border-radius: 18px; background: rgba(28,28,31,.92); border: 1px solid rgba(255,255,255,.1); box-shadow: 0 20px 50px rgba(0,0,0,.45); font-size: 20px; font-weight: 600; backdrop-filter: blur(10px); }
    .chip b { width: 44px; height: 44px; border-radius: 12px; display: block; box-shadow: inset 0 0 0 1px rgba(255,255,255,.25); }
    .chip small { display: block; font-size: 15px; font-weight: 500; color: rgba(255,255,255,.55); margin-top: 2px; }
    .foot { position: absolute; left: 100px; bottom: 80px; font-size: 22px; color: rgba(255,255,255,.45); font-weight: 500; }
  </style>`;

const win = (shot, { x, y, w, h, title = 'GRAB – Website Images, Colors &amp; Fonts', top = 0 }) => `
  <div class="win" style="left:${x}px; top:${y}px; width:${w}px; height:${h}px">
    <div class="bar"><i></i><i></i><i></i><span>${title}</span></div>
    <div style="height:${h - 44}px; overflow:hidden"><img class="shot" src="${img(shot)}" style="margin-top:-${top}px"></div>
  </div>`;

const glows = (a = YELLOW, b = '#7c5cff') => `
  <div class="glow" style="width:900px;height:900px;background:${a};left:1100px;top:-300px;opacity:.28"></div>
  <div class="glow" style="width:700px;height:700px;background:${b};left:-250px;top:600px;opacity:.22"></div>
  <div class="grid"></div>`;

const slides = {
  // Thumbnail: what it is, in one look
  '00-thumbnail': `${glows()}
    <div class="brand"><img src="${icon}">GRAB</div>
    <div class="copy" style="top:300px">
      <span class="eyebrow">FIGMA PLUGIN · FREE</span>
      <h1>Turn any website into a <em>brand kit</em></h1>
      <p class="sub">Images, icons, SVGs, colors, fonts and brand guidelines — collected from the live site, straight into Figma.</p>
    </div>
    ${win('light-results.png', { x: 1180, y: 110, w: 560, h: 860 })}
    <div class="chip" style="left:1000px;top:640px"><b style="background:#FFE01B"></b><div>#FFE01B<small>Primary</small></div></div>
    <div class="chip" style="left:1020px;top:770px"><b style="background:#241C15"></b><div>#241C15<small>Dark</small></div></div>
    <div class="chip" style="left:1560px;top:880px"><div style="font-size:30px;font-weight:800;padding-left:6px">Aa</div><div>Tally<small>Headings · Body</small></div></div>`,

  '01-paste-a-link': `${glows()}
    <div class="brand"><img src="${icon}">GRAB</div>
    <div class="copy">
      <span class="eyebrow">STEP 1</span>
      <h1>Paste a link.<br><em>Get the whole site.</em></h1>
      <ul>
        <li>Reads up to 200 pages: menu, footer and sitemap</li>
        <li>Pages built with JavaScript are rendered for you</li>
        <li>Nothing is downloaded until you choose</li>
      </ul>
    </div>
    ${win('light-home-filled.png', { x: 1180, y: 110, w: 560, h: 860 })}`,

  '02-brand-colors-fonts': `${glows('#FFE01B', '#00b37e')}
    <div class="brand"><img src="${icon}">GRAB</div>
    <div class="copy">
      <span class="eyebrow">BRAND KIT</span>
      <h1>Real brand colors <em>and fonts</em></h1>
      <ul>
        <li>Colors measured from what the page really shows</li>
        <li>Primary, Secondary, Accent, Dark and Light</li>
        <li>Fonts, weights and the full type scale</li>
      </ul>
    </div>
    ${win('light-results.png', { x: 1180, y: 110, w: 560, h: 860, top: 330 })}`,

  '03-every-image-hd': `${glows('#ff6a3d', YELLOW)}
    <div class="brand"><img src="${icon}">GRAB</div>
    <div class="copy">
      <span class="eyebrow">ASSETS</span>
      <h1>Every image, icon and SVG — <em>in HD</em></h1>
      <ul>
        <li>Full-size originals, not the resized thumbnails</li>
        <li>Inline SVG icons and logos as editable vectors</li>
        <li>GIFs and video posters too</li>
      </ul>
    </div>
    ${win('light-images.png', { x: 1180, y: 110, w: 560, h: 860 })}`,

  '04-preview-first': `${glows('#4f7bff', YELLOW)}
    <div class="brand"><img src="${icon}">GRAB</div>
    <div class="copy">
      <span class="eyebrow">PREVIEW</span>
      <h1>See it large. <em>Then take it.</em></h1>
      <ul>
        <li>Real size, file type and the page it came from</li>
        <li>Download, ZIP, or add to Figma in one click</li>
        <li>Arrow keys to browse, Space to select</li>
      </ul>
    </div>
    ${win('light-preview.png', { x: 1180, y: 110, w: 560, h: 860 })}`,

  '05-guidelines-tokens': `${glows(YELLOW, '#e94bff')}
    <div class="brand"><img src="${icon}">GRAB</div>
    <div class="copy">
      <span class="eyebrow">ONE CLICK</span>
      <h1>Brand guidelines <em>in Figma</em></h1>
      <ul>
        <li>Cover, logo, color, typography, icons, imagery</li>
        <li>Color variables, text styles and icon components</li>
        <li>Design tokens for developers (JSON + Tailwind)</li>
      </ul>
    </div>
    ${win('light-fonts.png', { x: 1180, y: 110, w: 560, h: 860 })}`,
};

const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [name, body] of Object.entries(slides)) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${base}</head><body><div class="safe"></div>${body}</body></html>`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log('wrote', name);
}
await browser.close();
