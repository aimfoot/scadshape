// Text: with a model the button asks for a face and puts the text where it is tapped; fonts are
// loaded into the engine; engraved flips the direction.
// node text.mjs [url] [outdir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US' });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const fontRequests = [];
page.on('request', r => r.url().includes('/fonts/') && fontRequests.push(r.url().split('/').pop()));
const S = () => page.evaluate(() => ({ status: document.querySelector('#status').textContent, errors: [...window.__scadshape.model.errors.values()], features: window.__scadshape.doc.features.map(f => f.type) }));
const waitRendered = async () => {
  await page.waitForTimeout(450);
  await page.waitForFunction(() => !/Rendering|Loading/.test(document.querySelector('#status').textContent) && !/Cancel/.test(document.querySelector('#btnRender').textContent), null, { timeout: 60000 });
  return S();
};
await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); });
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));
assert.deepEqual(fontRequests, [], 'no fonts before text is used');

// Box first, then text on the face tapped in the middle of the view
await page.click('#btnContainer'); await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fp-lid [data-value="none"]'); await page.fill('#fp-height', '20'); await page.click('#fpOk'); await waitRendered();
await page.click('#btnText'); await page.waitForSelector('#faceBar:not([hidden])');
const mid = await page.evaluate(() => { const r = document.querySelector('#viewport canvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.touchscreen.tap(mid.x, mid.y); await page.waitForSelector('#featPanel:not([hidden])');
assert.equal(await page.evaluate(() => { const s = window.__scadshape; return Object.keys(s.doc.features.find(g => g.id === s.panel.f.sketch).points).length; }), 1, 'the text at the tapped point');
assert.equal(await page.inputValue('#fp-rep'), 'none', 'the pattern list shows None');
await page.fill('#fp-text', 'Screws M3'); await page.selectOption('#fp-font', 'stencil');
let st = await waitRendered();
assert.equal(st.errors.length, 0, st.errors.join()); assert.match(st.status, /triangles/);
assert.ok(fontRequests.includes('AllertaStencil-Regular.ttf'), fontRequests.join());
await page.screenshot({ path: `${out}/x-text.png` });
// Orbitron Black: the whole family is fetched (fontconfig picks the weight).
await page.selectOption('#fp-font', 'orbitron-black');
st = await waitRendered();
assert.equal(st.errors.length, 0, st.errors.join());
for (const f of ['Orbitron-Medium.ttf', 'Orbitron-Bold.ttf', 'Orbitron-Black.ttf']) assert.ok(fontRequests.includes(f), `${f}: ${fontRequests.join()}`);
assert.deepEqual(await page.$$eval('#fp-font option', os => os.map(o => o.textContent).filter(t => t.startsWith('Orbitron'))), ['Orbitron', 'Orbitron Bold', 'Orbitron Black']);
await page.screenshot({ path: `${out}/x-text-orbitron.png` });
await page.click('#fp-op [data-value="remove"]');
assert.equal(await page.getAttribute('#fp-direction [data-value="reverse"]', 'aria-pressed'), 'true');
await page.click('#fpOk'); st = await waitRendered();
assert.deepEqual(st.features, ['sketch', 'container', 'sketch', 'text']); assert.equal(st.errors.length, 0, st.errors.join());
if (await page.isHidden('#tree')) await page.click('#btnTree');
assert.match(await page.textContent('#featureList'), /”Screws M3” · 8 mm · engraved/);
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
