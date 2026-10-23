// Repeat and edges in the feature panel: the fields show after a choice, the model builds without
// errors, the tree shows ×N.
// node pattern.mjs [url] [outdir]
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
const S = () => page.evaluate(() => ({ status: document.querySelector('#status').textContent, errors: [...window.__scadshape.model.errors.values()], code: window.__scadshape.model.code }));
const waitRendered = async () => {
  await page.waitForTimeout(450);
  await page.waitForFunction(() => !/Rendering|Loading/.test(document.querySelector('#status').textContent) && !/Cancel/.test(document.querySelector('#btnRender').textContent), null, { timeout: 60000 });
  return S();
};
await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); });
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));
await page.click('#btnContainer'); await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fp-lid [data-value="none"]'); await page.click('#fpOk'); await waitRendered();

// Extrude the same sketch downward with a chamfered edge and three copies in X
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
assert.ok(await page.isHidden('#fp-edgeSize'));
await page.fill('#fp-depth', '4'); await page.click('#fp-direction [data-value="reverse"]');
await page.click('#fp-edge [data-value="chamfer"]');
assert.ok(await page.isVisible('#fp-edgeSize')); await page.fill('#fp-edgeSize', '1');
assert.ok(await page.isHidden('#fp-repCount'));
await page.selectOption('#fp-rep', 'linear');
assert.ok(await page.isVisible('#fp-repCount')); assert.ok(await page.isHidden('#fp-repAxis2'));
assert.equal(await page.inputValue('#fp-repCount'), '3');
await page.fill('#fp-repSpacing', '90');
let st = await waitRendered();
await page.screenshot({ path: `${out}/p-panel.png` });
assert.equal(st.errors.length, 0, st.errors.join());
await page.selectOption('#fp-rep', 'circular');
assert.equal(await page.getAttribute('#fp-repRotAxis [data-value="z"]', 'aria-pressed'), 'true');
assert.ok(await page.isVisible('#fp-repAngle'));
// Around circle: the list shows circles in earlier sketches, the first preselected, the axis in the
// code goes through its center
assert.ok(await page.isHidden('#fp-repCircle'));
await page.click('#fp-repRotAxis [data-value="circle"]');
assert.ok(await page.isVisible('#fp-repCircle'));
assert.match(await page.textContent('#fp-repCircle'), /No circles/);
st = await waitRendered(); assert.match(st.errors.join(), /pick a circle/);
await page.selectOption('#fp-rep', 'linear');
await page.click('#fpOk'); await waitRendered();
await page.evaluate(() => {
  const sk = window.__scadshape.doc.features.find(f => f.type === 'sketch');
  sk.points.pc = { x: 25, y: 15 }; sk.entities.ec = { type: 'circle', c: 'pc', r: 5 };
});
await page.click('#btnTree').catch(() => {});
if (await page.isHidden('#tree')) await page.click('#btnTree');
await page.locator('#featureList li').last().click();
await page.waitForSelector('#featPanel:not([hidden])');
await page.selectOption('#fp-rep', 'circular');
await page.click('#fp-repRotAxis [data-value="circle"]');
assert.match(await page.textContent('#fp-repCircle'), /Ø10 \(25, 15\)/);
st = await waitRendered(); assert.equal(st.errors.length, 0, st.errors.join());
assert.match(st.code, /translate\(\[25, 15, 0\]\) rotate\(a = i \* 360 \/ 3, v = \[0, 0, 1\]\) translate\(\[-25, -15, -0\]\)|translate\(\[25, 15, 0\]\) rotate\(a = i \* 360 \/ 3, v = \[0, 0, 1\]\) translate\(\[-25, -15, 0\]\)/);
await page.screenshot({ path: `${out}/p-circle.png` });
await page.selectOption('#fp-rep', 'linear');
await page.click('#fpOk'); st = await waitRendered();
assert.equal(st.errors.length, 0, st.errors.join());
assert.match(st.code, /for \(i = \[0 : 3 - 1\]\) translate\(i \* 90 \* \[1, 0, 0\]\) extrude_1\(\);/);
if (await page.isHidden('#tree')) await page.click('#btnTree');
assert.match(await page.textContent('#featureList'), /4 mm ↓ · chamfered 1 · ×3/);
await page.screenshot({ path: `${out}/p-done.png` });
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
