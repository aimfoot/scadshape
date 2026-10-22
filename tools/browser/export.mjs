// Export: 3MF (zip), STL (binär, rätt antal trianglar) och .scad laddas ner med valt filnamn.
//   node export.mjs [url] [utkatalog]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'sv-SE', acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'sv'); });
await page.reload();
await page.waitForFunction(() => /Börja med Skiss/.test(document.querySelector('#status').textContent));
// En behållare med lock som modell
await page.click('#btnContainer'); await page.waitForSelector('#featPanel:not([hidden])'); await page.click('#fpOk');
await page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
const tris = await page.evaluate(() => Number(document.querySelector('#status').textContent.match(/([\d\s]+) trianglar/)[1].replace(/\s/g, '')));

await page.click('#btnExport'); await page.waitForSelector('#exportDlg[open]');
await page.screenshot({ path: `${out}/e-dialog.png` });
await page.fill('#exName', 'burk'); await page.dispatchEvent('#exName', 'change');
const get = async fmt => {
  await page.click(`#exFormat [data-format="${fmt}"]`);
  await page.waitForFunction(() => /Klar/.test(document.querySelector('#exInfo').textContent), null, { timeout: 60000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exDownload')]);
  const path = `${out}/${dl.suggestedFilename()}`; await dl.saveAs(path);
  return { name: dl.suggestedFilename(), buf: readFileSync(path) };
};
const m3 = await get('3mf');
assert.equal(m3.name, 'burk.3mf'); assert.equal(m3.buf.subarray(0, 2).toString(), 'PK', '3MF är en zip');
const stl = await get('stl');
assert.equal(stl.name, 'burk.stl'); assert.equal(stl.buf.readUInt32LE(80), tris); assert.equal(stl.buf.length, 84 + 50 * tris);
const scad = await get('scad');
assert.equal(scad.name, 'burk.scad'); assert.match(scad.buf.toString(), /behallare_1_lid\(\);/);
console.log(`3MF ${m3.buf.length} B, STL ${tris} trianglar, scad ${scad.buf.length} B`);
// Formatet sparas; filnamnet är modellens namn
await page.click('#exportDlg form button:not([type])');
await page.reload(); await page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.click('#btnExport');
assert.equal(await page.inputValue('#exName'), 'Min modell', 'filnamnet följer modellens namn');
assert.equal(await page.getAttribute('#exFormat [data-format="scad"]', 'aria-pressed'), 'true');
await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
