// Import of STL (body) and SVG (sketch) in headless Chromium.
// node import.mjs [url] [outdir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const opts = { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US', acceptDownloads: true };

/** Binary STL: cube 20 mm with the corner at (100, 100, 50). */
function cubeStl(o = [100, 100, 50], s = 20) {
  const v = (x, y, z) => [o[0] + x * s, o[1] + y * s, o[2] + z * s];
  const q = [[[0,0,0],[0,1,0],[1,1,0],[1,0,0]], [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], [[0,0,0],[1,0,0],[1,0,1],[0,0,1]],
    [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], [[1,0,0],[1,1,0],[1,1,1],[1,0,1]]];
  const tris = q.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]).map(t => t.map(p => v(...p)));
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((p, k) => p.forEach((c, j) => buf.writeFloatLE(c, 84 + i * 50 + 12 + k * 12 + j * 4))));
  return buf;
}
const svgPlate = `<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="40mm" viewBox="0 0 80 40">
  <rect x="0" y="0" width="80" height="40" rx="5"/><circle cx="15" cy="20" r="4"/><circle cx="65" cy="20" r="4"/><text x="30" y="20">hej</text></svg>`;
const star = n => `<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="-25 -25 50 50"><polygon points="${
  Array.from({ length: n }, (_, i) => { const r = i % 2 ? 10 : 24, a = (i / n) * 2 * Math.PI; return `${(r * Math.cos(a)).toFixed(3)},${(r * Math.sin(a)).toFixed(3)}`; }).join(' ')}"/></svg>`;

async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.route('**/api/**', r => r.fulfill({ status: 204 }));
  return page;
}
const S = page => page.evaluate(() => ({ status: document.querySelector('#status').textContent, solids: window.__scadshape.model.solids, errors: [...window.__scadshape.model.errors.values()], code: window.__scadshape.model.code }));
const waitRendered = async page => {
  await page.waitForTimeout(500);
  await page.waitForFunction(() => /triangles|no solid|empty/i.test(document.querySelector('#status').textContent) && !/Rendering|Loading/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
  return S(page);
};
const bbox = page => page.evaluate(() => {
  const p = window.__scadshape.viewer.meshPositions; const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) { mn[i % 3] = Math.min(mn[i % 3], p[i]); mx[i % 3] = Math.max(mx[i % 3], p[i]); }
  return { min: mn.map(v => Math.round(v * 1000) / 1000), max: mx.map(v => Math.round(v * 1000) / 1000) };
});
const openTree = async page => { if (await page.isHidden('#tree')) await page.click('#btnTree'); };
const pick = (page, name, mimeType, buffer) => page.setInputFiles('#importFile', { name, mimeType, buffer });

const ctx = await browser.newContext(opts);
let page = await newPage(ctx);
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();

// 1. STL: the panel opens; centered on the plate → the cube 20 mm around the origin with the bottom
// at Z = 0.
await pick(page, 'cube.stl', 'model/stl', cubeStl());
await page.waitForSelector('#featPanel:not([hidden])');
assert.match(await page.textContent('#fpTitle'), /Imported body|cube/);
await page.click('#fpOk');
let st = await waitRendered(page);
assert.equal(st.errors.length, 0, st.errors.join()); assert.equal(st.solids, 1);
assert.match(st.code, /import\("\/imports\/[0-9a-f]{24}\.stl"/);
let b = await bbox(page);
assert.deepEqual(b, { min: [-10, -10, 0], max: [10, 10, 20] }, JSON.stringify(b));
assert.match(await page.textContent('#featureList'), /cube/);
console.log('stl:', st.status, JSON.stringify(b));

// 2. Change: scale 50 %, Z = 5 (tap the feature in the tree → edit).
await openTree(page);
await page.locator('#featureList li', { hasText: 'cube' }).first().click();
await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-scale', '50'); await page.fill('#fp-z', '5'); await page.click('#fpOk');
st = await waitRendered(page);
b = await bbox(page);
assert.deepEqual(b, { min: [-5, -5, 5], max: [5, 5, 15] }, JSON.stringify(b));

// 3. Reloaded: the file is still there (IndexedDB).
await page.reload();
st = await waitRendered(page);
assert.equal(st.errors.length, 0, st.errors.join());
assert.deepEqual(await bbox(page), { min: [-5, -5, 5], max: [5, 5, 15] });
console.log('after reload:', st.status);

// 4. SVG: plate 80 × 40 with rounded corners and two holes; text is skipped. Width 60, center at
// the origin.
await pick(page, 'plate.svg', 'image/svg+xml', Buffer.from(svgPlate));
await page.waitForSelector('#svgDlg[open]');
assert.match(await page.textContent('#svgSize'), /80 × 40 mm/);
assert.match(await page.textContent('#svgIgnored'), /1 text/);
assert.match(await page.textContent('#svgStats'), /14 points · 4 lines · 4 arcs · 2 circles/, await page.textContent('#svgStats'));
assert.equal(await page.isChecked('#svgLock'), false);
await page.fill('#svgWidth', '60');
assert.match(await page.textContent('#svgHeight'), /× 30 mm/);
await page.click('#svgOrigin [data-origin="center"]');
await page.click('#svgOk');
await page.waitForSelector('#planeDlg[open]');
assert.match(await page.textContent('#planeDlg h2'), /SVG/);
await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
const sk = await page.evaluate(() => { const e = window.__scadshape.editor; const xs = Object.values(e.sketch.points).map(p => p.x); return { loops: e.loopCount, dof: e.dof, name: e.sketch.name, minX: Math.min(...xs), maxX: Math.max(...xs) }; });
assert.equal(sk.loops, 1, JSON.stringify(sk)); assert.equal(sk.name, 'plate'); assert.ok(sk.dof > 0);
assert.ok(Math.abs(sk.minX + 30) < 1e-6 && Math.abs(sk.maxX - 30) < 1e-6, JSON.stringify(sk));
await page.screenshot({ path: `${out}/im-svg-sketch.png` });
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])'); await page.fill('#fp-depth', '3'); await page.click('#fpOk');
st = await waitRendered(page);
assert.equal(st.errors.length, 0, st.errors.join());
b = await bbox(page);
assert.deepEqual(b, { min: [-30, -15, 0], max: [30, 15, 15] }, JSON.stringify(b));
await page.screenshot({ path: `${out}/im-3d.png` });
console.log('svg:', st.status, JSON.stringify(b));

// 5. A large SVG (star with 400 corners) is locked automatically; 2000 corners cannot be unlocked.
await pick(page, 'star.svg', 'image/svg+xml', Buffer.from(star(400)));
await page.waitForSelector('#svgDlg[open]');
assert.equal(await page.isChecked('#svgLock'), true); assert.equal(await page.isDisabled('#svgLock'), false);
await page.click('#svgDlg form button');
await pick(page, 'star.svg', 'image/svg+xml', Buffer.from(star(2000)));
await page.waitForSelector('#svgDlg[open]');
assert.equal(await page.isChecked('#svgLock'), true); assert.equal(await page.isDisabled('#svgLock'), true);
await page.click('#svgOk');
await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
const big = await page.evaluate(() => ({ loops: window.__scadshape.editor.loopCount, dof: window.__scadshape.editor.dof, info: document.querySelector('#loopInfo').textContent }));
assert.equal(big.loops, 1); assert.equal(big.dof, 0, JSON.stringify(big));
console.log('large svg:', big.info);
await page.click('#btnDone');

// 6. The .scad export points to the original file.
await page.click('#btnExport');
await page.click('#exFormat [data-format="scad"]');
await page.waitForFunction(() => !document.querySelector('#exDownload').disabled);
let dl = page.waitForEvent('download');
await page.click('#exDownload');
const scad = readFileSync(await (await dl).path(), 'utf8');
assert.match(scad, /import\("cube\.stl", convexity = 10\)/);
await page.keyboard.press('Escape');

// 7. Save the model as a file and open it in a new browser profile (no IndexedDB): the STL file
// comes along.
await openTree(page);
await page.click('#btnProjects');
dl = page.waitForEvent('download');
await page.click('#projExport');
const json = readFileSync(await (await dl).path(), 'utf8');
assert.ok(JSON.parse(json).files && Object.keys(JSON.parse(json).files).length === 1, 'the file is embedded');
const ctx2 = await browser.newContext(opts);
const p2 = await newPage(ctx2);
await p2.goto(url);
await openTree(p2);
await p2.click('#btnProjects');
await p2.setInputFiles('#projFile', { name: 'model.scadshape.json', mimeType: 'application/json', buffer: Buffer.from(json) });
st = await waitRendered(p2);
assert.equal(st.errors.length, 0, st.errors.join());
assert.equal(st.solids, 2, "the cube + the extruded plate");
console.log('opened in a new profile:', st.status);

// 8. A model whose file is missing shows the error in the tree.
const ctx3 = await browser.newContext(opts);
const p3 = await newPage(ctx3);
await p3.goto(url);
const noFiles = JSON.stringify({ ...JSON.parse(json), files: undefined });
await openTree(p3); await p3.click('#btnProjects');
await p3.setInputFiles('#projFile', { name: 'without.scadshape.json', mimeType: 'application/json', buffer: Buffer.from(noFiles) });
st = await waitRendered(p3);
assert.ok(st.errors.some(e => /cube\.stl is not in this browser/.test(e)), st.errors.join());
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
