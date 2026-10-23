// Dark theme: auto follows the phone, the choice in ☰ is saved, and canvas/3D change color.
// node theme.mjs [url] [outdir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const base = { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US' };

async function open(colorScheme) {
  const ctx = await browser.newContext({ ...base, colorScheme });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.route('**/api/**', r => r.fulfill({ status: 204 }));
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp };
}
const theme = page => page.evaluate(() => document.documentElement.dataset.theme);
const bodyBg = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const lum = rgb => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const openTree = async page => { if (await page.isHidden('#tree')) await page.click('#btnTree'); };
const closeTree = async page => { if (!(await page.isHidden('#tree'))) await page.click('#btnTree'); };

// 1. The phone in dark mode, no choice: dark.
let { ctx, page, cdp } = await open('dark');
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
assert.equal(await theme(page), 'dark');
assert.ok(lum(await bodyBg(page)) < 40, await bodyBg(page));
assert.equal(await page.getAttribute('meta[name="theme-color"]', 'content'), '#1b2229');

// Model: plate with a hole via the sketch (its canvas should be dark).
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
const tap = async p => { const c = await C(p); await touch('touchStart', [c]); await touch('touchEnd', []); };
const drag = async (a, b) => {
  const ca = await C(a), cb = await C(b);
  await touch('touchStart', [ca]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: ca.x + ((cb.x - ca.x) * i) / 8, y: ca.y + ((cb.y - ca.y) * i) / 8 }]);
  await touch('touchEnd', []);
};
await page.click('#btnNewSketch');
await page.screenshot({ path: `${out}/th-planedlg.png` });
await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.click('[data-tool="rect"]');
await drag({ x: 0, y: 0 }, { x: 40, y: 20 });
await page.click('[data-tool="circle"]');
await tap({ x: 10, y: 10 }); await tap({ x: 13, y: 10 });
await page.click('[data-tool="select"]');
await tap({ x: 20, y: 0 });
const sketchPx = await page.evaluate(() => {
  const c = window.__scadshape.editor.canvas, d = c.getContext('2d').getImageData(4, c.height - 4, 1, 1).data;
  return [d[0], d[1], d[2]];
});
assert.ok(sketchPx[0] < 40 && sketchPx[1] < 40, `the sketch's background: ${sketchPx}`);
await page.screenshot({ path: `${out}/th-sketch-dark.png` });
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', '8');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/th-panel-dark.png` });
await page.click('#fpOk');
await page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.click('#btnMeasure');
const r = await page.evaluate(() => document.querySelector('#viewport canvas').getBoundingClientRect().toJSON());
const corner = await page.evaluate(() => window.__scadshape.viewer.screenOfWorld(0, 0, 8));
await touch('touchStart', [{ x: r.left + corner.x, y: r.top + corner.y }]); await touch('touchEnd', []);
await page.screenshot({ path: `${out}/th-3d-dark.png` });
await page.click('#measureDone');
await page.click('#btnCode');
await page.screenshot({ path: `${out}/th-code-dark.png` });
await page.click('#btnCode');
await openTree(page);
await page.screenshot({ path: `${out}/th-tree-dark.png` });

// 2. Choose Light: everything changes at once (the 3D view's grid too), and the choice is saved.
const gridBefore = await page.evaluate(() => window.__scadshape.viewer.scene.children.find(o => o.type === 'Group').children[0].material.color.getHex());
await page.selectOption('#theme', 'light');
assert.equal(await theme(page), 'light');
assert.ok(lum(await bodyBg(page)) > 200, await bodyBg(page));
const gridAfter = await page.evaluate(() => window.__scadshape.viewer.scene.children.find(o => o.type === 'Group').children[0].material.color.getHex());
assert.notEqual(gridBefore, gridAfter, 'the grid changed color');
await page.reload();
assert.equal(await theme(page), 'light', 'the choice is saved');
assert.equal(await page.inputValue('#theme'), 'light');
await closeTree(page);
await page.screenshot({ path: `${out}/th-3d-light.png` });
await ctx.close();

// 3. The phone in light mode but Dark chosen; then Same as the phone → light.
({ ctx, page } = await open('light'));
await page.goto(url);
assert.equal(await theme(page), 'light');
await openTree(page);
await page.selectOption('#theme', 'dark');
assert.equal(await theme(page), 'dark');
await page.reload();
assert.equal(await theme(page), 'dark');
await page.selectOption('#theme', 'auto');
assert.equal(await theme(page), 'light');
// Swedish texts exist.
await page.selectOption('#lang', 'sv');
assert.deepEqual(await page.$$eval('#theme option', os => os.map(o => o.textContent)), ['Som telefonen', 'Ljust', 'Mörkt']);
await page.selectOption('#lang', 'en');
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
