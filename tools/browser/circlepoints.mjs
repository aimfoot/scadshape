// Points on a circle: distribute evenly, the distance between points drives the rest, angle to the
// X axis and to a line.
// node circlepoints.mjs [url] [outdir]
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
const ctxLabels = () => page.$$eval('#ctxbar button', bs => bs.map(b => b.textContent.slice(1)));
const ctxClick = async label => { const i = (await ctxLabels()).indexOf(label); assert.ok(i >= 0, `${label} missing: ${await ctxLabels()}`); await page.locator('#ctxbar button').nth(i).click(); };
const setDim = async v => { await page.waitForSelector('#dimDlg[open]'); await page.fill('#dimValue', v); await page.click('#dimDlg button[type=submit]'); };
const sk = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__scadshape.editor.sketch)));
const deg = p => ((Math.atan2(p.y, p.x) * 180) / Math.PI + 360) % 360;
const polar = (r, a) => ({ x: r * Math.cos((a * Math.PI) / 180), y: r * Math.sin((a * Math.PI) / 180) });
/** The points on the circle (onCurve), sorted by angle. */
const onCircle = async () => {
  const s = await sk();
  return s.constraints.filter(c => c.type === 'onCurve').map(c => ({ id: c.p, ...s.points[c.p] })).sort((a, b) => deg(a) - deg(b));
};
const spacedBy90 = (ps, eps = 1e-6) => ps.every((p, i) => { const d = (deg(ps[(i + 1) % 4]) - deg(p) + 360) % 360; return Math.abs(d - 90) < eps; });

// Circle R20 (without a dimension) and four points at random
await page.click('[data-tool="circle"]');
await tap({ x: 0, y: 0 }); await tap({ x: 20, y: 0 });
await page.click('[data-tool="point"]');
for (const a of [10, 80, 200, 290]) await tap(polar(20, a));
let ps = await onCircle();
assert.equal(ps.length, 4);
assert.ok(!spacedBy90(ps, 0.5));

// Select the circle → Distribute evenly: 90° between the points, the first attached (10°) stays
await page.click('[data-tool="select"]');
await tap(polar(20, 45));
await ctxClick('Distribute evenly');
ps = await onCircle();
assert.ok(spacedBy90(ps), JSON.stringify(ps.map(deg)));
assert.ok(Math.abs(deg(ps[0]) - 10) < 1e-3, JSON.stringify(ps.map(deg)));
console.log('distributed:', ps.map(p => Math.round(deg(p))).join(', '));

// Dimension 20 between two neighbouring points → the circle (without a dimension) and all points
// follow
await tap(ps[0]); await tap(ps[1]);
await ctxClick('Dimension'); await setDim('20');
ps = await onCircle();
const r = Math.hypot(ps[0].x, ps[0].y);
assert.ok(Math.abs(r - 20 / (2 * Math.sin(Math.PI / 4))) < 1e-6, `radius ${r}`);
assert.ok(spacedBy90(ps), JSON.stringify(ps.map(deg)));
console.log('distance 20 → radius', r.toFixed(3));

// One point → Angle to X 30° → the whole pattern rotates
await tap(ps[0]);
await ctxClick('Angle to X');
await page.waitForSelector('#dimDlg[open]');
assert.equal(await page.textContent('#dimTitle'), 'Angle to the X axis');
await setDim('30');
ps = await onCircle();
assert.deepEqual(ps.map(p => Math.round(deg(p) * 1e4) / 1e4), [30, 120, 210, 300]);
console.log('angle to X 30° ok');
await page.screenshot({ path: `${out}/circlepoints.png` });

// Undo the angle (two steps); draw a horizontal line; point + line → Angle 45°
await page.click('#btnUndo'); await page.click('#btnUndo'); // the value, then the dimension itself
assert.ok(!(await sk()).constraints.some(c => c.type === 'xangle'));
await page.evaluate(() => { const e = window.__scadshape.editor; e.view.cy -= 10; e.requestDraw(); });
await page.click('[data-tool="line"]');
await tap({ x: -30, y: -25 }); await tap({ x: 0, y: -25 }); await tap({ x: 0, y: -25 });
await page.click('[data-tool="select"]');
ps = await onCircle();
await tap(ps[0]); await tap({ x: -25, y: -25 });
await ctxClick('Angle');
await setDim('45');
ps = await onCircle();
assert.deepEqual(ps.map(p => Math.round(deg(p) * 1e4) / 1e4), [45, 135, 225, 315]);
console.log('angle to line 45° ok');
await page.screenshot({ path: `${out}/circlepoints-line.png` });
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
