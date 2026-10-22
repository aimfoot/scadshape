// Behållare: mallskiss när det inte finns någon skiss, lockval, avbryt tar bort mallen, OK ger två kroppar.
//   node container.mjs [url] [utkatalog]
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
const S = () => page.evaluate(() => ({ status: document.querySelector('#status').textContent, solids: window.__scadshape.model.solids, errors: [...window.__scadshape.model.errors.values()], features: window.__scadshape.doc.features.map(f => f.type) }));
const waitRendered = async () => {
  await page.waitForTimeout(450);
  await page.waitForFunction(() => !/Renderar|Rendering|Laddar|Loading/.test(document.querySelector('#status').textContent) && !/Avbryt|Cancel/.test(document.querySelector('#btnRender').textContent), null, { timeout: 60000 });
  return S();
};

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'sv'); });
await page.reload();
await page.waitForFunction(() => /Börja med Skiss/.test(document.querySelector('#status').textContent));

// 1. Behållare utan skiss → mallskiss 80 × 60 och panel med insticks­lock
await page.click('#btnContainer'); await page.waitForSelector('#featPanel:not([hidden])');
let st = await waitRendered();
assert.deepEqual(st.features, ['sketch']); // featuren läggs in först vid OK
assert.equal(st.errors.length, 0, st.errors.join());
assert.match(await page.textContent('#fpRegions'), /1 av 1 regioner/);
assert.equal(await page.inputValue('#fp-height'), '40');
assert.equal(await page.getAttribute('#fp-lid [data-value="lip"]', 'aria-pressed'), 'true');
await page.screenshot({ path: `${out}/c-lip.png` });

// 2. Skruvlock kräver cirkel; Inget lock döljer spelet
await page.click('#fp-lid [data-value="screw"]'); st = await waitRendered();
assert.match(await page.textContent('#fpError'), /cirkel/);
assert.ok(await page.isHidden('#fp-radius'));
await page.click('#fp-lid [data-value="none"]'); st = await waitRendered();
assert.ok(await page.isHidden('#fpError')); assert.ok(await page.isHidden('#fp-clearance'));

// 3. Avbryt tar bort mallskissen
await page.click('#fpCancel'); await page.waitForTimeout(300);
assert.deepEqual((await S()).features, []);

// 4. Igen, med lock, OK → skiss + behållare, två kroppar i koden
await page.click('#btnContainer'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-height', '30'); await page.fill('#fp-cellsX', '3'); await page.fill('#fp-cellsY', '2'); await page.click('#fpOk');
st = await waitRendered();
assert.deepEqual(st.features, ['sketch', 'container']);
assert.equal(st.errors.length, 0, st.errors.join());
assert.match(st.status, /trianglar/);
const code = await page.evaluate(() => window.__scadshape.model.code);
assert.match(code, /behallare_1\(\);[\s\S]*behallare_1_lid\(\);/);
assert.equal((code.match(/cube\(/g) ?? []).length, 3, 'två avdelare i X och en i Y');
await page.screenshot({ path: `${out}/c-cells.png` });

// 5. Mallskissen är fullt bestämd (svart) och behåller måtten när den löses
if (await page.isHidden('#tree')) await page.click('#btnTree');
await page.locator('#featureList button.feature').first().click();
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.waitForTimeout(300);
const ed = await page.evaluate(() => ({ dof: window.__scadshape.editor.dof, xs: Object.values(window.__scadshape.editor.sketch.points).map(p => Math.round(p.x)).sort((a, b) => a - b) }));
assert.equal(ed.dof, 0, `dof ${ed.dof}`);
assert.deepEqual([...new Set(ed.xs)], [-40, 0, 40]);
await page.screenshot({ path: `${out}/c-sketch.png` });
await page.click('#btnDone'); st = await waitRendered();
await page.screenshot({ path: `${out}/c-done.png` });

await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
