// Punkter på en cirkel: fördela jämnt, avstånd mellan punkter styr resten, vinkel mot X-axeln och mot en linje.
//   node circlepoints.mjs [url] [utkatalog]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'sv-SE' });
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
const ctxClick = async label => { const i = (await ctxLabels()).indexOf(label); assert.ok(i >= 0, `${label} saknas: ${await ctxLabels()}`); await page.locator('#ctxbar button').nth(i).click(); };
const setDim = async v => { await page.waitForSelector('#dimDlg[open]'); await page.fill('#dimValue', v); await page.click('#dimDlg button[type=submit]'); };
const sk = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__scadshape.editor.sketch)));
const deg = p => ((Math.atan2(p.y, p.x) * 180) / Math.PI + 360) % 360;
const polar = (r, a) => ({ x: r * Math.cos((a * Math.PI) / 180), y: r * Math.sin((a * Math.PI) / 180) });
/** Punkterna på cirkeln (onCurve), sorterade efter vinkel. */
const onCircle = async () => {
  const s = await sk();
  return s.constraints.filter(c => c.type === 'onCurve').map(c => ({ id: c.p, ...s.points[c.p] })).sort((a, b) => deg(a) - deg(b));
};
const spacedBy90 = (ps, eps = 1e-6) => ps.every((p, i) => { const d = (deg(ps[(i + 1) % 4]) - deg(p) + 360) % 360; return Math.abs(d - 90) < eps; });

// Cirkel R20 (utan mått) och fyra punkter på måfå
await page.click('[data-tool="circle"]');
await tap({ x: 0, y: 0 }); await tap({ x: 20, y: 0 });
await page.click('[data-tool="point"]');
for (const a of [10, 80, 200, 290]) await tap(polar(20, a));
let ps = await onCircle();
assert.equal(ps.length, 4);
assert.ok(!spacedBy90(ps, 0.5));

// Markera cirkeln → Fördela jämnt: 90° mellan punkterna, den först fästa (10°) står kvar
await page.click('[data-tool="select"]');
await tap(polar(20, 45));
await ctxClick('Fördela jämnt');
ps = await onCircle();
assert.ok(spacedBy90(ps), JSON.stringify(ps.map(deg)));
assert.ok(Math.abs(deg(ps[0]) - 10) < 1e-3, JSON.stringify(ps.map(deg)));
console.log('fördelade:', ps.map(p => Math.round(deg(p))).join(', '));

// Mått 20 mellan två grannpunkter → cirkeln (utan mått) och alla punkter följer med
await tap(ps[0]); await tap(ps[1]);
await ctxClick('Mått'); await setDim('20');
ps = await onCircle();
const r = Math.hypot(ps[0].x, ps[0].y);
assert.ok(Math.abs(r - 20 / (2 * Math.sin(Math.PI / 4))) < 1e-6, `radie ${r}`);
assert.ok(spacedBy90(ps), JSON.stringify(ps.map(deg)));
console.log('avstånd 20 → radie', r.toFixed(3));

// En punkt → Vinkel mot X 30° → hela mönstret vrids
await tap(ps[0]);
await ctxClick('Vinkel mot X');
await page.waitForSelector('#dimDlg[open]');
assert.equal(await page.textContent('#dimTitle'), 'Vinkel mot X-axeln');
await setDim('30');
ps = await onCircle();
assert.deepEqual(ps.map(p => Math.round(deg(p) * 1e4) / 1e4), [30, 120, 210, 300]);
console.log('vinkel mot X 30° ok');
await page.screenshot({ path: `${out}/circlepoints.png` });

// Ångra vinkeln (två steg); rita en vågrät linje; punkt + linje → Vinkel 45°
await page.click('#btnUndo'); await page.click('#btnUndo'); // värdet, sedan själva måttet
assert.ok(!(await sk()).constraints.some(c => c.type === 'xangle'));
await page.evaluate(() => { const e = window.__scadshape.editor; e.view.cy -= 10; e.requestDraw(); });
await page.click('[data-tool="line"]');
await tap({ x: -30, y: -25 }); await tap({ x: 0, y: -25 }); await tap({ x: 0, y: -25 });
await page.click('[data-tool="select"]');
ps = await onCircle();
await tap(ps[0]); await tap({ x: -25, y: -25 });
await ctxClick('Vinkel');
await setDim('45');
ps = await onCircle();
assert.deepEqual(ps.map(p => Math.round(deg(p) * 1e4) / 1e4), [45, 135, 225, 315]);
console.log('vinkel mot linje 45° ok');
await page.screenshot({ path: `${out}/circlepoints-line.png` });
await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
