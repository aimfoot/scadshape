// The sketch tools polygon and slot: a regular hexagon that can be dimensioned, a slot that becomes
// a region.
// node sketchtools.mjs [url] [outdir]
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
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); });
await page.reload();
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
const tap = async p => { const c = await C(p); await touch('touchStart', [c]); await touch('touchEnd', []); };
const ed = () => page.evaluate(() => {
  const e = window.__scadshape.editor, sk = e.sketch;
  const lines = Object.values(sk.entities).filter(x => x.type === 'line' && !x.construction).map(l => Math.hypot(sk.points[l.p1].x - sk.points[l.p2].x, sk.points[l.p1].y - sk.points[l.p2].y));
  return { dof: e.dof, loops: e.loopCount, lines, arcs: Object.values(sk.entities).filter(x => x.type === 'arc').length, circles: Object.values(sk.entities).filter(x => x.type === 'circle').length };
});

// 1. Hexagon (default 6 sides) around (-20, 0) with corners on the radius 10
await page.click('[data-tool="polygon"]');
assert.ok(await page.isVisible('#sidesBar'));
assert.equal(await page.getAttribute('[data-sides="6"]', 'aria-pressed'), 'true');
await tap({ x: -20, y: 0 }); await tap({ x: -10, y: 0.3 });
let s = await ed();
assert.equal(s.lines.length, 6); assert.equal(s.loops, 1); assert.equal(s.circles, 1, 'construction circle');
for (const l of s.lines) assert.ok(Math.abs(l - s.lines[0]) < 1e-6, `equal sides: ${s.lines}`);
assert.equal(s.dof, 4, 'center (2) + radius + rotation');
// Diameter 20 on the construction circle → side 10
await page.click('[data-tool="select"]');
const a0 = Math.atan2(0.3, 10) + Math.PI / 6; // in front of a side – where the circle is farthest from the sides
await tap({ x: -20 + 10 * Math.cos(a0), y: 10 * Math.sin(a0) });
console.log('selected:', await page.evaluate(() => [...window.__scadshape.editor.selection]));
await page.locator('#ctxbar button', { hasText: 'Dimension' }).click();
await page.waitForSelector('#dimDlg[open]'); await page.fill('#dimValue', '20'); await page.click('#dimDlg button[type=submit]');
s = await ed();
for (const l of s.lines) assert.ok(Math.abs(l - 10) < 1e-4, `side 10: ${s.lines}`);

// 2. Square with side choice 4
await page.click('[data-tool="polygon"]'); await page.click('[data-sides="4"]');
await tap({ x: 20, y: 20 }); await tap({ x: 26, y: 26 });
s = await ed(); assert.equal(s.loops, 2); assert.equal(s.lines.length, 10);

// 3. Slot from (10, -20) to (30, -20), width 2 × 4
await page.click('[data-tool="slot"]');
await tap({ x: 10, y: -20 }); await tap({ x: 30, y: -20 }); await tap({ x: 20, y: -16 });
s = await ed();
assert.equal(s.arcs, 2); assert.equal(s.loops, 3, s.lines.join());
assert.equal(s.dof, 12, 'hexagon with dimension 3 + square 4 + slot 5');
await page.screenshot({ path: `${out}/st-sketch.png` });

// 4. Extrude everything 5 mm: hexagon (Ø20) + square + slot
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])'); await page.fill('#fp-depth', '5'); await page.click('#fpOk');
await page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
const st = await page.evaluate(() => ({ errors: [...window.__scadshape.model.errors.values()], status: document.querySelector('#status').textContent }));
assert.equal(st.errors.length, 0, st.errors.join());
await page.screenshot({ path: `${out}/st-3d.png` });
console.log(st.status);
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
