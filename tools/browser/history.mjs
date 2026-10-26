// Undo/redo in part mode: a new feature, deletion, and that the history is reset when switching
// models.
// node history.mjs [url] [outdir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US' });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', d => d.accept());
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const feats = () => page.evaluate(() => window.__scadshape.doc.features.map(f => f.type).join(','));
const disabled = id => page.evaluate(id => document.getElementById(id).disabled, id);
await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); });
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));
assert.ok(await disabled('btnDocUndo')); assert.ok(await disabled('btnDocRedo'));

// The container goes in as its parts: box, cavity, lid sketch, lid, lip, inside of the lip.
const BOX = 'sketch,extrude,extrude,sketch,extrude,extrude,extrude';
await page.click('#btnContainer'); await page.waitForSelector('#featPanel:not([hidden])'); await page.click('#fpOk');
assert.equal(await feats(), BOX);
await page.click('#btnDocUndo'); assert.equal(await feats(), 'sketch');
await page.click('#btnDocUndo'); assert.equal(await feats(), '');
assert.ok(await disabled('btnDocUndo'));
await page.click('#btnDocRedo'); await page.click('#btnDocRedo'); assert.equal(await feats(), BOX);
assert.ok(await disabled('btnDocRedo'));
await page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });

// Delete the lid sketch via the ⋯ menu (the lid's parts go with it) and undo
await page.click('#btnTree');
await page.locator('#featureList li', { hasText: 'Lid sketch' }).locator('button.icon').click();
await page.waitForSelector('#featMenu[open]');
await page.click('#featMenu [data-fm="delete"]');
await page.waitForFunction(() => window.__scadshape.doc.features.length === 3);
await page.click('#btnTree');
await page.click('#btnDocUndo'); assert.equal(await feats(), BOX);
await page.screenshot({ path: `${out}/h-undo.png` });

// New model: the history starts over
await page.click('#btnTree'); await page.click('#btnProjects'); await page.click('#projNew');
assert.ok(await disabled('btnDocUndo')); assert.ok(await disabled('btnDocRedo'));
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
