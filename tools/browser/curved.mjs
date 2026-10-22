// Skissa på en rund yta (cylinderns mantel): hela ytan syns i skissen och går att snäppa till.
//   node curved.mjs [url] [utkatalog]
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
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
const tapSk = async p => { const c = await C(p); await touch('touchStart', [c]); await touch('touchEnd', []); };
const waitRendered = async () => {
  await page.waitForTimeout(450);
  await page.waitForFunction(() => !/Renderar|Laddar/.test(document.querySelector('#status').textContent) && !/Avbryt/.test(document.querySelector('#btnRender').textContent), null, { timeout: 60000 });
  return page.evaluate(() => [...window.__scadshape.model.errors.values()]);
};
const tapWorld = async (x, y, z) => {
  const p = await page.evaluate(([x, y, z]) => window.__scadshape.viewer.screenOfWorld(x, y, z), [x, y, z]);
  const r = await page.evaluate(() => document.querySelector('#viewport canvas').getBoundingClientRect().toJSON());
  await touch('touchStart', [{ x: r.left + p.x, y: r.top + p.y }]); await touch('touchEnd', []);
};
const pickFace = async (x, y, z) => {
  await page.click('#btnNewSketch');
  await page.click('#btnPickFace');
  await page.waitForSelector('#faceBar:not([hidden])');
  await tapWorld(x, y, z);
  await page.waitForFunction(() => document.body.dataset.mode === 'sketch');
  await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
};

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => /Börja med Skiss/.test(document.querySelector('#status').textContent));
// Stående cylinder Ø20 × 20 i origo
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.click('[data-tool="circle"]');
await tapSk({ x: 0, y: 0 }); await tapSk({ x: 10, y: 0 });
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', '20'); await page.click('#fpOk');
assert.deepEqual(await waitRendered(), []);
await page.click('[data-view="iso"]');
// Tryck på manteln
await pickFace(10 * Math.cos(-Math.PI / 4), 10 * Math.sin(-Math.PI / 4), 10);
const ref = await page.evaluate(() => { const e = window.__scadshape.editor; const r = e.reference; if (!r) return null; const xs = r.segments.flat().map(p => p.x), ys = r.segments.flat().map(p => p.y); return { n: r.segments.length, snaps: r.snaps.length, x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] }; });
console.log('referens:', JSON.stringify(ref), await page.textContent('#sketchTitle'));
assert.ok(ref.n > 20, 'hela manteln, inte bara en facett');
assert.ok(Math.abs(ref.x[1] - ref.x[0] - 20) < 0.05 && Math.abs(ref.y[1] - ref.y[0] - 20) < 1e-3, 'konturen är 20 × 20 (diameter × höjd)');
const R = await page.evaluate(() => window.__scadshape.editor.reference);
const touchLine = R.segments.find(([a, b]) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(Math.abs(a.y - b.y) - 20) < 1e-6 && a.x > ref.x[0] + 1 && a.x < ref.x[1] - 1);
assert.ok(touchLine, 'beröringslinjen mitt på');
const tl = R.snaps.find(p => Math.abs(p.x - ref.x[0]) < 1e-6 && Math.abs(p.y - 20) < 1e-6);
assert.ok(tl, 'övre vänstra hörnet är ett snäpp');
// Rektangel från nära hörnet → hörnet snäpper exakt dit
const drag = async (a, b) => {
  const ca = await C(a), cb = await C(b);
  await touch('touchStart', [ca]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: ca.x + ((cb.x - ca.x) * i) / 6, y: ca.y + ((cb.y - ca.y) * i) / 6 }]);
  await touch('touchEnd', []);
};
await page.click('[data-tool="rect"]');
await drag({ x: tl.x + 0.3, y: 19.7 }, { x: touchLine[0].x - 3, y: 12 });
let pts = await page.evaluate(() => Object.values(window.__scadshape.editor.sketch.points));
assert.ok(pts.some(p => Math.abs(p.x - tl.x) < 1e-9 && Math.abs(p.y - 20) < 1e-9), 'rektangelns hörn på ytans hörn');
// Linje från nära beröringslinjen → startar på den
await page.click('[data-tool="line"]');
await tapSk({ x: touchLine[0].x + 0.3, y: 6 }); await tapSk({ x: touchLine[0].x + 5, y: 6 }); await tapSk({ x: touchLine[0].x + 5, y: 6 });
pts = await page.evaluate(() => Object.values(window.__scadshape.editor.sketch.points));
assert.ok(pts.some(p => Math.abs(p.x - touchLine[0].x) < 1e-6 && Math.abs(p.y - 6) < 0.5), 'linjen startar på beröringslinjen');
console.log('snäpp till ytans hörn och beröringslinjen ok');
await page.screenshot({ path: `${out}/curved.png` });
// Skär in rektangeln i cylindern
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', '3'); await page.click('#fp-op [data-value="remove"]');
await page.click('#fpOk');
assert.deepEqual(await waitRendered(), []);
await page.screenshot({ path: `${out}/curved-3d.png` });

// Klack utåt en bit från beröringslinjen: förlängs in till den runda ytan (sätet), en enda kropp
const bodies = () => page.evaluate(() => {
  const p = window.__scadshape.viewer.meshPositions, parent = new Map();
  const key = i => `${Math.round(p[i] * 1e3)},${Math.round(p[i + 1] * 1e3)},${Math.round(p[i + 2] * 1e3)}`;
  const find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  for (let t = 0; t < p.length; t += 9) {
    const ks = [key(t), key(t + 3), key(t + 6)];
    for (const k of ks) if (!parent.has(k)) parent.set(k, k);
    parent.set(find(ks[1]), find(ks[0])); parent.set(find(ks[2]), find(ks[0]));
  }
  return new Set([...parent.keys()].map(find)).size;
});
assert.equal(await bodies(), 1);
await pickFace(10 * Math.cos(-Math.PI / 4), 10 * Math.sin(-Math.PI / 4), 10);
const tx = await page.evaluate(() => { const r = window.__scadshape.editor.reference; return r.segments.find(([a, b]) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(Math.abs(a.y - b.y) - 20) < 1e-6 && Math.abs(a.x) < 2)?.[0].x; });
await page.click('[data-tool="rect"]');
await drag({ x: tx + 3, y: 4 }, { x: tx + 8, y: 9 });
await page.click('#btnDone');
const seat = await page.evaluate(() => window.__scadshape.doc.features.filter(f => f.type === 'sketch').at(-1).seat);
assert.ok(seat > 0.5 && seat < 10, `säte ${seat}`);
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', '2'); await page.click('#fpOk');
assert.deepEqual(await waitRendered(), []);
assert.equal(await bodies(), 1, 'klacken sitter ihop med cylindern');
console.log('klack på rund yta: säte', seat, 'mm, en kropp');
await page.screenshot({ path: `${out}/curved-boss.png` });

// Extrudera den runda ytan själv: Extrudera → Välj en yta → manteln → 1 mm utåt
const before = await page.evaluate(() => { const p = window.__scadshape.viewer.meshPositions; let m = 0; for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2]) < 1e-3) m = Math.max(m, Math.hypot(p[i], p[i + 1])); return m; });
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fpFace');
await page.waitForSelector('#faceBar:not([hidden])');
await tapWorld(10 * Math.cos(-Math.PI / 4), 10 * Math.sin(-Math.PI / 4), 17);
await page.waitForFunction(() => window.__scadshape.panel?.f.type === 'surface');
assert.match(await page.textContent('#fpTitle'), /Extruderad yta/);
assert.ok(await page.evaluate(() => window.__scadshape.panel.f.tris.length / 9) > 20);
await page.fill('#fp-depth', '1'); await page.click('#fpOk');
assert.deepEqual(await waitRendered(), []);
const after = await page.evaluate(() => { const p = window.__scadshape.viewer.meshPositions; let m = 0; for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2]) < 1e-3) m = Math.max(m, Math.hypot(p[i], p[i + 1])); return m; });
assert.ok(Math.abs(after - before - 1) < 0.05, `radie ${before} → ${after}`);
assert.equal(await bodies(), 1);
if (await page.isHidden('#tree')) await page.click('#btnTree');
assert.match(await page.textContent('#featureList'), /Extruderad yta/);
console.log('rund yta extruderad 1 mm utåt: radie', before.toFixed(3), '→', after.toFixed(3));
await page.screenshot({ path: `${out}/curved-face-extrude.png` });

// Följer cylindern: Extrudera 1 (cylindern) 20 → 26 mm hög → den extruderade ytan går också upp till 26
const sref = await page.evaluate(() => window.__scadshape.doc.features.find(f => f.type === "surface").ref);
assert.ok(sref && sref.inside === false, JSON.stringify(sref));
await page.locator('#featureList li', { hasText: 'Extrudera 1' }).first().click();
await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', '26'); await page.click('#fpOk');
assert.deepEqual(await waitRendered(), []);
const rimTop = await page.evaluate(() => { const p = window.__scadshape.viewer.meshPositions; let m = 0, z = 0; for (let i = 0; i < p.length; i += 3) { z = Math.max(z, p[i + 2]); if (Math.abs(p[i + 2] - 26) < 1e-3) m = Math.max(m, Math.hypot(p[i], p[i + 1])); } return [z, m]; });
assert.ok(Math.abs(rimTop[0] - 26) < 1e-3 && Math.abs(rimTop[1] - 11) < 0.05, JSON.stringify(rimTop));
// (Inget krav på en enda kropp här: urtaget från skiss 2 blir nu en sluten ficka under det förtjockade skalet.)
console.log('cylindern 26 mm hög: ytan följer med, radie', rimTop[1].toFixed(3), 'vid toppen');
await page.screenshot({ path: `${out}/curved-follow.png` });
await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel.');
