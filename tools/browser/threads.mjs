// Threads and language switch: the Thread feature (external/internal, circle picking in 3D) and
// English ↔ Swedish.
// node threads.mjs [url] [outdir]
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
const S = () => page.evaluate(() => ({ status: document.querySelector('#status').textContent, solids: window.__scadshape.model.solids, errors: [...window.__scadshape.model.errors.values()], code: window.__scadshape.model.code }));
const waitRendered = async () => {
  await page.waitForTimeout(450);
  await page.waitForFunction(() => !/Renderar|Rendering|Laddar|Loading/.test(document.querySelector('#status').textContent) && !/Avbryt|Cancel/.test(document.querySelector('#btnRender').textContent), null, { timeout: 60000 });
  return S();
};
/** Open ☰ if it is closed (the state is saved between reloads). */
const openSettings = async () => {
  if (await page.evaluate(() => document.querySelector('#settingsDlg').open)) return;
  if (await page.isHidden('#tree')) await page.click('#btnTree');
  await page.click('#btnSettings');
};
const closeSettings = () => page.evaluate(() => document.querySelector('#settingsDlg').close());
const openTree = async () => { if (await page.isHidden('#tree')) await page.click('#btnTree'); };
const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
const tap = async p => { const c = await C(p); await touch('touchStart', [c]); await touch('touchEnd', []); };
const tap3d = async (plane, uv) => {
  const p = await page.evaluate(([plane, uv]) => window.__scadshape.viewer.screenOf(plane, uv), [plane, uv]);
  const r = await page.evaluate(() => document.querySelector('#viewport canvas').getBoundingClientRect().toJSON());
  const at = { x: r.left + p.x, y: r.top + p.y };
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, at), 'CANVAS', `hidden: ${JSON.stringify(uv)}`);
  await touch('touchStart', [at]); await touch('touchEnd', []);
};

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); });
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));

// 1. Cylinder Ø8 × 20 and a hole Ø8.4 (for an internal M10 later) in a plate beside it
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.click('[data-tool="circle"]');
await tap({ x: 0, y: 0 }); await tap({ x: 15, y: 0 }); // large enough not to snap to the origin
await page.click('[data-tool="select"]');
await tap({ x: 0, y: 15 });
await page.locator('#ctxbar button', { hasText: 'Dimension' }).click();
await page.waitForSelector('#dimDlg[open]'); await page.fill('#dimValue', '8'); await page.click('#dimDlg button[type=submit]');
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', '20'); await page.click('#fpOk');
let st = await waitRendered();
assert.equal(st.solids, 1);

// 2. Thread: suggests M8, select/deselect the circle in 3D
await page.click('#btnThread'); await page.waitForSelector('#featPanel:not([hidden])');
st = await waitRendered();
assert.equal(await page.inputValue('#fp-size'), 'M8');
assert.deepEqual([await page.inputValue('#fp-diameter'), await page.inputValue('#fp-pitch')], ['8', '1,25']);
assert.match(await page.textContent('#fpRegions'), /1 of 1 circles \(all\)/);
await tap3d('XY', { x: 1, y: 1 });
assert.match(await page.textContent('#fpRegions'), /0 of 1 circles ·/);
await tap3d('XY', { x: 1, y: 1 });
assert.match(await page.textContent('#fpRegions'), /1 of 1 circles ·/);
await page.fill('#fp-length', '15'); await page.fill('#fp-start', '5');
st = await waitRendered();
assert.equal(st.errors.length, 0, st.errors.join());
assert.match(st.code, /twist = -4320/); // 15 mm / 1.25 = 12 turns of 360°
await page.screenshot({ path: `${out}/t-panel.png` });
await page.click('#fpOk');
st = await waitRendered();
assert.equal(st.solids, 2); assert.match(st.status, /triangles/);
console.log('external M8:', st.status);
await page.click('#btnFit');
await page.screenshot({ path: `${out}/t-thread.png` });

// 3. Internal mode suggests a size from the inner diameter
await page.click('#btnThread'); await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fp-mode [data-value="internal"]');
assert.equal(await page.inputValue('#fp-size'), 'M10', 'Ø8 as the core hole → M10');
assert.equal(await page.isVisible('#fp-chamfer'), false);
await page.click('#fpCancel');

// 4. Switch language to Swedish and back
await openSettings();
await page.selectOption('#lang', 'sv');
await closeSettings();
await page.waitForTimeout(300);
assert.equal(await page.textContent('#btnExtrude span'), 'Extrudera');
assert.equal(await page.textContent('#btnRender'), 'Rendera');
assert.match(await page.locator('#featureList button.feature').nth(2).textContent(), /Gänga 1M8 · utvändig · 15 mm/);
assert.match(await page.locator('#featureList button.feature').nth(0).textContent(), /^Skiss 1/);
st = await waitRendered();
assert.match(st.status, /trianglar/);
assert.match(st.code, /Gjord med scadshape/);
await page.screenshot({ path: `${out}/t-swedish.png` });
await page.click('#btnThread'); await page.waitForSelector('#featPanel:not([hidden])');
assert.match(await page.textContent('#fp-mode'), /Utvändig.*Invändig/);
assert.match(await page.textContent('#fpTitle'), /^Ny: /);
await page.click('#fpCancel');
await page.reload();
await page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
assert.equal(await page.evaluate(() => document.documentElement.lang), 'sv', 'the language is saved');
await openSettings(); await page.selectOption('#lang', 'en'); await closeSettings(); await page.waitForTimeout(300);
assert.equal(await page.textContent('#btnExtrude span'), 'Extrude');
console.log('language switch en → sv → en ok');

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
