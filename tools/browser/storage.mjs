// The models in IndexedDB (src/kv.ts): migration from localStorage (the old format and the very
// oldest
// one with a single document), that changes survive a reload and that localStorage ends up empty.
// node storage.mjs [url] [outdir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const opts = { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US' };
const scad = readFileSync(new URL('../../tests/fixtures/snap_box.scad', import.meta.url));

async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.route('**/api/**', r => r.fulfill({ status: 204 }));
  return page;
}
const waitApp = page => page.waitForFunction(() => window.__scadshape?.doc, null, { timeout: 30000 });
/** The model keys in localStorage and the contents of IndexedDB. */
const stores = page => page.evaluate(async () => {
  const local = Object.keys(localStorage).filter(k => /^scadshape\.(projects|current|doc(\..+)?)$/.test(k));
  const db = await new Promise((res, rej) => { const r = indexedDB.open('scadshape'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const st = db.transaction('kv').objectStore('kv');
  const get = req => new Promise(res => (req.onsuccess = () => res(req.result)));
  const [keys, values] = await Promise.all([get(st.getAllKeys()), get(st.getAll())]);
  db.close();
  return { local, idb: Object.fromEntries(keys.map((k, i) => [k, values[i]])) };
});

// 1. A real model: snap_box.scad → Convert to sketches.
let ctx = await browser.newContext(opts);
let page = await newPage(ctx);
await page.goto(url);
await waitApp(page);
await page.setInputFiles('#projFile', { name: 'snap_box.scad', mimeType: 'text/plain', buffer: scad });
await page.waitForSelector('#btnConvert', { state: 'visible', timeout: 60000 });
await page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.click('#btnConvert');
await page.waitForFunction(() => window.__scadshape.source === 'model' && window.__scadshape.doc.features.length > 5, null, { timeout: 120000 });
const doc = await page.evaluate(() => JSON.stringify(window.__scadshape.doc));
const nFeatures = JSON.parse(doc).features.length;
let s = await stores(page);
assert.deepEqual(s.local, [], 'new models should not end up in localStorage');
assert.ok(Object.keys(s.idb).some(k => k.startsWith('scadshape.doc.')), 'the model should be in IndexedDB');
console.log(`model: ${nFeatures} features, in IndexedDB (${Object.keys(s.idb).length} keys), localStorage empty`);

// 2. The old format in localStorage (as before 2026-10-22) → moved at the next start and replaces
// everything.
await page.evaluate(d => {
  localStorage.setItem('scadshape.projects', JSON.stringify([{ id: 'pold1', name: 'Old box', updated: 1 }]));
  localStorage.setItem('scadshape.current', 'pold1');
  localStorage.setItem('scadshape.doc.pold1', d);
}, doc);
await page.reload();
await waitApp(page);
assert.equal(await page.textContent('#projName'), 'Old box');
assert.equal(await page.evaluate(() => window.__scadshape.doc.features.length), nFeatures);
s = await stores(page);
assert.deepEqual(s.local, [], 'localStorage should be emptied after the move');
assert.equal(s.idb['scadshape.doc.pold1'], doc, 'the document should be moved unchanged');
assert.equal(JSON.parse(s.idb['scadshape.projects']).length, 1);
console.log('move from localStorage: same document, localStorage emptied');

// 3. Changes survive a reload (only IndexedDB now).
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
console.log(`new model "${newName}" is still there after reload`);
await page.screenshot({ path: `${out}/storage.png` });
await ctx.close();

// 4. The very oldest format (a single document, "scadshape.doc") in a new browser.
ctx = await browser.newContext(opts);
page = await newPage(ctx);
await page.goto(new URL('licenses/SOURCES.txt', url).href); // same origin, without the app
await page.evaluate(d => localStorage.setItem('scadshape.doc', d), doc);
await page.goto(url);
await waitApp(page);
assert.equal(await page.evaluate(() => window.__scadshape.doc.features.length), nFeatures);
s = await stores(page);
assert.deepEqual(s.local, []);
assert.equal(JSON.parse(s.idb['scadshape.projects']).length, 1);
console.log('oldest format (scadshape.doc) → the first model in IndexedDB');
await ctx.close();

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
if (errors.length) process.exit(1);
