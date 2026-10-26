// .scad → sketches: open snap_box.scad, "Convert to sketches", volume check, edit a sketch.
// node convert.mjs [url] [outdir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US' });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const toasts = [];
await page.exposeFunction('__toast', t => toasts.push(t));
await page.addInitScript(() => new MutationObserver(() => { const t = document.querySelector('#partToast'); if (t && !t.hidden) window.__toast(t.textContent); }).observe(document, { subtree: true, childList: true, attributes: true }));

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); });
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));
assert.ok(await page.isHidden('#btnConvert'), 'Convert is in Code');

await page.click('#btnTree'); await page.click('#btnProjects');
const src = readFileSync(new URL('../../tests/fixtures/snap_box.scad', import.meta.url));
await page.setInputFiles('#projFile', { name: 'snap_box.scad', mimeType: 'application/octet-stream', buffer: src });
await page.waitForFunction(() => window.__scadshape.work === 'code' && window.__scadshape.doc.features[0]?.type === 'code');
assert.ok(await page.isVisible('#btnConvert'));
await page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });

await page.click('#btnConvert');
// The same model becomes sketches (in Draw)
await page.waitForFunction(() => window.__scadshape.work === 'draw' && window.__scadshape.doc.features.length > 1, null, { timeout: 60000 });
await page.waitForFunction(() => /\d+ triangles/.test(document.querySelector('#status').textContent) && !/Rendering|Converting/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
const st = await page.evaluate(() => ({ types: window.__scadshape.doc.features.map(f => f.type), errors: [...window.__scadshape.model.errors.values()], name: document.querySelector('#projName').textContent }));
assert.equal(st.name, 'snap_box'); assert.equal(st.errors.length, 0, st.errors.join());
const count = t => st.types.filter(x => x === t).length;
assert.deepEqual([count("sketch"), count("extrude"), count("revolve"), count("code")], [8, 6, 2, 1], st.types.join());
await page.waitForFunction(() => true);
for (let i = 0; i < 60 && !toasts.some(t => /Checked|Note/.test(t)); i++) await page.waitForTimeout(500);
assert.ok(toasts.some(t => /Checked: same volume/.test(t)), toasts.join(' | '));
assert.ok(toasts.some(t => /7 variables driving \d+ dimensions/.test(t)), toasts.join(' | '));
console.log(toasts.filter(t => /Done|Checked/.test(t)).join(' | '));
await page.screenshot({ path: `${out}/v-model.png` });

// The code's variables drive the model: a thicker wall makes the box wider (inner_x + 2*wall).
const outer = () => page.evaluate(() => { const xs = Object.values(window.__scadshape.doc.features[0].points).map(p => p.x); return Math.max(...xs) - Math.min(...xs); });
assert.deepEqual(await page.evaluate(() => window.__scadshape.doc.params.map(p => p.name)), ['inner_x', 'inner_y', 'inner_z', 'wall', 'r', 'lip_h', 'gap']);
assert.ok(Math.abs(await outer() - 64) < 1e-6);
await page.click('#btnParams');
await page.screenshot({ path: `${out}/v-params.png` });
const wall = page.getByLabel('Value of wall');
await wall.fill('3'); await wall.dispatchEvent('change');
await page.click('#paramsDlg form[method=dialog] button');
await page.waitForFunction(() => /\d+ triangles/.test(document.querySelector('#status').textContent) && !/Rendering/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
assert.ok(Math.abs(await outer() - 66) < 1e-6, String(await outer()));
assert.equal((await page.evaluate(() => [...window.__scadshape.model.errors.values()])).length, 0);
console.log('wall 2 → 3: outer width 64 → 66');

// Edit a sketch: the first one (the box's bottom) has regions and can be opened
if (await page.isHidden('#tree')) await page.click('#btnTree');
await page.screenshot({ path: `${out}/v-tree.png` });
await page.locator('#featureList button.feature').first().click();
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.waitForTimeout(400);
assert.match(await page.textContent('#loopInfo'), /closed region|closed regions/);
assert.match(await page.textContent('#loopInfo'), /Fully defined/, 'the rounded box: size and position from the code');
// Make the box 20 mm wider via the outer width dimension
const w = await page.evaluate(() => {
  const e = window.__scadshape.editor;
  const c = e.sketch.constraints.filter(c => c.type === 'pldistance').sort((a, b) => b.value - a.value)[0];
  const xs = () => Object.values(e.sketch.points).map(p => p.x);
  const before = Math.max(...xs()) - Math.min(...xs());
  e.setDimension(c.id, c.value + 20);
  return { before, after: Math.max(...xs()) - Math.min(...xs()), value: c.value };
});
assert.ok(Math.abs(w.after - w.before - 20) < 1e-6, JSON.stringify(w));
await page.screenshot({ path: `${out}/v-sketch.png` });
await page.click('#btnDone');
await page.waitForFunction(() => /\d+ triangles/.test(document.querySelector('#status').textContent) && !/Rendering/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
assert.equal((await page.evaluate(() => [...window.__scadshape.model.errors.values()])).length, 0);
console.log('outer width', w.before.toFixed(2), '→', w.after.toFixed(2));
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
