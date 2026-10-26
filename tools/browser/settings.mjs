// ☰ → Settings: the printer's build volume (A1 mini by default, presets, a custom size that is saved,
// the status bar warns when the model does not fit), and that everything renders by itself (the Render
// button is only Cancel, during a long render).
// node settings.mjs [url] [outdir]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const example = id => readFileSync(new URL(`../../src/examples/${id}.scad`, import.meta.url), 'utf8');
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
const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
const tapSk = async p => { const c = await C(p); await touch('touchStart', [c]); await touch('touchEnd', []); };
const status = () => page.evaluate(() => ({ text: document.querySelector('#status').textContent, cls: document.querySelector('#status').className }));
const waitRendered = async () => {
  await page.waitForTimeout(450);
  await page.waitForFunction(() => !/Rendering|Loading/.test(document.querySelector('#status').textContent) && !/Cancel/.test(document.querySelector('#btnRender').textContent), null, { timeout: 60000 });
  return status();
};
const openSettings = async () => {
  if (await page.evaluate(() => document.querySelector('#settingsDlg').open)) return;
  if (await page.isHidden('#tree')) await page.click('#btnTree');
  await page.click('#btnSettings');
};
const closeSettings = () => page.evaluate(() => document.querySelector('#settingsDlg').close());

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); });
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));

// 1. The drawer has Settings instead of the language/theme pickers and About; the dialog has them.
assert.equal(await page.evaluate(() => !!document.querySelector('#tree #lang, #tree #theme, #tree #btnAbout')), false);
await openSettings();
assert.ok(await page.isVisible('#lang') && await page.isVisible('#theme') && await page.isVisible('#btnAbout'));
assert.equal(await page.inputValue('#bedPreset'), 'a1mini', 'A1 mini by default');
assert.ok(await page.isHidden('#bedCustom'));
await page.screenshot({ path: `${out}/settings.png` });
await closeSettings();

// 2. A plate 200 × 20 × 10 does not fit the A1 mini: a warning in the status bar.
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.click('[data-tool="rect"]'); await tapSk({ x: -100, y: 0 }); await tapSk({ x: 100, y: 20 });
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', '10'); await page.click('#fpOk');
let st = await waitRendered();
assert.match(st.text, /larger than the printer \(180 × 180 × 180 mm\)/, st.text);
assert.match(st.cls, /warn/);
assert.ok(await page.isHidden('#btnRender'), 'no Render button when nothing is rendering');
// Also a row in the problem list, so "Copy for AI" says it.
const rows = () => page.$$eval('#problemList li .hint', els => els.map(e => e.textContent));
assert.ok((await rows()).some(r => /200 × 20 × 10 mm, larger than the printer \(180 × 180 × 180 mm/.test(r)), (await rows()).join(' | '));
console.log('A1 mini:', st.text);

// 3. Bambu Lab A1 (256): it fits – the warning goes without a new render.
await openSettings();
await page.selectOption('#bedPreset', 'a1');
st = await status();
assert.doesNotMatch(st.text, /larger/, st.text);
assert.doesNotMatch(st.cls, /warn/);
assert.deepEqual(await rows(), []);
console.log('A1:', st.text);

// 4. Custom 150 × 150 × 150: too small again; saved after a reload.
await page.selectOption('#bedPreset', 'custom');
assert.ok(await page.isVisible('#bedCustom'));
for (const id of ['#bedW', '#bedD', '#bedH']) { await page.fill(id, '150'); await page.dispatchEvent(id, 'change'); }
assert.match((await status()).text, /larger than the printer \(150 × 150 × 150 mm\)/);
await page.reload();
st = await waitRendered();
assert.match(st.text, /150 × 150 × 150/, st.text);
await openSettings();
assert.equal(await page.inputValue('#bedPreset'), 'custom');
assert.equal(await page.inputValue('#bedW'), '150');
// Turned 90° it fits a 25 × 210 plate.
await page.fill('#bedW', '25'); await page.dispatchEvent('#bedW', 'change');
await page.fill('#bedD', '210'); await page.dispatchEvent('#bedD', 'change');
assert.doesNotMatch((await status()).text, /larger/);
await closeSettings();
console.log('custom size saved, a turned part fits');

// 5. Code renders when asked (Render), not while you write.
if (await page.isVisible('#tree')) await page.click('#btnTree'); // ☰ would cover the code
await page.click('#workMode [data-work=code]'); await page.fill('#code', example('cube')); await page.click('#btnRunCode');
await waitRendered();
await page.fill('#code', 'cube([7, 7, 7]); translate([20, 0, 0]) cube(3);');
await page.waitForTimeout(1500);
assert.doesNotMatch((await status()).text, /\b24 triangles/, 'not rendered while writing');
await page.click('#btnRunCode');
st = await waitRendered();
await page.waitForFunction(() => /\b24 triangles/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
console.log('code rendered on Render:', (await status()).text);

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
if (errors.length) process.exit(1);
