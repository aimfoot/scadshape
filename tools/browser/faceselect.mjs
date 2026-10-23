// Faces picked straight in the 3D view: a tap selects (highlights) a face, a tap beside clears it,
// Extrude/Sketch in the toolbar act on the selected face, and a long press opens the face menu.
// node faceselect.mjs [url] [outdir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US' });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
const tapSk = async p => { const c = await C(p); await touch('touchStart', [c]); await touch('touchEnd', []); };
const waitRendered = async () => {
  await page.waitForTimeout(450);
  await page.waitForFunction(() => !/Rendering|Loading/.test(document.querySelector('#status').textContent) && !/Cancel/.test(document.querySelector('#btnRender').textContent), null, { timeout: 60000 });
  return page.evaluate(() => [...window.__scadshape.model.errors.values()]);
};
const screenOf = async (x, y, z) => {
  const p = await page.evaluate(([x, y, z]) => window.__scadshape.viewer.screenOfWorld(x, y, z), [x, y, z]);
  const r = await page.evaluate(() => document.querySelector('#viewport canvas').getBoundingClientRect().toJSON());
  const at = { x: r.left + p.x, y: r.top + p.y };
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, at), 'CANVAS', `hidden: ${x},${y},${z}`);
  return at;
};
const tapWorld = async (x, y, z) => { const at = await screenOf(x, y, z); await touch('touchStart', [at]); await touch('touchEnd', []); };
const holdWorld = async (x, y, z) => { const at = await screenOf(x, y, z); await touch('touchStart', [at]); await page.waitForTimeout(700); await touch('touchEnd', []); };
const state = () => page.evaluate(() => ({ face: window.__scadshape.face, lit: window.__scadshape.viewer.highlighted, panel: !!window.__scadshape.panel }));
const bbox = () => page.evaluate(() => {
  const p = window.__scadshape.viewer.meshPositions, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) { mn[i % 3] = Math.min(mn[i % 3], p[i]); mx[i % 3] = Math.max(mx[i % 3], p[i]); }
  return [...mn, ...mx].map(v => Math.round(v * 1000) / 1000);
});

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); });
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));
// Plate 40 × 20 × 10
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.click('[data-tool="rect"]'); await tapSk({ x: 0, y: 0 }); await tapSk({ x: 40, y: 20 });
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', '10'); await page.click('#fpOk');
assert.deepEqual(await waitRendered(), []);
await page.click('[data-view="iso"]');

// 1. A tap on the top selects it (highlighted, a hint); a tap beside the model clears it.
await tapWorld(20, 10, 10);
let s = await state();
assert.ok(s.face && s.lit && !s.panel, JSON.stringify(s));
assert.ok(Math.abs(s.face.normal[2] - 1) < 1e-6, 'the top');
assert.match(await page.textContent('#partToast'), /Face selected/);
const beside = await page.evaluate(() => { const r = document.querySelector('#viewport canvas').getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height - 30 }; });
await touch('touchStart', [beside]); await touch('touchEnd', []);
s = await state();
assert.ok(!s.face && !s.lit, 'cleared');
console.log('tap selects, tap beside clears');

// 2. Selected top + Extrude in the toolbar → a face sketch, 5 mm up.
await tapWorld(20, 10, 10);
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
assert.match(await page.evaluate(() => document.querySelector('#fpSketch').selectedOptions[0]?.textContent ?? ''), /face/);
assert.ok(!(await state()).lit, 'the highlight goes when the panel opens');
await page.fill('#fp-depth', '5'); await page.click('#fpOk');
assert.deepEqual(await waitRendered(), []);
assert.deepEqual(await bbox(), [0, 0, 0, 40, 20, 15]);
console.log('selected top + Extrude: 15 mm high');

// 3. A long press on the front → the menu → Cut into the model, 3 mm.
await holdWorld(20, 0, 5);
await page.waitForSelector('#faceMenu[open]');
assert.ok((await state()).lit, 'the pressed face is highlighted');
await page.screenshot({ path: `${out}/faceselect-menu.png` });
await page.click('[data-face="cut"]');
await page.waitForSelector('#featPanel:not([hidden])');
assert.equal(await page.evaluate(() => window.__scadshape.panel.f.op), 'remove');
await page.fill('#fp-depth', '3'); await page.click('#fpOk');
assert.deepEqual(await waitRendered(), []);
assert.deepEqual(await bbox(), [0, 3, 0, 40, 20, 15]);
console.log('long press front → cut 3 mm');

// 4. A long press on the top → Sketch on this face → sketch mode on the top.
await holdWorld(20, 10, 15);
await page.waitForSelector('#faceMenu[open]');
await page.click('[data-face="sketch"]');
await page.waitForFunction(() => document.body.dataset.mode === 'sketch');
assert.match(await page.textContent('#sketchTitle'), /Top/);
await page.click('#btnDone');
await page.waitForFunction(() => document.body.dataset.mode === 'part');

// 5. Selected face + Sketch in the toolbar → straight into a sketch on it (no plane dialog).
await tapWorld(20, 10, 15);
await page.click('#btnNewSketch');
await page.waitForFunction(() => document.body.dataset.mode === 'sketch');
assert.equal(await page.evaluate(() => document.querySelector('#planeDlg').open), false);
assert.match(await page.textContent('#sketchTitle'), /Top/);
console.log('sketch on the selected face');

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
if (errors.length) process.exit(1);
