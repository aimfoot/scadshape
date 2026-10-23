// Fillet/chamfer sketch corners with touch events (CDP) in headless Chromium.
// node fillet.mjs [url] [outdir]
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
const ctxLabels = () => page.$$eval('#ctxbar button', bs => bs.map(b => b.textContent.slice(1)));
const ctxClick = async label => { const i = (await ctxLabels()).indexOf(label); assert.ok(i >= 0, `${label} missing: ${await ctxLabels()}`); await page.locator('#ctxbar button').nth(i).click(); };
const setDim = async v => { await page.waitForSelector('#dimDlg[open]'); await page.fill('#dimValue', v); await page.click('#dimDlg button[type=submit]'); };
const ed = () => page.evaluate(() => {
  const e = window.__scadshape.editor, sk = e.sketch;
  const arcs = Object.values(sk.entities).filter(x => x.type === 'arc').map(a => {
    const c = sk.points[a.c], p = sk.points[a.p1];
    return { cx: c.x, cy: c.y, r: Math.hypot(p.x - c.x, p.y - c.y) };
  });
  return { arcs, loops: e.loopCount, dof: e.dof, lines: Object.values(sk.entities).filter(x => x.type === 'line' && !x.construction).length };
});
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-3, `${msg}: ${a} ≉ ${b}`);

// 1. Rectangle 0..40 × 0..20 with width and height (fully defined).
await page.click('[data-tool="rect"]');
await drag({ x: 0, y: 0 }, { x: 40, y: 20 });
await page.click('[data-tool="select"]');
await tap({ x: 20, y: 0 }); await ctxClick('Dimension'); await setDim('40');
await tap({ x: 40, y: 10 }); await ctxClick('Dimension'); await setDim('20');
assert.match(await info(), /Fully defined/, await info());

// 2. Tap the corner (40, 20) → Fillet → radius 6.
await tap({ x: 40, y: 20 });
assert.deepEqual((await ctxLabels()).slice(0, 2), ['Fillet', 'Chamfer'], String(await ctxLabels()));
await ctxClick('Fillet');
await setDim('6');
let s = await ed();
assert.equal(s.arcs.length, 1); near(s.arcs[0].r, 6, 'radius'); near(s.arcs[0].cx, 34, 'cx'); near(s.arcs[0].cy, 14, 'cy');
assert.equal(s.loops, 1); assert.match(await info(), /Fully defined/, await info());
console.log('round:', await info());

// 3. Select the bottom and left lines → Chamfer the corner at the origin, 4 mm.
await tap({ x: 20, y: 0 }); await tap({ x: 0, y: 10 });
await ctxClick('Chamfer');
await setDim('4');
s = await ed();
assert.equal(s.lines, 5, 'four sides + chamfer'); assert.equal(s.loops, 1);
assert.match(await info(), /Fully defined/, await info());
await page.screenshot({ path: `${out}/fi-sketch.png` });
console.log('chamfer:', await info());

// 4. Extrude 5 mm.
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])'); await page.fill('#fp-depth', '5'); await page.click('#fpOk');
await page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
const st = await page.evaluate(() => ({ errors: [...window.__scadshape.model.errors.values()], status: document.querySelector('#status').textContent }));
assert.equal(st.errors.length, 0, st.errors.join());
await page.screenshot({ path: `${out}/fi-3d.png` });
console.log(st.status);
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
