// Text: knappen utan skiss skapar en skiss; typsnitt laddas i motorn; ingraverad vänder riktningen.
//   node text.mjs [url] [utkatalog]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'sv-SE' });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const fontRequests = [];
page.on('request', r => r.url().includes('/fonts/') && fontRequests.push(r.url().split('/').pop()));
const S = () => page.evaluate(() => ({ status: document.querySelector('#status').textContent, errors: [...window.__scadshape.model.errors.values()], features: window.__scadshape.doc.features.map(f => f.type) }));
const waitRendered = async () => {
  await page.waitForTimeout(450);
  await page.waitForFunction(() => !/Renderar|Laddar/.test(document.querySelector('#status').textContent) && !/Avbryt/.test(document.querySelector('#btnRender').textContent), null, { timeout: 60000 });
  return S();
};
await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'sv'); });
await page.reload();
await page.waitForFunction(() => /Börja med Skiss/.test(document.querySelector('#status').textContent));
assert.deepEqual(fontRequests, [], 'inga typsnitt innan text används');

// Låda först, sedan text (utan egen skiss används lådans skiss – texten i origo)
await page.click('#btnContainer'); await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fp-lid [data-value="none"]'); await page.fill('#fp-height', '20'); await page.click('#fpOk'); await waitRendered();
await page.click('#btnText'); await page.waitForSelector('#featPanel:not([hidden])');
assert.match(await page.textContent('#fpRegions'), /origo/);
assert.equal(await page.inputValue('#fp-rep'), 'none', 'mönsterlistan visar Ingen');
await page.fill('#fp-text', 'Skruvar M3'); await page.selectOption('#fp-font', 'stencil');
let st = await waitRendered();
assert.equal(st.errors.length, 0, st.errors.join()); assert.match(st.status, /trianglar/);
assert.ok(fontRequests.includes('AllertaStencil-Regular.ttf'), fontRequests.join());
await page.screenshot({ path: `${out}/x-text.png` });
// Orbitron Black: hela familjen hämtas (fontconfig väljer vikten).
await page.selectOption('#fp-font', 'orbitron-black');
st = await waitRendered();
assert.equal(st.errors.length, 0, st.errors.join());
for (const f of ['Orbitron-Medium.ttf', 'Orbitron-Bold.ttf', 'Orbitron-Black.ttf']) assert.ok(fontRequests.includes(f), `${f}: ${fontRequests.join()}`);
assert.deepEqual(await page.$$eval('#fp-font option', os => os.map(o => o.textContent).filter(t => t.startsWith('Orbitron'))), ['Orbitron', 'Orbitron Bold', 'Orbitron Black']);
await page.screenshot({ path: `${out}/x-text-orbitron.png` });
await page.click('#fp-op [data-value="remove"]'); await page.fill('#fp-start', '2'); // in i lådans botten
assert.equal(await page.getAttribute('#fp-direction [data-value="reverse"]', 'aria-pressed'), 'true');
await page.click('#fpOk'); st = await waitRendered();
assert.deepEqual(st.features, ['sketch', 'container', 'text']); assert.equal(st.errors.length, 0, st.errors.join());
if (await page.isHidden('#tree')) await page.click('#btnTree');
assert.match(await page.textContent('#featureList'), /”Skruvar M3” · 8 mm · ingraverad/);
await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
