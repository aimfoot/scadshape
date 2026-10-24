// Text on a face: Text with a model asks for a face and puts the text where it is tapped (around a
// cylinder wall it follows the round side); in the panel a drag on the text moves it along the
// face, a tap moves it (onto another face too), and Cancel leaves nothing behind. A selected face
// + Text and the face menu's Text work the same way.
// node textface.mjs [url] [outdir]
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
const screenOf = async (x, y, z) => {
  const p = await page.evaluate(([x, y, z]) => window.__scadshape.viewer.screenOfWorld(x, y, z), [x, y, z]);
  const r = await page.evaluate(() => document.querySelector('#viewport canvas').getBoundingClientRect().toJSON());
  const at = { x: r.left + p.x, y: r.top + p.y };
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, at), 'CANVAS', `hidden: ${x},${y},${z}`);
  return at;
};
const tapWorld = async (x, y, z) => { const at = await screenOf(x, y, z); await touch('touchStart', [at]); await touch('touchEnd', []); };
const holdWorld = async (x, y, z) => { const at = await screenOf(x, y, z); await touch('touchStart', [at]); await page.waitForTimeout(700); await touch('touchEnd', []); };
const dragWorld = async (a, b) => {
  const pa = await screenOf(...a), pb = await screenOf(...b);
  await touch('touchStart', [pa]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x: pa.x + ((pb.x - pa.x) * i) / 10, y: pa.y + ((pb.y - pa.y) * i) / 10 }]); await page.waitForTimeout(30); }
  await touch('touchEnd', []);
};
/** The text's place in the world: its sketch point, through the sketch frame. */
const textAt = () => page.evaluate(() => {
  const s = window.__scadshape, f = s.panel.f, sk = s.doc.features.find(g => g.id === f.sketch);
  return { sketch: sk.id, plane: sk.plane, face: !!sk.face, points: Object.values(sk.points), code: s.model.code };
});
const camera = () => page.evaluate(() => window.__scadshape.viewer.camera.position.toArray().map(v => Math.round(v * 1000) / 1000).join());

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); });
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));
// Standing cylinder Ø40 × 30 at the origin
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.click('[data-tool="circle"]'); await tapSk({ x: 0, y: 0 }); await tapSk({ x: 20, y: 0 });
await page.click('#btnDone');
await page.click('#btnExtrude'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-depth', '30'); await page.click('#fpOk');
assert.deepEqual(await waitRendered(), []);
await page.evaluate(v => { const w = window.__scadshape.viewer; w.setView(v); w.fit(); }, 'front');

// 1. Text → "tap the face" → the wall in front: the text sits there and follows the wall.
await page.click('#btnText');
await page.waitForSelector('#faceBar:not([hidden])');
assert.match(await page.textContent('#partToast'), /Tap the face/);
await tapWorld(0, -20, 15);
await page.waitForSelector('#featPanel:not([hidden])');
assert.deepEqual(await waitRendered(), []);
let s = await textAt();
assert.ok(s.plane !== 'XY' && s.points.length === 1, JSON.stringify(s));
assert.match(s.code, /Around the round side \(r = 20\)/);
await page.fill('#fp-text', 'HELLO'); assert.deepEqual(await waitRendered(), []);
await page.screenshot({ path: `${out}/textface-wall.png` });
console.log('Text → tap the wall: text around it at the tapped spot');

// 2. A drag on the text moves it along the wall (and does not turn the view); a drag beside it turns the view.
const cam = await camera();
const before = (await textAt()).points[0];
await dragWorld([0, -20, 15], [8, -18.33, 22]);
assert.deepEqual(await waitRendered(), []);
s = await textAt();
assert.equal(await camera(), cam, 'the view did not rotate');
const moved = { x: s.points[0].x - before.x, y: s.points[0].y - before.y };
assert.ok(Math.hypot(moved.x, moved.y) > 5, `moved ${JSON.stringify(moved)}`);
assert.ok(moved.y > 4, 'upwards along the wall');
// Along the wall the point is measured as arc length: 8 mm sideways at r = 20 is asin(0.4)·20 ≈ 8.2 mm.
assert.ok(Math.abs(Math.abs(moved.x) - 20 * Math.asin(0.4)) < 1.5, `around: ${moved.x}`);
await page.screenshot({ path: `${out}/textface-dragged.png` });
const ap = await page.evaluate(() => { const r = document.querySelector('#viewport canvas').getBoundingClientRect(); return { x: r.left + 40, y: r.top + 60 }; });
await touch('touchStart', [ap]); for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: ap.x + i * 15, y: ap.y }]); await touch('touchEnd', []);
await page.waitForTimeout(400);
assert.notEqual(await camera(), cam, 'a drag beside the text turns the view');
await page.evaluate(v => { const w = window.__scadshape.viewer; w.setView(v); w.fit(); }, 'iso');
console.log('drag on the text moves it along the wall; beside it the view turns');

// 3. A tap on the top moves the text there: the sketch goes to the top's plane, still raised.
await tapWorld(0, 5, 30);
assert.deepEqual(await waitRendered(), []);
s = await textAt();
assert.equal(s.plane, 'XY'); assert.ok(!s.face, 'a base plane');
assert.ok(Math.abs(s.points[0].x) < 0.5 && Math.abs(s.points[0].y - 5) < 0.5, JSON.stringify(s.points));
assert.doesNotMatch(s.code, /Around the round side/);
assert.equal(await page.evaluate(() => window.__scadshape.panel.f.direction), 'normal');
console.log('tap on the top moves the text there');

// 4. Cancel: no text, no sketch left.
await page.click('#fpCancel'); assert.deepEqual(await waitRendered(), []);
assert.deepEqual(await page.evaluate(() => window.__scadshape.doc.features.map(f => f.type)), ['sketch', 'extrude']);

// 5. A selected face + Text, and the face menu's Text.
await tapWorld(0, 0, 30);
await page.click('#btnText'); await page.waitForSelector('#featPanel:not([hidden])');
assert.equal((await textAt()).plane, 'XY');
await page.click('#fpOk'); assert.deepEqual(await waitRendered(), []);
await page.evaluate(v => { const w = window.__scadshape.viewer; w.setView(v); w.fit(); }, 'front');
await holdWorld(-6, -19.08, 8);
await page.waitForSelector('#faceMenu[open]');
await page.click('[data-face="text"]'); await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fp-op [data-value="remove"]');
assert.deepEqual(await waitRendered(), []);
s = await textAt();
assert.notEqual(s.plane, 'XY', 'on the wall'); assert.match(s.code, /Around the round side/);
await page.click('#fpOk'); assert.deepEqual(await waitRendered(), []);
assert.deepEqual(await page.evaluate(() => window.__scadshape.doc.features.map(f => f.type)), ['sketch', 'extrude', 'sketch', 'text', 'sketch', 'text']);
await page.screenshot({ path: `${out}/textface-done.png` });

// 6. Editing the engraved text again: a drag moves it, Cancel puts it back.
const saved = await page.evaluate(() => JSON.stringify(window.__scadshape.doc.features[4]));
if (await page.isHidden('#tree')) await page.click('#btnTree');
await page.locator('#featureList button.feature').nth(5).click();
await page.waitForSelector('#featPanel:not([hidden])');
if (await page.isVisible('#tree')) await page.click('#btnTree');
await page.evaluate(v => { const w = window.__scadshape.viewer; w.setView(v); w.fit(); }, 'front');
await dragWorld([-6, -19.08, 8], [-6, -19.08, 18]);
assert.notEqual(await page.evaluate(() => JSON.stringify(window.__scadshape.doc.features[4])), saved);
await page.click('#fpCancel'); assert.deepEqual(await waitRendered(), []);
assert.equal(await page.evaluate(() => JSON.stringify(window.__scadshape.doc.features[4])), saved);
console.log('selected face + Text, face menu Text, edit + Cancel ok');

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
if (errors.length) process.exit(1);
