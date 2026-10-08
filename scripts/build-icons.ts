/**
 * Renders the logo (public/logo.svg) to the PNG icons browsers and phones want, plus the image
 * shown when the game's link is shared (public/og-image.png). Run: npm run icons
 */
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';

const logo = fs.readFileSync('public/logo.svg', 'utf8');
const inner = logo.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const png = (svg: string, width: number, file: string) => {
  fs.writeFileSync(file, new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true } }).render().asPng());
  console.log(file);
};

// tab icon and app icons: the mark on the dark background, with breathing room for rounded masks
const onDark = (pad: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0b0d0e"/><g transform="translate(${pad} ${pad}) scale(${(64 - 2 * pad) / 64})">${inner}</g></svg>`;
png(logo, 32, 'public/favicon-32.png');
png(onDark(10), 180, 'public/apple-touch-icon.png');
png(onDark(8), 192, 'public/icon-192.png');
png(onDark(8), 512, 'public/icon-512.png');

// link preview (Discord, WhatsApp, iMessage…): 1200 x 630
const dots = fs.readFileSync('public/ui/world-dots.svg', 'utf8').match(/<path[^>]*\/>/)![0].replace('stroke="#fff"', 'stroke="#ffffff" stroke-opacity="0.16"');
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0a0c0d"/>
  <g transform="translate(330 70) scale(4.6)">${dots}</g>
  <rect x="0" y="0" width="1200" height="630" fill="url(#fade)"/>
  <defs><linearGradient id="fade" x1="0" x2="1"><stop offset="0.25" stop-color="#0a0c0d"/><stop offset="0.75" stop-color="#0a0c0d" stop-opacity="0"/></linearGradient></defs>
  <g transform="translate(80 150) scale(1.6)">${inner}</g>
  <text x="80" y="420" font-family="Impact, 'Arial Narrow Bold', sans-serif" font-size="150" fill="#ecebe6" letter-spacing="2">WARROOM</text>
  <rect x="80" y="456" width="10" height="10" fill="#ff6b35"/>
  <text x="104" y="466" font-family="Consolas, 'Courier New', monospace" font-size="24" fill="#8b9198" letter-spacing="3">GRAND STRATEGY · 3,500 YEARS · 8 ERAS</text>
  <text x="80" y="540" font-family="Segoe UI, Arial, sans-serif" font-size="28" fill="#ecebe6" opacity="0.85">Lead one nation through history. Every leader remembers.</text>
  <rect x="80" y="575" width="64" height="4" fill="#ff6b35"/>
</svg>`;
png(og, 1200, 'public/og-image.png');
