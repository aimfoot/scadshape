// Export: 3MF (zip), STL (binary, the right number of triangles) and .scad are downloaded with the
// chosen file name.
// node export.mjs [url] [outdir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US', acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); });
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));
// A container with a lid as the model
await page.click('#btnContainer'); await page.waitForSelector('#featPanel:not([hidden])'); await page.click('#fpOk');
await page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
const tris = await page.evaluate(() => Number(document.querySelector('#status').textContent.match(/([\d\s]+) triangles/)[1].replace(/\s/g, '')));

await page.click('#btnExport'); await page.waitForSelector('#exportDlg[open]');
await page.screenshot({ path: `${out}/e-dialog.png` });
await page.fill('#exName', 'jar'); await page.dispatchEvent('#exName', 'change');
const get = async fmt => {
  await page.click(`#exFormat [data-format="${fmt}"]`);
  await page.waitForFunction(() => /Ready/.test(document.querySelector('#exInfo').textContent), null, { timeout: 60000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exDownload')]);
  const path = `${out}/${dl.suggestedFilename()}`; await dl.saveAs(path);
  return { name: dl.suggestedFilename(), buf: readFileSync(path) };
};
const m3 = await get('3mf');
assert.equal(m3.name, 'jar.3mf'); assert.equal(m3.buf.subarray(0, 2).toString(), 'PK', 'a 3MF is a zip');
const stl = await get('stl');
assert.equal(stl.name, 'jar.stl'); assert.equal(stl.buf.readUInt32LE(80), tris); assert.equal(stl.buf.length, 84 + 50 * tris);
const scad = await get('scad');
assert.equal(scad.name, 'jar.scad'); assert.match(scad.buf.toString(), /module lid\(\)/); // the container's parts, the lid among them
console.log(`3MF ${m3.buf.length} B, STL ${tris} triangles, scad ${scad.buf.length} B`);
// The format is saved; the file name is the model's name
await page.click('#exportDlg form button:not([type])');
await page.reload(); await page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.click('#btnExport');
assert.equal(await page.inputValue('#exName'), 'My model', 'the file name follows the model\'s name');
assert.equal(await page.getAttribute('#exFormat [data-format="scad"]', 'aria-pressed'), 'true');
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
