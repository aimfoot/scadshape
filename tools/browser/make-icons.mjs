// Rita appens PNG-ikoner från public/icons/*.svg (körs vid ändrad ikon):  node make-icons.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const dir = new URL('../../public/icons/', import.meta.url).pathname;
const browser = await chromium.launch();
for (const [svg, size, out] of [['icon.svg', 192, 'icon-192.png'], ['icon.svg', 512, 'icon-512.png'], ['maskable.svg', 512, 'maskable-512.png'], ['icon.svg', 180, 'apple-touch-icon.png']]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style><img src="data:image/svg+xml;base64,${readFileSync(dir + svg).toString('base64')}" width="${size}" height="${size}">`);
  await page.screenshot({ path: dir + out, omitBackground: true });
  await page.close();
}
await browser.close();
console.log('ikoner klara');
