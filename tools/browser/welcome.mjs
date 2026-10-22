// Startkortet (src/ui/welcome.ts) och exempelmodellerna (src/examples/models.ts).
//   node welcome.mjs [url] [utkatalog]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'sv-SE' });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const card = () => page.isVisible('#startCard');
const doc = () => page.evaluate(() => window.__scadshape.doc);
const done = () => page.waitForFunction(() => /trianglar|triangles/.test(document.querySelector('#status').textContent) && !document.querySelector('#status').classList.contains('busy'), null, { timeout: 60000 });

await page.goto(url);
await page.waitForSelector('body:not(.loading)');

// 1. Första start: kortet med fyra steg och fyra exempel.
assert.ok(await card(), 'kortet ska synas i en tom modell');
assert.equal(await page.locator('#startCard .steps li').count(), 4);
assert.deepEqual(await page.$$eval('#startExamples b', bs => bs.map(b => b.textContent)), ['Låda med lock', 'Monteringsplatta', 'Skylt', 'Kopp']);
await page.screenshot({ path: `${out}/welcome.png` });

// 2. Skissläget döljer kortet; en tom skiss som lämnas tas bort → kortet tillbaka.
await page.click('#btnNewSketch');
await page.click('#planeDlg [data-plane="XY"]');
assert.equal(await page.evaluate(() => document.body.dataset.mode), 'sketch');
assert.equal(await card(), false, 'inte i skissläget');
await page.click('#btnDone');
assert.ok(await card(), 'tillbaka efter en tom skiss');

// 3. × stänger; ☰ → Kom igång visar igen.
await page.click('#startClose');
assert.equal(await card(), false);
await page.click('#btnTree');
await page.click('#btnStart');
assert.ok(await card(), 'Kom igång visar kortet');
assert.ok(await page.isHidden('#tree'), 'lådan stängs');

// 4. Varje exempel blir en ny modell, utan fel, och kortet försvinner.
const want = { 'Låda med lock': ['sketch', 'container'], Monteringsplatta: ['sketch', 'extrude', 'sketch', 'hole'], Skylt: ['sketch', 'extrude', 'sketch', 'text'], Kopp: ['sketch', 'revolve'] };
for (const [i, name] of Object.keys(want).entries()) {
  if (!(await card())) { await page.click('#btnTree'); await page.click('#btnStart'); }
  const before = await doc();
  await page.click(`#startExamples button >> nth=${i}`);
  await page.waitForFunction(b => window.__scadshape.doc !== b, before);
  await done();
  const st = await page.evaluate(() => ({ types: window.__scadshape.doc.features.map(f => f.type), errors: [...window.__scadshape.model.errors.values()], solids: window.__scadshape.model.solids, params: window.__scadshape.doc.params.map(p => p.name) }));
  assert.deepEqual(st.types, want[name], name);
  assert.deepEqual(st.errors, [], name);
  assert.ok(st.solids > 0, name);
  assert.equal(await card(), false, `${name}: kortet ska döljas`);
  assert.equal(await page.textContent('#projName'), name);
  console.log(`${name}: ${st.types.join(' + ')} · variabler ${st.params.join(', ')} · ${await page.textContent('#status')}`);
  if (i === 1) await page.screenshot({ path: `${out}/welcome-plate.png` });
}

// 5. Engelska: exemplens namn och variabler följer språket.
await page.click('#btnTree');
await page.selectOption('#lang', 'en');
await page.click('#btnStart');
assert.deepEqual(await page.$$eval('#startExamples b', bs => bs.map(b => b.textContent)), ['Box with lid', 'Mounting plate', 'Sign', 'Cup']);
const before = await doc();
await page.click('#startExamples button >> nth=0');
await page.waitForFunction(b => window.__scadshape.doc !== b, before);
assert.deepEqual(await page.evaluate(() => window.__scadshape.doc.params.map(p => p.name)), ['width', 'depth', 'height']);
console.log('engelska: Box with lid · width, depth, height');

await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
if (errors.length) process.exit(1);
