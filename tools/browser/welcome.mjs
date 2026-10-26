// The start card (src/ui/welcome.ts) and the example models (src/examples/models.ts).
// node welcome.mjs [url] [outdir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US' });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const card = () => page.isVisible('#startCard');
const doc = () => page.evaluate(() => window.__scadshape.doc);
const done = () => page.waitForFunction(() => /trianglar|triangles/.test(document.querySelector('#status').textContent) && !document.querySelector('#status').classList.contains('busy'), null, { timeout: 60000 });

await page.goto(url);
await page.waitForSelector('body:not(.loading)');

// 1. First start: the card with four steps and four examples.
assert.ok(await card(), 'the card should show in an empty model');
assert.equal(await page.locator('#startCard .steps li').count(), 4);
assert.deepEqual(await page.$$eval('#startExamples b', bs => bs.map(b => b.textContent)), ['Box with lid', 'Mounting plate', 'Sign', 'Cup']);
await page.screenshot({ path: `${out}/welcome.png` });

// 2. Sketch mode hides the card; an empty sketch that is left is removed → the card comes back.
await page.click('#btnNewSketch');
await page.click('#planeDlg [data-plane="XY"]');
assert.equal(await page.evaluate(() => document.body.dataset.mode), 'sketch');
assert.equal(await card(), false, 'not in sketch mode');
await page.click('#btnDone');
assert.ok(await card(), 'back after an empty sketch');

// 3. × closes; ☰ → Get started shows it again.
await page.click('#startClose');
assert.equal(await card(), false);
await page.click('#btnStart');
assert.ok(await card(), 'Get started shows the card');
assert.ok(await page.isHidden('#tree'), 'the drawer closes');

// 4. Every example becomes a new model, without errors, and the card disappears.
const want = { 'Box with lid': ['sketch', 'extrude', 'extrude', 'sketch', 'extrude', 'extrude', 'extrude'], 'Mounting plate': ['sketch', 'extrude', 'sketch', 'hole'], Sign: ['sketch', 'extrude', 'sketch', 'text'], Cup: ['sketch', 'revolve'] };
for (const [i, name] of Object.keys(want).entries()) {
  if (!(await card())) { await page.click('#btnStart'); }
  const before = await doc();
  await page.click(`#startExamples button >> nth=${i}`);
  await page.waitForFunction(b => window.__scadshape.doc !== b, before);
  await done();
  const st = await page.evaluate(() => ({ types: window.__scadshape.doc.features.map(f => f.type), errors: [...window.__scadshape.model.errors.values()], solids: window.__scadshape.model.solids, params: window.__scadshape.doc.params.map(p => p.name) }));
  assert.deepEqual(st.types, want[name], name);
  assert.deepEqual(st.errors, [], name);
  assert.ok(st.solids > 0, name);
  assert.equal(await card(), false, `${name}: the card should be hidden`);
  assert.equal(await page.textContent('#projName'), name);
  console.log(`${name}: ${st.types.join(' + ')} · variables ${st.params.join(', ')} · ${await page.textContent('#status')}`);
  if (i === 1) await page.screenshot({ path: `${out}/welcome-plate.png` });
}

const openSettings = async () => {
  if (await page.evaluate(() => document.querySelector('#settingsDlg').open)) return;
  await page.click('#btnSettings');
};
const closeSettings = () => page.evaluate(() => document.querySelector('#settingsDlg').close());
// 5. Swedish: the examples' names and variables follow the language.
await openSettings();
await page.selectOption('#lang', 'sv');
await closeSettings();
await page.click('#btnStart');
assert.deepEqual(await page.$$eval('#startExamples b', bs => bs.map(b => b.textContent)), ['Låda med lock', 'Monteringsplatta', 'Skylt', 'Kopp']);
const before = await doc();
await page.click('#startExamples button >> nth=0');
await page.waitForFunction(b => window.__scadshape.doc !== b, before);
assert.deepEqual(await page.evaluate(() => window.__scadshape.doc.params.map(p => p.name)), ['bredd', 'djup', 'höjd', 'vägg', 'botten', 'spel', 'hörn', 'kant']);
assert.deepEqual(await page.evaluate(() => window.__scadshape.doc.features.slice(1).map(f => f.name)), ['Låda', 'Urholkning', 'Skiss lock', 'Lock', 'Lockkant', 'Lockkantens insida']);
console.log('swedish: Låda med lock · bredd, djup, höjd + the parts\' shared sizes; Swedish part names');

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
if (errors.length) process.exit(1);
