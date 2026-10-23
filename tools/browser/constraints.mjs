// Phase 2 test: constraints and dimensions with touch events (CDP) in headless Chromium.
// node constraints.mjs [url] [outdir]
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

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.click('#btnNewSketch');
await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
const tap = async p => { const c = await C(p); await touch('touchStart', [c]); await touch('touchEnd', []); };
const drag = async (a, b) => {
  const ca = await C(a), cb = await C(b);
  await touch('touchStart', [ca]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: ca.x + ((cb.x - ca.x) * i) / 8, y: ca.y + ((cb.y - ca.y) * i) / 8 }]);
  await touch('touchEnd', []);
};
const info = () => page.textContent('#loopInfo');
const pts = () => page.evaluate(() => Object.values(window.__scadshape.editor.sketch.points).map(p => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]));
const hasPt = async (x, y) => (await pts()).some(([px, py]) => Math.abs(px - x) < 1e-3 && Math.abs(py - y) < 1e-3);
const ctxLabels = () => page.$$eval('#ctxbar button', bs => bs.map(b => b.textContent.slice(1)));
const ctxClick = async label => { const i = (await ctxLabels()).indexOf(label); assert.ok(i >= 0, `${label} missing: ${await ctxLabels()}`); await page.locator('#ctxbar button').nth(i).click(); };
const setDim = async v => { await page.waitForSelector('#dimDlg[open]'); await page.fill('#dimValue', v); await page.click('#dimDlg button[type=submit]'); };

// 1. Rectangle from the origin
await page.click('[data-tool="rect"]');
await drag({ x: 0, y: 0 }, { x: 30, y: 20 });
assert.match(await info(), /2 degrees of freedom/, await info());
console.log('rectangle:', await info());

// 2. Dimensions: width 40, height 25/2+5
await page.click('[data-tool="select"]');
await tap({ x: 15, y: 0 });
assert.deepEqual(await ctxLabels(), ['Horizontal', 'Vertical', 'Dimension']);
await ctxClick('Dimension');
assert.equal(await page.inputValue('#dimValue'), '30');
await setDim('40');
assert.ok(await hasPt(40, 0), JSON.stringify(await pts()));
await tap({ x: 40, y: 10 });
await ctxClick('Dimension');
await setDim('25/2+5');
assert.ok(await hasPt(40, 17.5), JSON.stringify(await pts()));
assert.match(await info(), /Fully defined/);
console.log('dimensions:', await info());
await page.screenshot({ path: `${out}/c-rect.png` });

// 3. A redundant dimension is rejected
await tap({ x: 20, y: 17.5 });
await ctxClick('Dimension');
await page.waitForSelector('#toast:not([hidden])');
assert.match(await page.textContent('#toast'), /Redundant/);
assert.equal(await page.isVisible('#dimDlg'), false);
console.log('redundant:', await page.textContent('#toast'));
await tap({ x: 20, y: 60 }); // deselect (empty area)

// 4. Circle tangent to the right edge, radius 6
await page.click('[data-tool="circle"]');
await tap({ x: 60, y: 10 }); await tap({ x: 65, y: 10 });
await page.click('[data-tool="select"]');
await tap({ x: 60, y: 15 }); // the circle's edge
await tap({ x: 40, y: 5 }); // the right edge
assert.ok((await ctxLabels()).includes('Tangent'), String(await ctxLabels()));
await ctxClick('Tangent');
const circ = () => page.evaluate(() => { const sk = window.__scadshape.editor.sketch; const c = Object.values(sk.entities).find(e => e.type === 'circle'); return { x: sk.points[c.c].x, y: sk.points[c.c].y, r: c.r }; });
let c = await circ();
assert.ok(Math.abs(Math.abs(c.x - 40) - c.r) < 1e-4, JSON.stringify(c));
await tap({ x: c.x, y: c.y + c.r });
await ctxClick('Dimension');
await page.waitForSelector('#dimDlg[open]');
assert.equal(await page.textContent('#dimTitle'), 'Diameter');
await page.click('[data-rd="radius"]');
await setDim('6');
c = await circ();
assert.ok(Math.abs(c.r - 6) < 1e-6 && Math.abs(c.x - 46) < 1e-4, JSON.stringify(c));
console.log('tangent + radius:', JSON.stringify(c));

// 5. Drag the circle's center: stays tangent
await drag({ x: c.x, y: c.y }, { x: c.x + 10, y: c.y + 4 });
const c2 = await circ();
assert.ok(Math.abs(c2.x - 46) < 1e-3 && c2.y > c.y + 2, 'the center slides along the edge (grid snap): ' + JSON.stringify(c2));
console.log('drag:', JSON.stringify(c2));
await page.screenshot({ path: `${out}/c-tangent.png` });

// 6. Tap a dimension → dialog → delete → undo
const spots = await page.evaluate(() => window.__scadshape.editor.hotspots.filter(h => h.dim));
assert.ok(spots.length >= 3, `${spots.length} dimension labels`);
const r = await page.evaluate(() => window.__scadshape.editor.canvas.getBoundingClientRect().toJSON());
const s0 = spots[0];
const cnt = () => page.evaluate(() => window.__scadshape.editor.sketch.constraints.length);
const n0 = await cnt();
await touch('touchStart', [{ x: r.left + s0.x + s0.w / 2, y: r.top + s0.y + s0.h / 2 }]); await touch('touchEnd', []);
await page.waitForSelector('#dimDlg[open]');
await page.click('#dimDelete');
assert.equal(await cnt(), n0 - 1);
assert.doesNotMatch(await info(), /Fully defined/);
await page.click('#btnUndo');
assert.equal(await cnt(), n0);
console.log('delete + undo ok:', await info());

// 7. Done → 3D
await page.click('#btnDone');
await page.click('#btnExtrude');
await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fpOk');
await page.waitForFunction(() => /triangles|Error/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
console.log('3D:', await page.textContent('#status'));
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
