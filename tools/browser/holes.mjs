// Hole test: the point tool and the hole feature (point picking in 3D, types, sizes, editing).
// node holes.mjs [url] [outdir]
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
const S = () => page.evaluate(() => ({ status: document.querySelector('#status').textContent, solids: window.__scadshape.model.solids, errors: [...window.__scadshape.model.errors.values()], code: window.__scadshape.model.code }));
const waitRendered = async () => {
  await page.waitForTimeout(450);
  await page.waitForFunction(() => !/Rendering|Loading/.test(document.querySelector('#status').textContent) && !document.querySelector('#btnRender').textContent.includes('Cancel'), null, { timeout: 30000 });
  return S();
};
const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
const tap = async p => { const c = await C(p); await touch('touchStart', [c]); await touch('touchEnd', []); };
const drag = async (a, b) => {
  const ca = await C(a), cb = await C(b);
  await touch('touchStart', [ca]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: ca.x + ((cb.x - ca.x) * i) / 8, y: ca.y + ((cb.y - ca.y) * i) / 8 }]);
  await touch('touchEnd', []);
};
const tap3d = async (plane, uv) => {
  const p = await page.evaluate(([plane, uv]) => window.__scadshape.viewer.screenOf(plane, uv), [plane, uv]);
  const r = await page.evaluate(() => document.querySelector('#viewport canvas').getBoundingClientRect().toJSON());
  const at = { x: r.left + p.x, y: r.top + p.y };
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, at), 'CANVAS', `hidden: ${JSON.stringify(uv)}`);
  await touch('touchStart', [at]); await touch('touchEnd', []);
};

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));
// Variable for the plate's thickness
await page.click('#btnParams');
await page.fill('#paramName', 't'); await page.fill('#paramExpr', '10'); await page.click('#paramAdd button[type=submit]');
await page.click('#paramsDlg form[method=dialog] button');

// 1. Plate 40 × 20 × t
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.click('[data-tool="rect"]');
await drag({ x: 0, y: 0 }, { x: 40, y: 20 });
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', 't'); await page.click('#fpOk');
let st = await waitRendered();
assert.equal(st.solids, 1);

// 2. Hole sketch: two points; one gets a dimension to a line
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.click('[data-tool="point"]');
assert.match(await page.textContent('#hintText'), /Point: tap/);
await tap({ x: 10, y: 10 }); await tap({ x: 30, y: 10 });
await tap({ x: 30, y: 10 }); // the same spot again → no new point
const standalone = () => page.evaluate(() => Object.values(window.__scadshape.editor.sketch.points).filter(p => p.standalone).length);
assert.equal(await standalone(), 2);
// Also draw a reference line and dimension point → line
await page.click('[data-tool="line"]');
await tap({ x: -10, y: 0 }); await tap({ x: -10, y: 20 }); await page.click('#btnFinish');
await page.click('[data-tool="select"]');
await tap({ x: 10, y: 10 }); await tap({ x: -10, y: 5 });
const labels = await page.$$eval('#ctxbar button', bs => bs.map(b => b.textContent.slice(1)));
assert.ok(labels.includes('Dimension') && labels.includes('On line'), String(labels));
await page.locator('#ctxbar button').nth(labels.indexOf('Dimension')).click();
await page.waitForSelector('#dimDlg[open]'); await page.fill('#dimValue', '18'); await page.click('#dimDlg button[type=submit]');
// Both the point and the line are free – the solver may move both; the distance should become 18.
const gap = await page.evaluate(() => {
  const sk = window.__scadshape.editor.sketch;
  const l = Object.values(sk.entities).find(e => e.type === 'line');
  const lx = sk.points[l.p1].x;
  return Math.min(...Object.values(sk.points).filter(p => p.standalone).map(p => Math.abs(p.x - lx)));
});
assert.ok(Math.abs(gap - 18) < 1e-6, `distance ${gap}`);
await page.screenshot({ path: `${out}/h-sketch.png` });
await page.click('#btnDone');
console.log('points: 2 standalone, one dimensioned 18 mm from the line');

// 3. Hole: standard M3 through all standalone points
await page.click('#btnHole'); await page.waitForSelector('#featPanel:not([hidden])');
st = await waitRendered();
assert.match(await page.textContent('#fpRegions'), /2 of 2 points \(all standalone\)/);
assert.equal(await page.inputValue('#fp-diameter'), '3,4');
assert.equal(st.errors.length, 0, st.errors.join());
await tap3d('XY', { x: 30, y: 10 });
assert.match(await page.textContent('#fpRegions'), /1 of 2 points ·/);
await tap3d('XY', { x: 30, y: 10 });
assert.match(await page.textContent('#fpRegions'), /2 of 2 points ·/);

// 4. Counterbore from the top: start = t, drill downward
await page.click('#fp-kind [data-value="counterbore"]');
assert.equal(await page.isVisible('#fp-cbDiameter'), true);
await page.click('#fp-start'); await page.fill('#fp-start', '');
await page.locator('#fpFields .chips button', { hasText: 't' }).click();
assert.equal(await page.inputValue('#fp-start'), 't');
await page.click('#fp-direction [data-value="reverse"]');
st = await waitRendered();
assert.equal(st.errors.length, 0, st.errors.join());
assert.match(st.code, /translate\(\[p\[0\], p\[1\], \(t\)\]\) \{/); assert.match(st.code, /cylinder\(d = 6\.5/);
assert.doesNotMatch(st.code.split('module hole_1')[1], /mirror/);
await page.screenshot({ path: `${out}/h-panel.png` });

// 5. Screw size M5 fills in the dimensions
await page.selectOption('#fp-size', 'M5');
assert.deepEqual([await page.inputValue('#fp-diameter'), await page.inputValue('#fp-cbDiameter'), await page.inputValue('#fp-cbDepth')], ['5,5', '10', '5,4']);
await page.fill('#fp-diameter', '5,2'); await page.dispatchEvent('#fp-diameter', 'input');
assert.equal(await page.inputValue('#fp-size'), 'custom');
await page.click('#fpOk');
st = await waitRendered();
assert.equal(st.solids, 2); assert.equal(st.errors.length, 0); assert.match(st.status, /triangles/);
console.log('hole (counterbore Ø5.2):', st.status);

// 6. Edit from the tree: countersink
await page.click('#btnTree');
await page.locator('button.feature', { hasText: 'Hole 1' }).click();
await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fp-kind [data-value="countersink"]');
await page.click('#fpOk');
st = await waitRendered();
assert.match(st.code, /cylinder\(d1 = 5\.2, d2 = /); assert.equal(st.errors.length, 0);
assert.match(await page.locator('button.feature', { hasText: 'Hole 1' }).textContent(), /countersink · through/);
await page.screenshot({ path: `${out}/h-final.png` });
console.log('edited to countersink:', st.status);

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
