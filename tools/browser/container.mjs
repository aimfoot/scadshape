// Container: template sketch when there is no sketch, lid choice, cancel removes the template, OK
// puts the box's parts in the tree (extrudes, a lid beside it, threads), and text finds their faces.
// node container.mjs [url] [outdir]
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
const S = () => page.evaluate(() => ({ status: document.querySelector('#status').textContent, solids: window.__scadshape.model.solids, errors: [...window.__scadshape.model.errors.values()], features: window.__scadshape.doc.features.map(f => f.type) }));
const waitRendered = async () => {
  await page.waitForTimeout(450);
  await page.waitForFunction(() => !/Rendering|Loading/.test(document.querySelector('#status').textContent) && !/Cancel/.test(document.querySelector('#btnRender').textContent), null, { timeout: 60000 });
  return S();
};

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); });
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));

// 1. Container without a sketch → template sketch 80 × 60 and a panel with a push-fit lid
await page.click('#btnContainer'); await page.waitForSelector('#featPanel:not([hidden])');
let st = await waitRendered();
assert.deepEqual(st.features, ['sketch']); // the feature is only inserted on OK
assert.equal(st.errors.length, 0, st.errors.join());
assert.match(await page.textContent('#fpRegions'), /1 of 1 regions/);
assert.equal(await page.inputValue('#fp-height'), '40');
assert.equal(await page.getAttribute('#fp-lid [data-value="lip"]', 'aria-pressed'), 'true');
await page.screenshot({ path: `${out}/c-lip.png` });

// 2. A screw lid needs a circle; No lid hides the clearance
await page.click('#fp-lid [data-value="screw"]'); st = await waitRendered();
assert.match(await page.textContent('#fpError'), /circle/);
assert.ok(await page.isHidden('#fp-radius'));
await page.click('#fp-lid [data-value="none"]'); st = await waitRendered();
assert.ok(await page.isHidden('#fpError')); assert.ok(await page.isHidden('#fp-clearance'));

// 3. Cancel removes the template sketch
await page.click('#fpCancel'); await page.waitForTimeout(300);
assert.deepEqual((await S()).features, []);

// 4. Again, with a lid, OK → the box's parts in the tree, shared sizes as variables
await page.click('#btnContainer'); await page.waitForSelector('#featPanel:not([hidden])');
await page.fill('#fp-height', '30'); await page.fill('#fp-cellsX', '3'); await page.fill('#fp-cellsY', '2'); await page.click('#fpOk');
st = await waitRendered();
assert.deepEqual(st.features, ['sketch', 'extrude', 'extrude', 'sketch', 'extrude', 'sketch', 'extrude', 'extrude', 'extrude']);
assert.equal(st.errors.length, 0, st.errors.join());
assert.match(st.status, /triangles/);
assert.match(await page.textContent('#partToast'), /6 parts/);
const names = await page.evaluate(() => window.__scadshape.doc.features.map(f => f.name));
assert.deepEqual(names.slice(1), ['Box', 'Cavity', 'Divider sketch', 'Dividers', 'Lid sketch', 'Lid', 'Lid lip', 'Inside of lip']);
assert.deepEqual(await page.evaluate(() => window.__scadshape.doc.params.map(p => `${p.name}=${p.expr}`)), ['height=30', 'wall=2', 'floor=2', 'clearance=0,2', 'corner=4', 'lip=6']);
const divs = await page.evaluate(() => Object.keys(window.__scadshape.doc.features[3].entities).length);
assert.equal(divs, 12, 'two dividers in X and one in Y, 4 lines each');
await page.screenshot({ path: `${out}/c-cells.png` });

// 5. The template sketch is fully defined (black) and keeps its dimensions when solved
if (await page.isHidden('#tree')) await page.click('#btnTree');
await page.locator('#featureList button.feature').first().click();
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
await page.waitForTimeout(300);
const ed = await page.evaluate(() => ({ dof: window.__scadshape.editor.dof, xs: Object.values(window.__scadshape.editor.sketch.points).map(p => Math.round(p.x)).sort((a, b) => a - b) }));
assert.equal(ed.dof, 0, `dof ${ed.dof}`);
assert.deepEqual([...new Set(ed.xs)], [-40, 0, 40]);
await page.screenshot({ path: `${out}/c-sketch.png` });
await page.click('#btnDone'); st = await waitRendered();
await page.screenshot({ path: `${out}/c-done.png` });
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
const tapWorld = async (x, y, z) => {
  const p = await page.evaluate(([x, y, z]) => window.__scadshape.viewer.screenOfWorld(x, y, z), [x, y, z]);
  const r = await page.evaluate(() => document.querySelector('#viewport canvas').getBoundingClientRect().toJSON());
  await touch('touchStart', [{ x: r.left + p.x, y: r.top + p.y }]); await touch('touchEnd', []);
};

// 6. Text on the box's front wall: it lands on the wall (a sketch on the Box's face), raised outwards
await page.evaluate(v => { const w = window.__scadshape.viewer; w.setView(v); w.fit(); }, 'front');
await page.click('#btnText'); await page.waitForSelector('#faceBar:not([hidden])');
await tapWorld(0, -30, 15);
await page.waitForSelector('#featPanel:not([hidden])');
st = await waitRendered(); assert.equal(st.errors.length, 0, st.errors.join());
const wall = await page.evaluate(() => { const s = window.__scadshape, sk = s.doc.features.find(g => g.id === s.panel.f.sketch); return { plane: sk.plane, offset: sk.offset, outward: sk.outward, dir: s.panel.f.direction }; });
assert.deepEqual(wall, { plane: 'XZ', offset: '30', outward: 'normal', dir: 'normal' });
await page.click('#fpOk'); st = await waitRendered(); assert.equal(st.errors.length, 0, st.errors.join());
await page.screenshot({ path: `${out}/c-text.png` });
console.log('text on the box wall ok');

// 7. A jar with a screw lid (a new model): thread features; text on the jar's wall wraps around it
if (await page.isHidden('#tree')) await page.click('#btnTree');
await page.click('#btnProjects'); await page.waitForSelector('#projDlg[open]'); await page.click('#projNew');
await page.click('#btnNewSketch'); await page.click('[data-plane="XY"]');
await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
const tapSk = async p => { const c = await C(p); await touch('touchStart', [c]); await touch('touchEnd', []); };
await page.click('[data-tool="circle"]'); await tapSk({ x: 0, y: 0 }); await tapSk({ x: 25, y: 0 });
await page.click('#btnDone'); await waitRendered();
await page.click('#btnContainer'); await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fp-lid [data-value="screw"]'); st = await waitRendered();
assert.ok(await page.isHidden('#fpError'), await page.textContent('#fpError'));
await page.click('#fpOk'); st = await waitRendered();
assert.equal(st.errors.length, 0, st.errors.join());
const jar = await page.evaluate(() => window.__scadshape.doc.features.slice(1).map(f => `${f.type}:${f.name}`));
assert.deepEqual(jar, ['extrude:Box', 'thread:Thread', 'extrude:Cavity', 'extrude:Neck', 'sketch:Lid sketch', 'extrude:Lid', 'sketch:Grip sketch', 'extrude:Grip', 'thread:Lid thread']);
await page.evaluate(v => { const w = window.__scadshape.viewer; w.setView(v); w.fit(); }, 'front');
await page.click('#btnText'); await page.waitForSelector('#faceBar:not([hidden])');
const R = await page.evaluate(() => { const c = Object.values(window.__scadshape.doc.features[0].entities)[0]; return c.r; });
await tapWorld(0, -R, 12);
await page.waitForSelector('#featPanel:not([hidden])');
st = await waitRendered(); assert.equal(st.errors.length, 0, st.errors.join());
assert.match(await page.evaluate(() => window.__scadshape.model.code), /Around the round side/);
await page.fill('#fp-text', 'JAR'); await page.click('#fpOk'); st = await waitRendered();
assert.equal(st.errors.length, 0, st.errors.join());
await page.screenshot({ path: `${out}/c-jar.png` });
console.log('screw jar as parts, text around its wall ok');

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
