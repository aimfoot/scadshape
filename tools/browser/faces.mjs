// Sketch on a face: pick a face in 3D (top, front, right side), the offset follows
// the variable, the model's outline shows in the sketch and can be snapped to.
// node faces.mjs [url] [outdir]
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
const S = () => page.evaluate(() => ({ status: document.querySelector('#status').textContent, solids: window.__scadshape.model.solids, errors: [...window.__scadshape.model.errors.values()] }));
const waitRendered = async () => {
  await page.waitForTimeout(450);
  await page.waitForFunction(() => !/Rendering|Loading/.test(document.querySelector('#status').textContent) && !document.querySelector('#btnRender').textContent.includes('Cancel'), null, { timeout: 30000 });
  return S();
};
const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
const drag = async (a, b) => {
  const ca = await C(a), cb = await C(b);
  await touch('touchStart', [ca]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: ca.x + ((cb.x - ca.x) * i) / 8, y: ca.y + ((cb.y - ca.y) * i) / 8 }]);
  await touch('touchEnd', []);
};
const tapSk = async p => { const c = await C(p); await touch('touchStart', [c]); await touch('touchEnd', []); };
const tapWorld = async (x, y, z) => {
  const p = await page.evaluate(([x, y, z]) => window.__scadshape.viewer.screenOfWorld(x, y, z), [x, y, z]);
  const r = await page.evaluate(() => document.querySelector('#viewport canvas').getBoundingClientRect().toJSON());
  const at = { x: r.left + p.x, y: r.top + p.y };
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, at), 'CANVAS', `skymd: ${x},${y},${z}`);
  await touch('touchStart', [at]); await touch('touchEnd', []);
};
const lastSketch = () => page.evaluate(() => { const fs = window.__scadshape.doc.features.filter(f => f.type === 'sketch'); const f = fs[fs.length - 1]; return { plane: f.plane, offset: f.offset, outward: f.outward, id: f.id, face: f.face, faceRef: f.faceRef }; });
const pickFace = async (x, y, z) => {
  await page.click('#btnNewSketch');
  assert.equal(await page.isDisabled('#btnPickFace'), false);
  await page.click('#btnPickFace');
  await page.waitForSelector('#faceBar:not([hidden])');
  await tapWorld(x, y, z);
  await page.waitForFunction(() => document.body.dataset.mode === 'sketch');
  await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
};

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));
// Without a model no face can be picked.
await page.click('#btnNewSketch');
assert.equal(await page.isDisabled('#btnPickFace'), true);
await page.click('#planeDlg form[method=dialog] button');

await page.click('#btnParams');
await page.fill('#paramName', 't'); await page.fill('#paramExpr', '10'); await page.click('#paramAdd button[type=submit]');
await page.click('#paramsDlg form[method=dialog] button');
// Plate 40 × 20 × t
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.click('[data-tool="rect"]');
await drag({ x: 0, y: 0 }, { x: 40, y: 20 });
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', 't'); await page.click('#fpOk');
let st = await waitRendered();
assert.equal(st.solids, 1);

// Tap beside the model: no face, face picking continues; Cancel ends it.
await page.click('#btnNewSketch'); await page.click('#btnPickFace');
const r0 = await page.evaluate(() => document.querySelector('#viewport canvas').getBoundingClientRect().toJSON());
await touch('touchStart', [{ x: r0.left + 30, y: r0.bottom - 80 }]); await touch('touchEnd', []);
await page.waitForFunction(() => /No face/.test(document.body.textContent));
assert.equal(await page.isVisible('#faceBar'), true);
await page.screenshot({ path: `${out}/faces-pick.png` });
await page.click('#faceCancel');
assert.equal(await page.isVisible('#faceBar'), false);

// 1. The top: XY + t, outline with four corners.
await pickFace(20, 10, 10);
let sk = await lastSketch();
assert.deepEqual([sk.plane, sk.offset, sk.outward], ['XY', 't', 'normal']);
assert.match(await page.textContent('#sketchTitle'), /Top \+t/);
const ref = await page.evaluate(() => window.__scadshape.editor.reference);
assert.equal(ref.segments.length, 4); assert.equal(ref.snaps.length, 4);
// Rectangle from the plate's corner (snap to the model) inward.
await page.click('[data-tool="rect"]');
await drag({ x: 39.3, y: 19.4 }, { x: 30, y: 12 });
const corner = await page.evaluate(() => Object.values(window.__scadshape.editor.sketch.points).some(p => Math.abs(p.x - 40) < 1e-6 && Math.abs(p.y - 20) < 1e-6));
assert.ok(corner, 'the corner snapped to the plate\'s corner');
// Dimension to the model's edge: tap the edge (y = 0) with Select → locked construction line, then
// point + edge → Dimension.
await page.click('[data-tool="select"]');
{
  const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
  const tapAt = async p => { const c = await C(p); await touch('touchStart', [c]); await touch('touchEnd', []); };
  await tapAt({ x: 20, y: 0 });
  const edge = await page.evaluate(() => { const sk = window.__scadshape.editor.sketch; const e = Object.values(sk.entities).at(-1); return { c: e.construction, a: sk.points[e.p1], b: sk.points[e.p2], fixed: sk.constraints.filter(c => c.type === 'fix').length }; });
  assert.ok(edge.c && edge.fixed === 2 && Math.abs(edge.a.y) < 1e-6 && Math.abs(edge.b.y) < 1e-6, JSON.stringify(edge));
  await tapAt({ x: 30, y: 12 });
  const labels = await page.$$eval('#ctxbar button', bs => bs.map(b => b.textContent.slice(1)));
  const i = labels.indexOf('Dimension'); assert.ok(i >= 0, labels.join());
  await page.locator('#ctxbar button').nth(i).click();
  await page.waitForSelector('#dimDlg[open]');
  assert.equal(await page.textContent('#dimTitle'), 'Point–line distance');
  await page.fill('#dimValue', '8'); await page.click('#dimDlg button[type=submit]');
  const moved = await page.evaluate(() => Object.values(window.__scadshape.editor.sketch.points).some(p => Math.abs(p.x - 30) < 1e-6 && Math.abs(p.y - 8) < 1e-6));
  assert.ok(moved, 'the corner should be 8 mm from the plate\'s edge');
}
await page.screenshot({ path: `${out}/faces-sketch.png` });
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', '5'); await page.click('#fpOk');
st = await waitRendered();
assert.deepEqual(st.errors, []);
const zmax = () => page.evaluate(() => { const p = window.__scadshape.viewer.meshPositions; let m = -Infinity; for (let i = 2; i < p.length; i += 3) m = Math.max(m, p[i]); return m; });
assert.ok(Math.abs((await zmax()) - 15) < 1e-3, `zmax ${await zmax()}`);
// Change t → the raised part follows.
await page.click('#btnParams');
await page.fill('#paramList input', '6'); await page.press('#paramList input', 'Enter');
await page.dispatchEvent('#paramList input', 'change');
await page.click('#paramsDlg form[method=dialog] button');
await waitRendered();
assert.ok(Math.abs((await zmax()) - 11) < 1e-3, `zmax after t=6: ${await zmax()}`);

// 2. The front (y = 0, normal −Y): the Front plane, offset 0.
await pickFace(10, 0, 3);
sk = await lastSketch();
assert.deepEqual([sk.plane, sk.offset ?? '0', sk.outward], ['XZ', '0', 'normal']);
await page.click('#btnDone');
// 3. Right side (x = 40): the Right plane + 40.
await pickFace(40, 5, 3);
sk = await lastSketch();
assert.deepEqual([sk.plane, sk.offset, sk.outward], ['YZ', '40', 'normal']);
await page.screenshot({ path: `${out}/faces-right.png` });
await page.click('#btnDone');

// 4. Slanted face: wedge in the Right plane behind the plate, the slope has the normal (0, 1,
// 2)/√5.
await page.click('#btnNewSketch'); await page.click('[data-plane="YZ"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.click('[data-tool="line"]');
await tapSk({ x: 30, y: 0 }); await tapSk({ x: 50, y: 0 }); await tapSk({ x: 30, y: 10 }); await tapSk({ x: 30, y: 0 });
if (await page.isVisible('#btnFinish')) await page.click('#btnFinish');
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', 't * 5'); await page.click('#fpOk');
st = await waitRendered();
assert.deepEqual(st.errors, []);
await page.click('[data-view="iso"]');
await pickFace(15, 40, 5);
sk = await lastSketch();
assert.ok(sk.face, 'slanted face → own plane');
assert.ok(sk.faceRef?.entity, `follows the wedge's slope: ${JSON.stringify(sk.faceRef)}`);
assert.match(await page.textContent('#sketchTitle'), /Slanted face/);
const n = await page.evaluate(() => { const f = window.__scadshape.editor.sketch.face; const [u, v] = [f.u, f.v]; return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; });
assert.ok(Math.abs(n[0]) < 1e-6 && Math.abs(n[1] - 1 / Math.sqrt(5)) < 1e-6 && Math.abs(n[2] - 2 / Math.sqrt(5)) < 1e-6, String(n));
const sref = await page.evaluate(() => window.__scadshape.editor.reference);
assert.equal(sref.segments.length, 4);
await page.click('[data-tool="circle"]');
const L = Math.sqrt(500);
await drag({ x: 20, y: L / 2 }, { x: 24, y: L / 2 });
await page.screenshot({ path: `${out}/faces-slanted-sketch.png` });
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', '3'); await page.click('#fp-op [data-value="remove"]');
assert.equal(await page.evaluate(() => window.__scadshape.panel.f.direction), 'reverse', 'remove cuts into the wedge');
await page.click('#fpOk');
st = await waitRendered();
assert.deepEqual(st.errors, []);
await page.screenshot({ path: `${out}/faces-slanted-3d.png` });
// t = 6 → 8: the wedge becomes 40 long and the sketch on the slope follows (origin x = 5t).
const originX = () => page.evaluate(() => { const m = /multmatrix\(\[\[[^\]]*?, ([-\d.e]+)\]/.exec(window.__scadshape.model.code); return m && Number(m[1]); });
assert.equal(await originX(), 30);
await page.click('#btnParams');
await page.fill('#paramList input', '8');
await page.dispatchEvent('#paramList input', 'change');
await page.click('#paramsDlg form[method=dialog] button');
st = await waitRendered();
assert.deepEqual(st.errors, []);
assert.equal(await originX(), 40);
await page.screenshot({ path: `${out}/faces-slanted-follow.png` });

await browser.close();
assert.deepEqual(errors, []);
console.log('faces ok');
