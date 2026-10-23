// Models: the old single document moves into a model; new, rename, switch model, save/open file,
// delete.
// node projects.mjs [url] [outdir]
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
page.on('dialog', d => d.accept());
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const feats = () => page.evaluate(() => window.__scadshape.doc.features.map(f => f.type));
const sourceName = () => page.evaluate(() => document.querySelector('#source option[value=model]').textContent);
const openDrawer = async () => { if (await page.isHidden('#tree')) await page.click('#btnTree'); };

// 1. A document from before (one key, scadshape.doc) → the model "My model"
await page.goto(url);
await page.waitForSelector('body:not(.loading)');
await page.evaluate(async () => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); await window.__scadshape.storage.clear(); });
await page.reload();
await page.waitForSelector('body:not(.loading)');
await page.click('#btnContainer'); await page.waitForSelector('#featPanel:not([hidden])'); await page.click('#fpOk');
await page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.evaluate(async () => {
  const s = window.__scadshape.storage;
  const doc = s.get(`scadshape.doc.${s.get('scadshape.current')}`);
  await s.clear();
  localStorage.setItem('scadshape.doc', doc); // as it used to be stored: moved to IndexedDB at start
});
await page.reload();
await page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
assert.deepEqual(await feats(), ['sketch', 'container']);
assert.equal(await page.evaluate(() => localStorage.getItem('scadshape.doc') ?? window.__scadshape.storage.get('scadshape.doc')), null, 'old key removed');
assert.equal(await sourceName(), 'My model');
await openDrawer();
assert.equal(await page.textContent('#projName'), 'My model');

// 2. New model → empty, "My model 2"; rename to Jar
await page.click('#btnProjects'); await page.waitForSelector('#projDlg[open]');
await page.click('#projNew');
assert.deepEqual(await feats(), []); assert.equal(await sourceName(), 'My model 2');
await openDrawer(); await page.click('#btnProjects');
await page.locator('#projList li', { hasText: 'My model 2' }).locator('button[aria-label="Rename"]').click();
await page.fill('#projList input.projname', 'Jar'); await page.press('#projList input.projname', 'Enter');
assert.equal(await sourceName(), 'Jar');
await page.screenshot({ path: `${out}/m-list.png` });

// 3. Back to the first model
await page.locator('#projList .projopen', { hasText: /^My model/ }).click();
await page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
assert.deepEqual(await feats(), ['sketch', 'container']); assert.equal(await sourceName(), 'My model');

// 4. Save as a file and open it again → new model "My model 2"? no: the name no longer exists → "My
// model 2"
await openDrawer(); await page.click('#btnProjects');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#projExport')]);
assert.equal(dl.suggestedFilename(), 'My model.scadshape.json');
const path = `${out}/${dl.suggestedFilename()}`; await dl.saveAs(path);
assert.equal(JSON.parse(readFileSync(path, 'utf8')).format, 'scadshape');
await page.setInputFiles('#projFile', path);
await page.waitForFunction(() => document.querySelector('#source option[value=model]').textContent === 'My model 2');
assert.deepEqual(await feats(), ['sketch', 'container']);

// 5. Delete Jar; three → two models left. The export's file name = the model's name.
await openDrawer(); await page.click('#btnProjects');
assert.equal(await page.locator('#projList li').count(), 3);
await page.locator('#projList li', { hasText: 'Jar' }).locator('button[aria-label="Delete"]').click();
assert.equal(await page.locator('#projList li').count(), 2);
await page.click('#projDlg form button');
await page.click('#btnExport'); assert.equal(await page.inputValue('#exName'), 'My model 2');
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
