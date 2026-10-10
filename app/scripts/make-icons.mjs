// Renders public/icon.svg to the PNG sizes PWAs and iOS need, using Playwright's Chromium.
// Run: node scripts/make-icons.mjs  (set PLAYWRIGHT_CHROMIUM_PATH if your Chromium build differs)
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : {},
);
for (const [name, size, pad] of [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['apple-touch-icon.png', 180, 0],
  // Maskable: launchers crop to a circle/squircle, so keep the art inside the safe zone.
  ['icon-maskable-512.png', 512, 0.12],
]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = Math.round(size * (1 - 2 * pad));
  await page.setContent(
    `<body style="margin:0;background:#0b0f0e;display:grid;place-items:center;width:${size}px;height:${size}px">` +
      `<div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`,
  );
  await page.screenshot({
    path: new URL(`../public/${name}`, import.meta.url).pathname,
    omitBackground: false,
  });
  await page.close();
}
await browser.close();
console.log('icons written to public/');
