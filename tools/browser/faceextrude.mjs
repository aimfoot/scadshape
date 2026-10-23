// Extrude a face: tap a face in 3D → sketch with the face's outline → extrude (add / remove).
// node faceextrude.mjs [url] [outdir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US' });
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
  await page.waitForFunction(() => !/Rendering|Loading/.test(document.querySelector('#status').textContent) && !/Cancel/.test(document.querySelector('#btnRender').textContent), null, { timeout: 60000 });
  return page.evaluate(() => [...window.__scadshape.model.errors.values()]);
};
const tapWorld = async (x, y, z) => {
  const p = await page.evaluate(([x, y, z]) => window.__scadshape.viewer.screenOfWorld(x, y, z), [x, y, z]);
  const r = await page.evaluate(() => document.querySelector('#viewport canvas').getBoundingClientRect().toJSON());
  const at = { x: r.left + p.x, y: r.top + p.y };
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, at), 'CANVAS', `skymd: ${x},${y},${z}`);
  await touch('touchStart', [at]); await touch('touchEnd', []);
};
const bbox = () => page.evaluate(() => {
  const p = window.__scadshape.viewer.meshPositions, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) { mn[i % 3] = Math.min(mn[i % 3], p[i]); mx[i % 3] = Math.max(mx[i % 3], p[i]); }
  return [...mn, ...mx].map(v => Math.round(v * 1000) / 1000);
});

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));
// Plate 40 × 20 × 10 with a Ø8 hole
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.click('[data-tool="rect"]'); await tapSk({ x: 0, y: 0 }); await tapSk({ x: 40, y: 20 });
await page.click('[data-tool="circle"]'); await tapSk({ x: 30, y: 10 }); await tapSk({ x: 30, y: 14 });
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', '10'); await page.click('#fpOk');
assert.deepEqual(await waitRendered(), []);
assert.deepEqual(await bbox(), [0, 0, 0, 40, 20, 10]);
await page.click('[data-view="iso"]');

// 1. Extrude → "Pick a face…" → the top → 5 mm up, the hole follows
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
assert.ok(await page.isVisible('#fpFace'));
await page.click('#fpFace');
await page.waitForSelector('#faceBar:not([hidden])');
await tapWorld(10, 10, 10);
await page.waitForFunction(() => /face/.test(document.querySelector('#fpSketch').selectedOptions[0]?.textContent ?? ''));
const sk = await page.evaluate(() => { const d = window.__scadshape.doc; const s = d.features.find(f => f.id === window.__scadshape.panel.f.sketch); return { name: s.name, plane: s.plane, offset: s.offset, kinds: Object.values(s.entities).map(e => e.type).sort() }; });
assert.deepEqual(sk.kinds, ['circle', 'line', 'line', 'line', 'line'], JSON.stringify(sk));
assert.equal(sk.plane, 'XY');
await page.fill('#fp-depth', '5'); await page.click('#fpOk');
assert.deepEqual(await waitRendered(), []);
assert.deepEqual(await bbox(), [0, 0, 0, 40, 20, 15]);
const holeThrough = await page.evaluate(() => { const p = window.__scadshape.viewer.meshPositions; for (let i = 0; i < p.length; i += 3) if (Math.abs(Math.hypot(p[i] - 30, p[i + 1] - 10) - 4) < 0.01 && Math.abs(p[i + 2] - 15) < 1e-3) return true; return false; });
assert.ok(holeThrough, 'the hole goes up through the extruded part');
console.log('top extruded 5 mm, the hole follows:', sk.name);
await page.screenshot({ path: `${out}/faceextrude-top.png` });

// 2. The front (y = 0) → remove 3 mm into the plate
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fpFace');
await tapWorld(20, 0, 5);
await page.waitForFunction(() => /face/.test(document.querySelector('#fpSketch').selectedOptions[0]?.textContent ?? ''));
await page.click('#fp-op [data-value="remove"]');
await page.fill('#fp-depth', '3'); await page.click('#fpOk');
assert.deepEqual(await waitRendered(), []);
assert.deepEqual(await bbox(), [0, 3, 0, 40, 20, 15]);
console.log('the front cut away 3 mm');
await page.screenshot({ path: `${out}/faceextrude-front.png` });

// 3. Cancel removes the face sketch
const n0 = await page.evaluate(() => window.__scadshape.doc.features.length);
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fpFace'); await tapWorld(20, 10, 15);
await page.waitForFunction(() => /face/.test(document.querySelector('#fpSketch').selectedOptions[0]?.textContent ?? ''));
await page.click('#fpCancel');
assert.equal(await page.evaluate(() => window.__scadshape.doc.features.length), n0);
console.log('cancel removes the face sketch');
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
