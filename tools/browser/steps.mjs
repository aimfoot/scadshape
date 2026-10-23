// Drawing in size steps: diameters, lengths and sides land on whole millimeters (finer only when
// zoomed in past a 1 mm grid), while snapping to existing points still wins.
// node steps.mjs [url] [outdir]
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
const sk = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__scadshape.editor.sketch)));
const view = await page.evaluate(() => { const e = window.__scadshape.editor; return { grid: e.gridStep(), scale: e.view.scale }; });
console.log('view:', JSON.stringify(view));
const step = Math.min(1, view.grid);
const whole = (v, st, msg) => assert.ok(Math.abs(v / st - Math.round(v / st)) < 1e-6, `${msg}: ${v} is not a multiple of ${st}`);
const newest = (s, type) => Object.values(s.entities).filter(e => e.type === type).at(-1);
const len = (s, l) => Math.hypot(s.points[l.p1].x - s.points[l.p2].x, s.points[l.p1].y - s.points[l.p2].y);

// 1. Circle: the diameter in whole steps
await page.click('[data-tool="circle"]');
await tap({ x: 0, y: 0 }); await tap({ x: 18.3, y: 5.2 });
let s = await sk();
const circle = newest(s, 'circle');
whole(2 * circle.r, step, 'circle diameter');
assert.ok(Math.abs(2 * circle.r - 2 * Math.hypot(18.3, 5.2)) <= step / 2 + 1e-9, `circle Ø ${2 * circle.r}`);
console.log('circle Ø', 2 * circle.r);

// 2. Rectangle: width and height in whole steps
await page.click('[data-tool="rect"]');
await tap({ x: 30, y: 0 }); await tap({ x: 53.4, y: 17.7 });
s = await sk();
const rp = Object.values(s.points).filter(p => p.x > 25);
const w = Math.max(...rp.map(p => p.x)) - Math.min(...rp.map(p => p.x)), h = Math.max(...rp.map(p => p.y)) - Math.min(...rp.map(p => p.y));
whole(w, step, 'rect width'); whole(h, step, 'rect height');
console.log('rectangle', w, '×', h);

// 3. A diagonal line: the length in whole steps, in the finger's direction
await page.click('[data-tool="line"]');
await tap({ x: -50, y: -40 }); await tap({ x: -72.7, y: -24.1 });
s = await sk();
const line = newest(s, 'line');
whole(len(s, line), step, 'line length');
const p2 = s.points[line.p2];
assert.ok(Math.abs(Math.atan2(p2.y + 40, p2.x + 50) - Math.atan2(15.9, -22.7)) < 1e-6, 'the direction is kept');
// A horizontal line from there: still level, the length in whole steps
await tap({ x: p2.x - 19.3, y: p2.y + 0.05 });
s = await sk();
const hl = newest(s, 'line');
assert.ok(Math.abs(s.points[hl.p1].y - s.points[hl.p2].y) < 1e-9, 'horizontal');
whole(len(s, hl), step, 'horizontal length');
await page.click('[data-tool="select"]');
console.log('line', len(s, line), '· horizontal', len(s, hl));

// 4. Center rectangle: the full width and height in whole steps
await page.click('[data-tool="rectc"]');
await tap({ x: -50, y: 25 }); await tap({ x: -36.7, y: 33.8 });
s = await sk();
const cp = Object.values(s.points).filter(p => p.x < -30 && p.y > 15);
const cw = Math.max(...cp.map(p => p.x)) - Math.min(...cp.map(p => p.x)), ch = Math.max(...cp.map(p => p.y)) - Math.min(...cp.map(p => p.y));
whole(cw, step, 'center rect width'); whole(ch, step, 'center rect height');
console.log('center rectangle', cw, '×', ch);

// 5. Slot: the length and the width in whole steps
await page.click('[data-tool="slot"]');
await tap({ x: 20, y: -30 }); await tap({ x: 43.4, y: -30.3 }); await tap({ x: 31, y: -24.3 });
s = await sk();
const arcs = Object.values(s.entities).filter(e => e.type === 'arc');
const c1 = s.points[arcs[0].c], c2 = s.points[arcs[1].c];
whole(Math.hypot(c1.x - c2.x, c1.y - c2.y), step, 'slot length');
whole(2 * Math.hypot(s.points[arcs[0].p1].x - c1.x, s.points[arcs[0].p1].y - c1.y), step, 'slot width');
console.log('slot ok');

// 6. Polygon: the diameter of its circle in whole steps
await page.click('[data-tool="polygon"]');
await tap({ x: 80, y: 5 }); await tap({ x: 90.8, y: 8.1 });
s = await sk();
whole(2 * newest(s, 'circle').r, step, 'polygon diameter');
console.log('polygon Ø', 2 * newest(s, 'circle').r);

// 7. Snapping to an existing point still wins: a line ending on the circle's center
await page.click('[data-tool="line"]');
const nPoints = Object.keys(s.points).length;
await tap({ x: -25, y: -5 }); await tap({ x: 0.5, y: 0.5 });
s = await sk();
const last = newest(s, 'line');
assert.ok(last.p2 === circle.c || last.p1 === circle.c, 'the line ends on the circle center');
assert.equal(Object.keys(s.points).length, nPoints + 1);
await page.screenshot({ path: `${out}/steps.png` });

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
if (errors.length) process.exit(1);
