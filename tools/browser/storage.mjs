// Modellerna i IndexedDB (src/kv.ts): flytt från localStorage (gamla formatet och det allra äldsta
// med ett enda dokument), att ändringar finns kvar efter omladdning och att localStorage blir tom.
//   node storage.mjs [url] [utkatalog]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const opts = { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'sv-SE' };
const scad = readFileSync(new URL('../../tests/fixtures/snap_box.scad', import.meta.url));

async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.route('**/api/**', r => r.fulfill({ status: 204 }));
  return page;
}
const waitApp = page => page.waitForFunction(() => window.__scadshape?.doc, null, { timeout: 30000 });
/** Modellnycklarna i localStorage och innehållet i IndexedDB. */
const stores = page => page.evaluate(async () => {
  const local = Object.keys(localStorage).filter(k => /^scadshape\.(projects|current|doc(\..+)?)$/.test(k));
  const db = await new Promise((res, rej) => { const r = indexedDB.open('scadshape'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const st = db.transaction('kv').objectStore('kv');
  const get = req => new Promise(res => (req.onsuccess = () => res(req.result)));
  const [keys, values] = await Promise.all([get(st.getAllKeys()), get(st.getAll())]);
  db.close();
  return { local, idb: Object.fromEntries(keys.map((k, i) => [k, values[i]])) };
});

// 1. En riktig modell: snap_box.scad → Gör om till skisser.
let ctx = await browser.newContext(opts);
let page = await newPage(ctx);
await page.goto(url);
await waitApp(page);
await page.setInputFiles('#projFile', { name: 'snap_box.scad', mimeType: 'text/plain', buffer: scad });
await page.waitForSelector('#btnConvert', { state: 'visible', timeout: 60000 });
await page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.click('#btnConvert');
await page.waitForFunction(() => window.__scadshape.source === 'model' && window.__scadshape.doc.features.length > 5, null, { timeout: 120000 });
const doc = await page.evaluate(() => JSON.stringify(window.__scadshape.doc));
const nFeatures = JSON.parse(doc).features.length;
let s = await stores(page);
assert.deepEqual(s.local, [], 'nya modeller ska inte hamna i localStorage');
assert.ok(Object.keys(s.idb).some(k => k.startsWith('scadshape.doc.')), 'modellen ska finnas i IndexedDB');
console.log(`modell: ${nFeatures} features, i IndexedDB (${Object.keys(s.idb).length} nycklar), localStorage tom`);

// 2. Gamla formatet i localStorage (som före 2026-10-22) → flyttas vid nästa start och ersätter allt.
await page.evaluate(d => {
  localStorage.setItem('scadshape.projects', JSON.stringify([{ id: 'pold1', name: 'Gammal låda', updated: 1 }]));
  localStorage.setItem('scadshape.current', 'pold1');
  localStorage.setItem('scadshape.doc.pold1', d);
}, doc);
await page.reload();
await waitApp(page);
assert.equal(await page.textContent('#projName'), 'Gammal låda');
assert.equal(await page.evaluate(() => window.__scadshape.doc.features.length), nFeatures);
s = await stores(page);
assert.deepEqual(s.local, [], 'localStorage ska tömmas efter flytten');
assert.equal(s.idb['scadshape.doc.pold1'], doc, 'dokumentet ska flyttas oförändrat');
assert.equal(JSON.parse(s.idb['scadshape.projects']).length, 1);
console.log('flytt från localStorage: samma dokument, localStorage tömd');

// 3. Ändringar finns kvar efter omladdning (bara IndexedDB nu).
await page.click('#btnTree').catch(() => {});
await page.evaluate(() => document.querySelector('#btnProjects').click());
await page.click('#projNew');
const newName = await page.textContent('#projName');
await page.waitForTimeout(300);
await page.reload();
await waitApp(page);
assert.equal(await page.textContent('#projName'), newName);
s = await stores(page);
assert.equal(JSON.parse(s.idb['scadshape.projects']).length, 2);
assert.deepEqual(s.local, []);
console.log(`ny modell "${newName}" finns kvar efter omladdning`);
await page.screenshot({ path: `${out}/storage.png` });
await ctx.close();

// 4. Det allra äldsta formatet (ett enda dokument, "scadshape.doc") i en ny webbläsare.
ctx = await browser.newContext(opts);
page = await newPage(ctx);
await page.goto(new URL('licenses/SOURCES.txt', url).href); // samma ursprung, utan appen
await page.evaluate(d => localStorage.setItem('scadshape.doc', d), doc);
await page.goto(url);
await waitApp(page);
assert.equal(await page.evaluate(() => window.__scadshape.doc.features.length), nFeatures);
s = await stores(page);
assert.deepEqual(s.local, []);
assert.equal(JSON.parse(s.idb['scadshape.projects']).length, 1);
console.log('äldsta formatet (scadshape.doc) → första modellen i IndexedDB');
await ctx.close();

await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
if (errors.length) process.exit(1);
