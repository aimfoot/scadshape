// Phase 3 test: features (extrude, revolve), region and axis picking in 3D, variables, rollback.
// node features.mjs [url] [outdir]
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
page.on('dialog', d => d.accept()); // confirm()
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
const S = () => page.evaluate(() => ({ status: document.querySelector('#status').textContent, solids: window.__scadshape.model.solids, errors: [...window.__scadshape.model.errors.values()] }));
const waitRendered = async () => {
  await page.waitForTimeout(450); // the preview waits 350 ms for more key presses
  await page.waitForFunction(() => !/Rendering|Loading/.test(document.querySelector('#status').textContent) && !document.querySelector('#btnRender').textContent.includes('Cancel'), null, { timeout: 30000 });
  return S();
};

// 0. Migration: a v1 document with the phone's sketches
const phone = JSON.parse(readFileSync(new URL('../../tests/phone-sketches.json', import.meta.url), 'utf8'));
const v1 = { v: 1, previewHeight: 6, features: Object.entries(phone).slice(1, 3).map(([k, sk], i) => ({ ...sk, constraints: [], nextId: 500, type: 'sketch', id: 'old' + i, name: k.split('#')[0] + ' ' + i, plane: 'XY' })) };
await page.goto(url);
await page.waitForSelector('body:not(.loading)');
await page.evaluate(async d => { localStorage.clear(); await window.__scadshape.storage.clear(); localStorage.setItem('scadshape.doc', JSON.stringify(d)); }, v1);
await page.reload();
let st = await waitRendered();
const types = await page.evaluate(() => window.__scadshape.doc.features.map(f => f.type + ':' + (f.depth ?? '')));
assert.deepEqual(types, ['sketch:', 'extrude:6', 'sketch:', 'extrude:6'], JSON.stringify(types));
assert.equal(st.solids, 2); assert.match(st.status, /triangles/);
console.log('migration v1:', types.join(' '), '·', st.status);

// Start over with an empty document
await page.evaluate(async () => { localStorage.clear(); await window.__scadshape.storage.clear(); });
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));

// 1. Variables
await page.click('#btnParams');
for (const [n, e] of [['width', '40'], ['height', 'width/4']]) {
  await page.fill('#paramName', n); await page.fill('#paramExpr', e); await page.click('#paramAdd button[type=submit]');
}
assert.deepEqual(await page.$$eval('#paramList .param small', s => s.map(x => x.textContent)), ['= 40', '= 10']);
await page.fill('#paramName', '2bad'); await page.fill('#paramExpr', '1'); await page.click('#paramAdd button[type=submit]');
assert.equal(await page.isVisible('#paramError'), true);
await page.click('#paramsDlg form[method=dialog] button');
console.log('variables: width = 40, height = width/4');

// 2. Sketch: rectangle with width = variable, circle inside
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
const tap = async p => { const c = await C(p); await touch('touchStart', [c]); await touch('touchEnd', []); };
const drag = async (a, b) => {
  const ca = await C(a), cb = await C(b);
  await touch('touchStart', [ca]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: ca.x + ((cb.x - ca.x) * i) / 8, y: ca.y + ((cb.y - ca.y) * i) / 8 }]);
  await touch('touchEnd', []);
};
const ctxClick = async label => { const labels = await page.$$eval('#ctxbar button', bs => bs.map(b => b.textContent.slice(1))); const i = labels.indexOf(label); assert.ok(i >= 0, `${label}: ${labels}`); await page.locator('#ctxbar button').nth(i).click(); };
await page.click('[data-tool="rect"]');
await drag({ x: 0, y: 0 }, { x: 30, y: 20 });
await page.click('[data-tool="select"]');
await tap({ x: 15, y: 0 });
await ctxClick('Dimension');
await page.waitForSelector('#dimDlg[open]');
await page.fill('#dimValue', '');
await page.locator('#dimDlg .chips button', { hasText: 'width' }).click();
assert.equal(await page.inputValue('#dimValue'), 'width');
await page.click('#dimDlg button[type=submit]');
const hasPt = (x, y) => page.evaluate(([x, y]) => Object.values(window.__scadshape.editor.sketch.points).some(p => Math.abs(p.x - x) < 1e-4 && Math.abs(p.y - y) < 1e-4), [x, y]);
assert.ok(await hasPt(40, 0), 'the width follows the variable');
await page.click('[data-tool="circle"]');
await tap({ x: 20, y: 10 }); await tap({ x: 25, y: 10 });
await page.click('#btnDone');
console.log('sketch: 40 × 20 with a circular hole');

// 3. Extrude with height = variable; pick regions by tapping in 3D
await page.click('#btnExtrude');
await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', 'height');
st = await waitRendered();
assert.equal(st.solids, 1, JSON.stringify(st));
assert.match(await page.textContent('#fpRegions'), /1 of 2 regions \(default\)/);
/** Tap a sketch point in the 3D view; checks that the canvas (not the panel) is on top there. */
const tap3d = async (plane, uv) => {
  const p = await page.evaluate(([plane, uv]) => window.__scadshape.viewer.screenOf(plane, uv), [plane, uv]);
  const r = await page.evaluate(() => document.querySelector('#viewport canvas').getBoundingClientRect().toJSON());
  const at = { x: r.left + p.x, y: r.top + p.y };
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, at);
  assert.equal(top, 'CANVAS', `the point ${JSON.stringify(uv)} is hidden (${top})`);
  await touch('touchStart', [at]); await touch('touchEnd', []);
};
await tap3d('XY', { x: 20, y: 10 }); // tap in the hole → pick the disc too
assert.match(await page.textContent('#fpRegions'), /2 of 2 regions/);
await page.screenshot({ path: `${out}/f-panel.png` });
await tap3d('XY', { x: 20, y: 10 }); // tap again → deselect
assert.match(await page.textContent('#fpRegions'), /1 of 2 regions ·/);
await page.click('#fpOk');
st = await waitRendered();
let codeTxt = await page.evaluate(() => window.__scadshape.model.code);
assert.match(codeTxt, /^height = width\/4;$/m); assert.match(codeTxt, /linear_extrude\(height = \(height\)\)/);
assert.equal(st.errors.length, 0); assert.match(st.status, /triangles/);
console.log('extrude:', st.status);

// 4. Remove: circle through the plate (symmetric)
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.click('[data-tool="circle"]');
await tap({ x: 5, y: 5 }); await tap({ x: 8, y: 5 });
await page.click('#btnDone');
await page.click('#btnExtrude');
await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fp-op [data-value="remove"]'); await page.click('#fp-direction [data-value="symmetric"]');
await page.fill('#fp-depth', '50');
await page.click('#fpOk');
st = await waitRendered();
codeTxt = await page.evaluate(() => window.__scadshape.model.code);
assert.match(codeTxt, /difference\(\)/); assert.match(codeTxt, /translate\(\[0, 0, -50 \/ 2\]\)/); assert.equal(st.errors.length, 0);
console.log('remove:', st.status);

// 5. Revolve in the front plane around a construction line picked in 3D
await page.click('#btnNewSketch'); await page.click('[data-plane="XZ"]');
await page.click('[data-tool="line"]');
await tap({ x: 60, y: -5 }); await tap({ x: 60, y: 25 }); await page.click('#btnFinish');
await page.click('[data-tool="select"]');
await tap({ x: 60, y: 10 }); await page.click('#btnConstruction');
await page.click('[data-tool="rect"]');
await drag({ x: 65, y: 0 }, { x: 70, y: 15 });
await page.click('#btnDone');
await page.click('#btnRevolve');
await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fp-axis [data-axis="line"]');
await waitRendered();
await tap3d('XZ', { x: 60, y: 20 }); // tap the construction line
const axis = await page.evaluate(() => window.__scadshape.panel.f.axis);
assert.equal(axis.kind, 'line', JSON.stringify(axis));
st = await waitRendered();
assert.equal(st.errors.length, 0, st.errors.join());
await page.screenshot({ path: `${out}/f-revolve.png` });
await page.click('#fpOk');
st = await waitRendered();
assert.equal(st.solids, 3); assert.match(st.status, /triangles/);
console.log('revolve:', st.status);

// 6. Rollback and suppress via the menu
await page.click('#btnTree');
const menu = async (name, action) => {
  const i = await page.$$eval('#featureList li button.feature span', s => s.map(x => x.textContent)).then(n => n.indexOf(name));
  await page.locator('#featureList li').filter({ has: page.locator('button.feature') }).nth(i).locator('button.icon').click();
  await page.click(`[data-fm="${action}"]`);
};
await menu('Extrude 1', 'rollback');
st = await waitRendered();
assert.equal(st.solids, 1); assert.equal(await page.locator('#featureList li.rolled').count(), 4);
await page.screenshot({ path: `${out}/f-rollback.png` });
await page.click('.rollbar button');
await menu('Revolve 1', 'suppress');
st = await waitRendered();
assert.equal(st.solids, 2);
await menu('Revolve 1', 'suppress');
st = await waitRendered(); assert.equal(st.solids, 3);
console.log('rollback + suppress ok');

// 7. Change a variable → the sketch and the height follow
await page.click('#btnParams');
const inp = page.locator('#paramList .param input').first();
await inp.fill('60'); await inp.dispatchEvent('change');
await page.click('#paramsDlg form[method=dialog] button');
st = await waitRendered();
const w = await page.evaluate(() => { const sk = window.__scadshape.doc.features[0]; return Math.max(...Object.values(sk.points).map(p => p.x)); });
assert.ok(Math.abs(w - 60) < 1e-4, `width ${w}`);
assert.match(await page.evaluate(() => window.__scadshape.model.code), /^width = 60;$/m);
console.log('variable change: width 40 → 60 ·', st.status);
await page.screenshot({ path: `${out}/f-final.png` });

// 8. Saved after reload
await page.reload();
st = await waitRendered();
assert.equal(st.solids, 3); assert.equal(await page.evaluate(() => window.__scadshape.doc.params.length), 2);
console.log('after reload:', st.status);

// 9. Portrait mode: the panel as a bottom sheet
const p2 = await (await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US' })).newPage();
await p2.route('**/api/**', r => r.fulfill({ status: 204 }));
const docJson = await page.evaluate(() => { const s = window.__scadshape.storage; return s.get('scadshape.doc.' + s.get('scadshape.current')); });
await p2.goto(url); await p2.waitForSelector('body:not(.loading)'); await p2.evaluate(async d => { const s = window.__scadshape.storage; s.set('scadshape.doc.' + s.get('scadshape.current'), d); await s.saved(); }, docJson); await p2.reload();
await p2.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
await p2.click('#btnTree'); await p2.locator('button.feature', { hasText: 'Extrude 1' }).click();
await p2.waitForSelector('#featPanel:not([hidden])');
await p2.waitForTimeout(800);
await p2.screenshot({ path: `${out}/f-portrait.png` });

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
