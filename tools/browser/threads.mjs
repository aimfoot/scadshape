// Gängor och språkbyte: Gänga-featuren (utvändig/invändig, cirkelval i 3D) och svenska ↔ engelska.
//   node threads.mjs [url] [utkatalog]
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
const S = () => page.evaluate(() => ({ status: document.querySelector('#status').textContent, solids: window.__scadshape.model.solids, errors: [...window.__scadshape.model.errors.values()], code: window.__scadshape.model.code }));
const waitRendered = async () => {
  await page.waitForTimeout(450);
  await page.waitForFunction(() => !/Renderar|Rendering|Laddar|Loading/.test(document.querySelector('#status').textContent) && !/Avbryt|Cancel/.test(document.querySelector('#btnRender').textContent), null, { timeout: 60000 });
  return S();
};
/** Öppna ☰ om den är stängd (läget sparas mellan omladdningar). */
const openTree = async () => { if (await page.isHidden('#tree')) await page.click('#btnTree'); };
const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
const tap = async p => { const c = await C(p); await touch('touchStart', [c]); await touch('touchEnd', []); };
const tap3d = async (plane, uv) => {
  const p = await page.evaluate(([plane, uv]) => window.__scadshape.viewer.screenOf(plane, uv), [plane, uv]);
  const r = await page.evaluate(() => document.querySelector('#viewport canvas').getBoundingClientRect().toJSON());
  const at = { x: r.left + p.x, y: r.top + p.y };
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, at), 'CANVAS', `skymd: ${JSON.stringify(uv)}`);
  await touch('touchStart', [at]); await touch('touchEnd', []);
};

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'sv'); });
await page.reload();
await page.waitForFunction(() => /Börja med Skiss/.test(document.querySelector('#status').textContent));

// 1. Cylinder Ø8 × 20 och ett hål Ø8,4 (för invändig M10 senare) i en platta bredvid
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.click('[data-tool="circle"]');
await tap({ x: 0, y: 0 }); await tap({ x: 15, y: 0 }); // stor nog att inte snäppa till origo
await page.click('[data-tool="select"]');
await tap({ x: 0, y: 15 });
await page.locator('#ctxbar button', { hasText: 'Mått' }).click();
await page.waitForSelector('#dimDlg[open]'); await page.fill('#dimValue', '8'); await page.click('#dimDlg button[type=submit]');
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', '20'); await page.click('#fpOk');
let st = await waitRendered();
assert.equal(st.solids, 1);

// 2. Gänga: föreslår M8, välj/avvälj cirkeln i 3D
await page.click('#btnThread'); await page.waitForSelector('#featPanel:not([hidden])');
st = await waitRendered();
assert.equal(await page.inputValue('#fp-size'), 'M8');
assert.deepEqual([await page.inputValue('#fp-diameter'), await page.inputValue('#fp-pitch')], ['8', '1,25']);
assert.match(await page.textContent('#fpRegions'), /1 av 1 cirklar \(alla\)/);
await tap3d('XY', { x: 1, y: 1 });
assert.match(await page.textContent('#fpRegions'), /0 av 1 cirklar ·/);
await tap3d('XY', { x: 1, y: 1 });
assert.match(await page.textContent('#fpRegions'), /1 av 1 cirklar ·/);
await page.fill('#fp-length', '15'); await page.fill('#fp-start', '5');
st = await waitRendered();
assert.equal(st.errors.length, 0, st.errors.join());
assert.match(st.code, /twist = -4320/); // 15 mm / 1,25 = 12 varv à 360°
await page.screenshot({ path: `${out}/t-panel.png` });
await page.click('#fpOk');
st = await waitRendered();
assert.equal(st.solids, 2); assert.match(st.status, /trianglar/);
console.log('utvändig M8:', st.status);
await page.click('#btnFit');
await page.screenshot({ path: `${out}/t-thread.png` });

// 3. Invändigt läge föreslår storlek från innerdiametern
await page.click('#btnThread'); await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fp-mode [data-value="internal"]');
assert.equal(await page.inputValue('#fp-size'), 'M10', 'Ø8 som kärnhål → M10');
assert.equal(await page.isVisible('#fp-chamfer'), false);
await page.click('#fpCancel');

// 4. Språkbyte till engelska och tillbaka
await openTree();
await page.selectOption('#lang', 'en');
await page.waitForTimeout(300);
assert.equal(await page.textContent('#btnExtrude span'), 'Extrude');
assert.equal(await page.textContent('#btnRender'), 'Render');
assert.match(await page.locator('#featureList button.feature').nth(2).textContent(), /Thread 1M8 · external · 15 mm/);
assert.match(await page.locator('#featureList button.feature').nth(0).textContent(), /^Sketch 1/);
st = await waitRendered();
assert.match(st.status, /triangles/);
assert.match(st.code, /generated code/);
await page.screenshot({ path: `${out}/t-english.png` });
await page.click('#btnThread'); await page.waitForSelector('#featPanel:not([hidden])');
assert.match(await page.textContent('#fp-mode'), /External.*Internal/);
assert.match(await page.textContent('#fpTitle'), /^New: /);
await page.click('#fpCancel');
await page.reload();
await page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
assert.equal(await page.evaluate(() => document.documentElement.lang), 'en', 'språket sparas');
await openTree(); await page.selectOption('#lang', 'sv'); await page.waitForTimeout(300);
assert.equal(await page.textContent('#btnExtrude span'), 'Extrudera');
console.log('språkbyte sv → en → sv ok');

await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
