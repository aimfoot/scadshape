// .scad → skisser: öppna snap_box.scad, "Gör om till skisser", volymkontroll, redigera en skiss.
//   node convert.mjs [url] [utkatalog]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'sv-SE' });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const toasts = [];
await page.exposeFunction('__toast', t => toasts.push(t));
await page.addInitScript(() => new MutationObserver(() => { const t = document.querySelector('#partToast'); if (t && !t.hidden) window.__toast(t.textContent); }).observe(document, { subtree: true, childList: true, attributes: true }));

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'sv'); });
await page.reload();
await page.waitForFunction(() => /Börja med Skiss/.test(document.querySelector('#status').textContent));
assert.ok(await page.isHidden('#codeBar'), 'ingen konverteringsknapp för den egna modellen');

await page.click('#btnTree'); await page.click('#btnProjects');
const src = readFileSync(new URL('../../tests/fixtures/snap_box.scad', import.meta.url));
await page.setInputFiles('#projFile', { name: 'snap_box.scad', mimeType: 'application/octet-stream', buffer: src });
await page.waitForFunction(() => document.querySelector('#source').value === 'egen');
assert.ok(await page.isVisible('#btnConvert'));
await page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });

await page.click('#btnConvert');
await page.waitForFunction(() => document.querySelector('#source').value === 'model' && window.__scadshape.doc.features.length > 0, null, { timeout: 60000 });
await page.waitForFunction(() => /\d+ trianglar/.test(document.querySelector('#status').textContent) && !/Renderar|Gör om/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
const st = await page.evaluate(() => ({ types: window.__scadshape.doc.features.map(f => f.type), errors: [...window.__scadshape.model.errors.values()], name: document.querySelector('#source option[value=model]').textContent }));
assert.equal(st.name, 'snap_box'); assert.equal(st.errors.length, 0, st.errors.join());
const count = t => st.types.filter(x => x === t).length;
assert.deepEqual([count("sketch"), count("extrude"), count("revolve"), count("code")], [8, 6, 2, 1], st.types.join());
await page.waitForFunction(() => true);
for (let i = 0; i < 60 && !toasts.some(t => /Kontrollerat|Obs/.test(t)); i++) await page.waitForTimeout(500);
assert.ok(toasts.some(t => /Kontrollerat: samma volym/.test(t)), toasts.join(' | '));
console.log(toasts.filter(t => /Klart|Kontrollerat/.test(t)).join(' | '));
await page.screenshot({ path: `${out}/v-model.png` });

// Redigera en skiss: den första (lådans botten) har regioner och går att öppna
if (await page.isHidden('#tree')) await page.click('#btnTree');
await page.screenshot({ path: `${out}/v-tree.png` });
await page.locator('#featureList button.feature').first().click();
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.waitForTimeout(400);
assert.match(await page.textContent('#loopInfo'), /sluten region|slutna regioner/);
assert.match(await page.textContent('#loopInfo'), /2 frihetsgrader/, 'rundade lådan: bara läget fritt');
// Gör lådan 20 mm bredare via ytterbreddens mått
const w = await page.evaluate(() => {
  const e = window.__scadshape.editor;
  const c = e.sketch.constraints.filter(c => c.type === 'pldistance').sort((a, b) => b.value - a.value)[0];
  const xs = () => Object.values(e.sketch.points).map(p => p.x);
  const before = Math.max(...xs()) - Math.min(...xs());
  e.setDimension(c.id, c.value + 20);
  return { before, after: Math.max(...xs()) - Math.min(...xs()), value: c.value };
});
assert.ok(Math.abs(w.after - w.before - 20) < 1e-6, JSON.stringify(w));
await page.screenshot({ path: `${out}/v-sketch.png` });
await page.click('#btnDone');
await page.waitForFunction(() => /\d+ trianglar/.test(document.querySelector('#status').textContent) && !/Renderar/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
assert.equal((await page.evaluate(() => [...window.__scadshape.model.errors.values()])).length, 0);
console.log('ytterbredd', w.before.toFixed(2), '→', w.after.toFixed(2));
await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
