// Modeller: det gamla enda dokumentet flyttas till en modell; ny, byt namn, byt modell, spara/öppna fil, ta bort.
//   node projects.mjs [url] [utkatalog]
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
page.on('dialog', d => d.accept());
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const feats = () => page.evaluate(() => window.__scadshape.doc.features.map(f => f.type));
const sourceName = () => page.evaluate(() => document.querySelector('#source option[value=model]').textContent);
const openDrawer = async () => { if (await page.isHidden('#tree')) await page.click('#btnTree'); };

// 1. Ett dokument från förr (en nyckel, scadshape.doc) → modellen "Min modell"
await page.goto(url);
await page.waitForSelector('body:not(.loading)');
await page.evaluate(async () => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'sv'); await window.__scadshape.storage.clear(); });
await page.reload();
await page.waitForSelector('body:not(.loading)');
await page.click('#btnContainer'); await page.waitForSelector('#featPanel:not([hidden])'); await page.click('#fpOk');
await page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.evaluate(async () => {
  const s = window.__scadshape.storage;
  const doc = s.get(`scadshape.doc.${s.get('scadshape.current')}`);
  await s.clear();
  localStorage.setItem('scadshape.doc', doc); // som det låg förr: flyttas till IndexedDB vid start
});
await page.reload();
await page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
assert.deepEqual(await feats(), ['sketch', 'container']);
assert.equal(await page.evaluate(() => localStorage.getItem('scadshape.doc') ?? window.__scadshape.storage.get('scadshape.doc')), null, 'gamla nyckeln borttagen');
assert.equal(await sourceName(), 'Min modell');
await openDrawer();
assert.equal(await page.textContent('#projName'), 'Min modell');

// 2. Ny modell → tom, "Min modell 2"; byt namn till Burk
await page.click('#btnProjects'); await page.waitForSelector('#projDlg[open]');
await page.click('#projNew');
assert.deepEqual(await feats(), []); assert.equal(await sourceName(), 'Min modell 2');
await openDrawer(); await page.click('#btnProjects');
await page.locator('#projList li', { hasText: 'Min modell 2' }).locator('button[aria-label="Byt namn"]').click();
await page.fill('#projList input.projname', 'Burk'); await page.press('#projList input.projname', 'Enter');
assert.equal(await sourceName(), 'Burk');
await page.screenshot({ path: `${out}/m-list.png` });

// 3. Tillbaka till första modellen
await page.locator('#projList .projopen', { hasText: /^Min modell/ }).click();
await page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
assert.deepEqual(await feats(), ['sketch', 'container']); assert.equal(await sourceName(), 'Min modell');

// 4. Spara som fil och öppna den igen → ny modell "Min modell 2"? nej: namnet finns inte längre → "Min modell 2"
await openDrawer(); await page.click('#btnProjects');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#projExport')]);
assert.equal(dl.suggestedFilename(), 'Min modell.scadshape.json');
const path = `${out}/${dl.suggestedFilename()}`; await dl.saveAs(path);
assert.equal(JSON.parse(readFileSync(path, 'utf8')).format, 'scadshape');
await page.setInputFiles('#projFile', path);
await page.waitForFunction(() => document.querySelector('#source option[value=model]').textContent === 'Min modell 2');
assert.deepEqual(await feats(), ['sketch', 'container']);

// 5. Ta bort Burk; tre → två modeller kvar. Exportens filnamn = modellens namn.
await openDrawer(); await page.click('#btnProjects');
assert.equal(await page.locator('#projList li').count(), 3);
await page.locator('#projList li', { hasText: 'Burk' }).locator('button[aria-label="Ta bort"]').click();
assert.equal(await page.locator('#projList li').count(), 2);
await page.click('#projDlg form button');
await page.click('#btnExport'); assert.equal(await page.inputValue('#exName'), 'Min modell 2');
await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
