// Snäpplås: snäpphake/urtag vid punkter och behållare med snäpplock, med pekhändelser i headless Chromium.
//   node snap.mjs [url] [utkatalog]
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
const S = () => page.evaluate(() => ({ status: document.querySelector('#status').textContent, solids: window.__scadshape.model.solids, errors: [...window.__scadshape.model.errors.values()] }));
const waitRendered = async () => {
  await page.waitForTimeout(500);
  await page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
  return S();
};
const bbox = () => page.evaluate(() => {
  const p = window.__scadshape.viewer.meshPositions; const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) { mn[i % 3] = Math.min(mn[i % 3], p[i]); mx[i % 3] = Math.max(mx[i % 3], p[i]); }
  return [...mn, ...mx].map(v => Math.round(v * 100) / 100);
});
const openTree = async () => { if (await page.isHidden('#tree')) await page.click('#btnTree'); };
const notes = () => page.$$eval('#fpFields .fp-note', ps => ps.filter(p => !p.hidden).map(p => ({ text: p.textContent, warn: p.classList.contains('warn') })));

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();

// 1. Snäpphake utan skiss: mallskiss i origo, haken 12 mm upp från XY-planet.
await page.click('#btnSnap');
await page.waitForSelector('#featPanel:not([hidden])');
assert.match(await page.textContent('#fpRegions'), /origo/);
let n = await notes();
assert.match(n[0].text, /Töjning i roten 1,6 %/); assert.equal(n[0].warn, false);
assert.match(n[1].text, /Tips: en stående hake/);
// För tjock: varning.
await page.fill('#fp-thickness', '3');
n = await notes();
assert.match(n[0].text, /3,1 %.*för mycket/); assert.equal(n[0].warn, true);
await page.screenshot({ path: `${out}/sn-panel.png` });
await page.fill('#fp-thickness', '1,5');
await page.click('#fpOk');
let st = await waitRendered();
assert.equal(st.errors.length, 0, st.errors.join());
assert.deepEqual(await bbox(), [-1.5, -3, 0, 1.75, 3, 12], "rotfas −0,75 − 0,75; hullingens spets 0,75 + 1");
assert.match(await page.textContent('#featureList'), /Hake · 12 × 1,5 mm/);
console.log('hake:', st.status, JSON.stringify(await bbox()));

// 2. Urtag i en platta: ny modell, platta 30 × 20 × 4, skiss på ovansidan med en punkt.
await openTree(); await page.click('#btnProjects'); await page.click('#projNew');
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.click('[data-tool="rect"]'); await drag({ x: 0, y: 0 }, { x: 30, y: 20 });
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])'); await page.fill('#fp-depth', '4'); await page.click('#fpOk');
await waitRendered();
await page.click('#btnNewSketch'); await page.fill('#planeOffset', '4'); await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.click('[data-tool="point"]'); await tap({ x: 15, y: 10 });
await page.click('#btnDone');
await page.click('#btnSnap'); await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fp-kind [data-value="catch"]');
assert.deepEqual(await notes(), [], 'inga töjningsrader för urtag');
assert.equal(await page.isVisible('#fp-depth'), true); assert.equal(await page.isVisible('#fp-length'), false);
await page.click('#fpOk');
st = await waitRendered();
assert.equal(st.errors.length, 0, st.errors.join());
const vol = await page.evaluate(() => {
  const p = window.__scadshape.viewer.meshPositions; let v = 0;
  for (let i = 0; i < p.length; i += 9) v += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
  return v;
});
assert.ok(Math.abs(vol - (30 * 20 * 4 - (1.5 + 1 + 0.4) * 6.4 * 3)) < 0.05, String(vol));
console.log('urtag:', st.status, vol.toFixed(2));

// 3. Behållare med snäpplock.
await openTree(); await page.click('#btnProjects'); await page.click('#projNew');
if (!(await page.isHidden('#tree'))) await page.click('#btnTree');
await page.click('#btnContainer'); await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fp-lid [data-value="snap"]');
assert.equal(await page.inputValue('#fp-snapDepth'), '0,6');
assert.equal(await page.isVisible('#fp-lipHeight'), true);
await page.click('#fpOk');
st = await waitRendered();
assert.equal(st.errors.length, 0, st.errors.join());
assert.deepEqual(await bbox(), [-40, -30, 0, 130, 30, 40]);
assert.match(await page.textContent('#featureList'), /snäpplock/);
await page.screenshot({ path: `${out}/sn-box.png` });
// För stort utstick → fel i trädet.
await openTree();
await page.locator('#featureList li', { hasText: 'Behållare' }).first().click();
await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-snapDepth', '1,8'); await page.waitForTimeout(600);
assert.match(await page.textContent('#fpError'), /för tunn/);
await page.click('#fpCancel');
console.log('snäpplock:', st.status);
await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
