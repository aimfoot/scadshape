// Dimensions between points on a circle and from a point to the circle's edge (touch events in
// headless Chromium).
// node dims.mjs [url] [outdir]
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
const pointNear = (s, x, y) => Object.entries(s.points).find(([, p]) => Math.hypot(p.x - x, p.y - y) < 1e-3)?.[0];

// Circle R20 at the origin and four points on it
await page.click('[data-tool="circle"]');
await tap({ x: 0, y: 0 }); await tap({ x: 20, y: 0 });
await page.evaluate(() => window.__scadshape.editor.fit());
await page.click('[data-tool="point"]');
for (const [x, y] of [[20, 0], [0, 20], [-20, 0], [0, -20]]) await tap({ x, y });
let s = await sk();
assert.equal(s.constraints.filter(c => c.type === 'onCurve').length, 4, 'four points on the circle');

// The circle Ø40 (otherwise the solver may change the radius instead)
await page.click('[data-tool="select"]');
await tap({ x: 20 * Math.SQRT1_2, y: 20 * Math.SQRT1_2 });
await ctxClick('Dimension'); await setDim('40');

// Two of the points → Dimension 30 (the chord): both stay on the circle
await tap({ x: 20, y: 0 }); await tap({ x: 0, y: 20 });
await ctxClick('Dimension'); await setDim('30');
s = await sk();
const on = Object.values(s.points).filter(p => Math.abs(Math.hypot(p.x, p.y) - 20) < 1e-6);
assert.equal(on.length, 4);
const d = s.constraints.find(c => c.type === 'distance');
const [a, b] = [s.points[d.p1], s.points[d.p2]];
assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 30) < 1e-6);
console.log('points on the circle, distance 30 ok');

// Free point outside → point + circle → Dimension 10 to the edge
await page.click('[data-tool="point"]');
await tap({ x: 35, y: 10 });
await page.click('[data-tool="select"]');
await tap({ x: 35, y: 10 });
s = await sk(); const free = pointNear(s, 35, 10); assert.ok(free);
const circleClient = await C({ x: -20 * Math.SQRT1_2, y: -20 * Math.SQRT1_2 });
await touch('touchStart', [circleClient]); await touch('touchEnd', []);
assert.ok((await ctxLabels()).includes('On curve'));
await ctxClick('Dimension');
await page.waitForSelector('#dimDlg[open]');
assert.equal(await page.textContent('#dimTitle'), 'Point–circle edge distance');
await setDim('10');
s = await sk();
const fp = s.points[free];
assert.ok(Math.abs(Math.hypot(fp.x, fp.y) - 30) < 1e-6, `the point should be 30 from the center: ${JSON.stringify(fp)}`);
assert.ok(s.constraints.some(c => c.type === 'pcdistance' && c.value === 10));

// Second circle R5 at (50, 0) → both circles → Dimension 6 between the edges
await page.click('[data-tool="circle"]');
await tap({ x: 50, y: -15 }); await tap({ x: 55, y: -15 });
await page.click('[data-tool="select"]');
await tap({ x: 50, y: -10 }); await ctxClick('Dimension'); await setDim('10');
await tap({ x: 50, y: -10 });
await touch('touchStart', [await C({ x: -20 * Math.SQRT1_2, y: 20 * Math.SQRT1_2 })]); await touch('touchEnd', []);
assert.ok((await ctxLabels()).includes('Concentric'), (await ctxLabels()).join());
await ctxClick('Dimension');
await page.waitForSelector('#dimDlg[open]');
assert.equal(await page.textContent('#dimTitle'), 'Distance between circle edges');
await setDim('6');
s = await sk();
const c2 = Object.values(s.entities).find(e => e.type === 'circle' && Math.abs(e.r - 5) < 1e-6);
const cc = s.points[c2.c];
assert.ok(Math.abs(Math.hypot(cc.x, cc.y) - (20 + 5 + 6)) < 1e-6, `center distance ${Math.hypot(cc.x, cc.y)}`);
console.log('circle edge–circle edge 6 ok');

// Horizontal line below the big circle → line + circle → Dimension 5 from the edge
await page.evaluate(() => { const e = window.__scadshape.editor; e.view.cy -= 15; e.requestDraw(); });
await page.click('[data-tool="line"]');
await tap({ x: -25, y: -32 }); await tap({ x: 25, y: -32 }); await tap({ x: 25, y: -32 });
await page.click('[data-tool="select"]');
await tap({ x: 20, y: -32 });
await touch('touchStart', [await C({ x: -20 * Math.SQRT1_2, y: -20 * Math.SQRT1_2 })]); await touch('touchEnd', []);
assert.ok((await ctxLabels()).includes('Tangent'), (await ctxLabels()).join());
await ctxClick('Dimension');
await page.waitForSelector('#dimDlg[open]');
assert.equal(await page.textContent('#dimTitle'), 'Circle edge–line distance');
assert.equal(await page.inputValue('#dimValue'), '10'); // the line snapped to y = −30
await setDim('5');
s = await sk();
const ln = Object.values(s.entities).find(e => e.type === 'line');
assert.ok(Math.abs(s.points[ln.p1].y + 25) < 1e-6 && Math.abs(s.points[ln.p2].y + 25) < 1e-6, JSON.stringify([s.points[ln.p1], s.points[ln.p2]]));
console.log('circle edge–line 5 ok');
await page.screenshot({ path: `${out}/dims.png` });
console.log('point–circle edge 10 ok');
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
