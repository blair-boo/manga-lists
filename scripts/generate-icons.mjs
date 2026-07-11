import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(path.join(__dirname, 'icon-source.svg'), 'utf-8');
const outDir = path.join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'maskable-icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();

for (const { name, size } of sizes) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;padding:0;width:${size}px;height:${size}px;">${svg}</body></html>`
  );
  await page.evaluate((s) => {
    const el = document.querySelector('svg');
    el.setAttribute('width', String(s));
    el.setAttribute('height', String(s));
  }, size);
  const buf = await page.screenshot({ omitBackground: false });
  writeFileSync(path.join(outDir, name), buf);
  console.log('wrote', name);
}

await browser.close();
