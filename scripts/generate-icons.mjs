import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const png = readFileSync(path.join(__dirname, 'icon-source.png')).toString('base64');
const dataUri = `data:image/png;base64,${png}`;
const outDir = path.join(__dirname, '..', 'public', 'icons');
const publicDir = path.join(__dirname, '..', 'public');
mkdirSync(outDir, { recursive: true });

const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'maskable-icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'favicon-32.png', size: 32, outDir: publicDir },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();

for (const { name, size, outDir: destino = outDir } of sizes) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;padding:0;">
       <img src="${dataUri}" style="display:block;width:${size}px;height:${size}px;">
     </body></html>`
  );
  const buf = await page.screenshot({ omitBackground: false });
  writeFileSync(path.join(destino, name), buf);
  console.log('wrote', name);
}

await browser.close();
