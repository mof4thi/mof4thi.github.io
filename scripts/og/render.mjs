// Renders the link-preview images (LinkedIn, etc.) from the SVGs next to this file.
// Edit en.svg / fr.svg, then run: node scripts/og/render.mjs
import sharp from 'sharp';

const dir = new URL('.', import.meta.url).pathname;
await sharp(`${dir}en.svg`).png().toFile('public/og-image.png');
await sharp(`${dir}fr.svg`).png().toFile('public/og-image-fr.png');
console.log('Wrote public/og-image.png and public/og-image-fr.png');
