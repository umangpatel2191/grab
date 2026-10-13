// Renders assets/icon.svg to the PNG sizes Figma Community asks for.
import fs from 'node:fs';
import sharp from 'sharp';

const svg = fs.readFileSync(new URL('../assets/icon.svg', import.meta.url));
for (const size of [128, 256, 512]) {
  await sharp(svg, { density: (size / 64) * 72 }).resize(size, size, { kernel: 'nearest' }).png().toFile(new URL(`../assets/icon-${size}.png`, import.meta.url).pathname);
  console.log('wrote icon-' + size + '.png');
}
