// Mätverktyget i 3D med pekhändelser (CDP) i headless Chromium.
//   node measure.mjs [url] [utkatalog]
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
const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
const tap = async p => { const c = await C(p); await touch('touchStart', [c]); await touch('touchEnd', []); };
const drag = async (a, b) => {
  const ca = await C(a), cb = await C(b);
  await touch('touchStart', [ca]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: ca.x + ((cb.x - ca.x) * i) / 8, y: ca.y + ((cb.y - ca.y) * i) / 8 }]);
  await touch('touchEnd', []);
};
const tap3d = async (x, y, z) => {
  const p = await page.evaluate(([x, y, z]) => window.__scadshape.viewer.screenOfWorld(x, y, z), [x, y, z]);
  const r = await page.evaluate(() => document.querySelector('#viewport canvas').getBoundingClientRect().toJSON());
  const at = { x: r.left + p.x, y: r.top + p.y };
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, at), 'CANVAS', `skymd: ${[x, y, z]}`);
  await touch('touchStart', [at]); await touch('touchEnd', []);
};
const result = async () => [await page.textContent('#measureMain'), await page.textContent('#measureDetail')];

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
// Platta 40 × 20 × 10 med ett hål i (10, 10).
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.click('[data-tool="rect"]');
await drag({ x: 0, y: 0 }, { x: 40, y: 20 });
await page.click('[data-tool="circle"]');
await tap({ x: 10, y: 10 }); await tap({ x: 13, y: 10 });
const R = await page.evaluate(() => Object.values(window.__scadshape.editor.sketch.entities).find(e => e.type === 'circle').r);
const fmt = v => String(Math.round(v * 100) / 100).replace('.', ',');
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])'); await page.fill('#fp-depth', '10'); await page.click('#fpOk');
await page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.click('[data-view="iso"]');

await page.click('#btnMeasure');
assert.deepEqual(await result(), ['Tryck på ett hörn, en kant eller en yta', '']);
// 1. Hålkanten → Ø, sedan hörnet i origo → avstånd från centrum.
await tap3d(10 + R * Math.cos(-0.7), 10 + R * Math.sin(-0.7), 10);
let r = await result();
assert.equal(r[0], `Ø ${fmt(2 * R)} mm · R ${fmt(R)}`, r.join(' | '));
await tap3d(0, 0, 10);
r = await result();
assert.equal(r[0], 'Avstånd 14,14 mm', r.join(' | ')); assert.equal(r[1], 'ΔX 10 · ΔY 10 · ΔZ 0');
await page.screenshot({ path: `${out}/me-hole.png` });
console.log('hål → hörn:', r.join(' | '));
// 2. Tredje trycket börjar om: framkanten → 40 mm.
await tap3d(25, 0, 10);
r = await result();
assert.equal(r[0], 'Kant 40 mm', r.join(' | '));
// 3. Ovansidan + framsidan → 90°.
await page.click('#measureClear');
await tap3d(30, 14, 10);
assert.equal((await result())[0], 'Yta');
await tap3d(28, 0, 4);
r = await result();
assert.equal(r[0], 'Vinkel mellan ytorna 90°', r.join(' | '));
// 4. Högra sidan + hålkanten → 30 mm vinkelrätt.
await page.click('#measureClear');
await tap3d(40, 6, 5);
await tap3d(10 + R * Math.cos(-0.7), 10 + R * Math.sin(-0.7), 10);
r = await result();
assert.equal(r[0], 'Avstånd 30 mm', r.join(' | ')); assert.equal(r[1], 'vinkelrätt mot ytan');
await page.screenshot({ path: `${out}/me-face.png` });
console.log('yta → hål:', r.join(' | '));
// 5. Klar: baren försvinner och 3D-trycken går tillbaka till det vanliga.
await page.click('#measureDone');
assert.equal(await page.isHidden('#measureBar'), true);
assert.equal(await page.evaluate(() => window.__scadshape.viewer.tapOverride), null);
// Mät i porträttläge (smal skärm): baren får plats.
await page.setViewportSize({ width: 412, height: 860 });
await page.click('#btnMeasure');
await page.waitForTimeout(300);
await page.click('[data-view="iso"]');
await tap3d(10 + R * Math.cos(-0.7), 10 + R * Math.sin(-0.7), 10);
const box = await page.locator('#measureBar').boundingBox();
assert.ok(box.x >= 0 && box.x + box.width <= 412, JSON.stringify(box));
await page.screenshot({ path: `${out}/me-portrait.png` });
await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
