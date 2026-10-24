// Contact sheets of the AI trial's results (tools/aitrial): the last picture of each design with its
// request. node aitrial-sheet.mjs [trial out dir] [sheet dir]
import { chromium } from 'playwright';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const dir = process.argv[2] ?? new URL('../aitrial/out', import.meta.url).pathname;
const out = process.argv[3] ?? dir;
const results = JSON.parse(readFileSync(`${dir}/results.json`, 'utf8'));
const cells = results.map(r => {
  const d = readdirSync(dir).find(f => f.startsWith(String(r.n).padStart(2, '0') + '-'));
  const png = `${dir}/${d}/${r.last}.png`;
  const img = existsSync(png) ? `data:image/png;base64,${readFileSync(png).toString('base64')}` : '';
  return `<figure><img src="${img}"><figcaption>#${r.n} ${r.request}</figcaption></figure>`;
});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
for (let s = 0; s < cells.length; s += 10) {
  await page.setContent(`<style>body{margin:0;font:15px sans-serif;display:grid;grid-template-columns:repeat(5,300px)}figure{margin:0}img{width:300px;height:233px;object-fit:cover}figcaption{height:40px;padding:2px 4px}</style>${cells.slice(s, s + 10).join('')}`);
  await page.screenshot({ path: `${out}/sheet-${s / 10 + 1}.png`, fullPage: true });
}
await browser.close();
