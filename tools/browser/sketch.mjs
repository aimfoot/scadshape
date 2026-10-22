// Fas 1-test: rita en skiss med riktiga pekhändelser (CDP) i headless Chromium.
//   node sketch.mjs [url] [utkatalog]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];

async function session(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'sv-SE' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.route('**/api/**', r => r.fulfill({ status: 204 }));
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, points) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
  return { ctx, page, touch };
}

const { page, touch } = await session({ width: 915, height: 412 });
await page.goto(url);
await page.waitForSelector('body:not(.loading)');
await page.evaluate(async () => { localStorage.clear(); await window.__scadshape.storage.clear(); });
await page.reload();
await page.waitForFunction(() => /Börja med Skiss/.test(document.querySelector('#status').textContent));
console.log('tom modell:', await page.textContent('#status'));

// Ny skiss på toppen
await page.click('#btnNewSketch');
await page.click('[data-plane="XY"]');
await page.waitForSelector('#sketchArea:not([hidden])');
await page.waitForTimeout(100);
const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
const tap = async p => { const c = await C(p); await touch('touchStart', [c]); await touch('touchEnd', []); };
const drag = async (a, b, shot) => {
  const ca = await C(a), cb = await C(b);
  await touch('touchStart', [ca]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: ca.x + ((cb.x - ca.x) * i) / 6, y: ca.y + ((cb.y - ca.y) * i) / 6 }]);
  if (shot) { await page.waitForTimeout(50); await page.screenshot({ path: `${out}/${shot}.png` }); }
  await touch('touchEnd', []);
};
const state = () => page.evaluate(() => {
  const e = window.__scadshape.editor;
  return { ents: Object.keys(e.sketch.entities).length, pts: Object.keys(e.sketch.points).length, loops: e.loopCount, hint: e.hint, undo: e.canUndo };
});
const tool = t => page.click(`[data-tool="${t}"]`);

// Rektangel genom att dra (förstoringsglaset fotas mitt i draget)
await tool('rect');
await drag({ x: -30, y: -20 }, { x: 30, y: 20 }, 'loupe');
let s = await state();
assert.equal(s.ents, 4); assert.equal(s.loops, 1);
console.log('rektangel:', s);

// Mittpunktsrektangel: centrum + hörn → 4 sidor + konstruktionsdiagonal, centrerad
await tool('rectc');
await tap({ x: 0, y: 40 }); await tap({ x: 20, y: 50 });
s = await state(); assert.equal(s.ents, 9); assert.equal(s.loops, 2);
{
  const r = await page.evaluate(() => {
    const sk = window.__scadshape.editor.sketch;
    const ls = Object.values(sk.entities).slice(-5).filter(e => !e.construction).flatMap(e => [sk.points[e.p1], sk.points[e.p2]]);
    const xs = ls.map(p => p.x), ys = ls.map(p => p.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), mid: sk.constraints.some(c => c.type === 'midpoint') };
  });
  assert.ok(Math.abs(r.x0 + 20) < 0.01 && Math.abs(r.x1 - 20) < 0.01 && Math.abs(r.y0 - 30) < 0.01 && Math.abs(r.y1 - 50) < 0.01, JSON.stringify(r));
  assert.ok(r.mid);
}
console.log('mittpunktsrektangel:', s);
await page.click('#btnUndo');
s = await state(); assert.equal(s.ents, 4);

// Cirkel i origo genom två tryck
await tool('circle');
await tap({ x: 0, y: 0 }); await tap({ x: 10, y: 0 });
s = await state(); assert.equal(s.ents, 5); assert.equal(s.loops, 1, 'cirkeln ska vara ett hål, inte en ny profil');

// Triangel med linjekedja som stängs på första punkten
await tool('line');
for (const p of [{ x: 40, y: -20 }, { x: 60, y: -20 }, { x: 50, y: 0 }, { x: 40, y: -20 }]) await tap(p);
s = await state(); assert.equal(s.ents, 8); assert.equal(s.loops, 2);
assert.match(s.hint, /tryck där linjen ska börja/, 'kedjan ska vara avslutad');
console.log('triangel:', s);

// D-form: linje + 3-punktsbåge mellan samma punkter
await tap({ x: -60, y: -10 }); await tap({ x: -60, y: 10 });
assert.equal(await page.isVisible('#btnFinish'), true);
await page.click('#btnFinish');
await tool('arc3');
await tap({ x: -60, y: 10 }); await tap({ x: -60, y: -10 }); await tap({ x: -45, y: 0 });
s = await state(); assert.equal(s.ents, 10); assert.equal(s.loops, 3);
console.log('D-form:', s);

// Mittpunktsbåge (öppen): centrum, start, svep över toppen till slut
await tool('arcc');
await tap({ x: 0, y: 35 }); await tap({ x: 15, y: 35 });
{
  const pts = [];
  for (let a = 0; a <= 180; a += 15) pts.push({ x: 15 * Math.cos((a * Math.PI) / 180), y: 35 + 15 * Math.sin((a * Math.PI) / 180) });
  const cs = await Promise.all(pts.map(C));
  await touch('touchStart', [cs[0]]);
  for (const c of cs.slice(1)) await touch('touchMove', [c]);
  await touch('touchEnd', []);
}
s = await state(); assert.equal(s.ents, 11); assert.equal(s.loops, 3);
const arc = await page.evaluate(() => { const sk = window.__scadshape.editor.sketch; const a = Object.values(sk.entities).at(-1); return { type: a.type, p1: sk.points[a.p1], p2: sk.points[a.p2] }; });
assert.equal(arc.type, 'arc'); assert.ok(Math.abs(arc.p1.x - 15) < 0.01 && Math.abs(arc.p2.x + 15) < 0.01, 'moturs från höger till vänster: ' + JSON.stringify(arc));
console.log('mittpunktsbåge ok, moturs över toppen');
await page.screenshot({ path: `${out}/sketch.png` });

// Ångra / gör om
await page.click('#btnUndo'); s = await state(); assert.equal(s.ents, 10);
await page.click('#btnRedo'); s = await state(); assert.equal(s.ents, 11);

// Nyp-zoom med två fingrar
const scale0 = await page.evaluate(() => window.__scadshape.editor.view.scale);
await touch('touchStart', [{ x: 400, y: 200 }, { x: 500, y: 200 }]);
for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x: 400 - i * 10, y: 200 }, { x: 500 + i * 10, y: 200 }]);
await touch('touchEnd', []);
const scale1 = await page.evaluate(() => window.__scadshape.editor.view.scale);
assert.ok(scale1 / scale0 > 1.9 && scale1 / scale0 < 2.1, `zoom ${scale1 / scale0}`);
s = await state(); assert.equal(s.ents, 11, 'nypning får inte rita något');
console.log('nyp-zoom ×' + (scale1 / scale0).toFixed(2));
await page.click('#btnSketchFit');

// Markera och ta bort den öppna bågen
await tool('select');
await tap({ x: 0, y: 50 });
assert.equal(await page.isDisabled('#btnDelete'), false);
await page.click('#btnDelete');
s = await state(); assert.equal(s.ents, 10);

// Dra en punkt: triangelns topp (50,0) → (50,10)
await drag({ x: 50, y: 0 }, { x: 50, y: 10 });
const top = await page.evaluate(() => Object.values(window.__scadshape.editor.sketch.points).some(p => Math.abs(p.x - 50) < 1e-6 && Math.abs(p.y - 10) < 1e-6));
assert.ok(top, 'punkten ska ha flyttats');
s = await state(); assert.equal(s.loops, 3);

// Klar → 3D
await page.click('#btnDone');
await page.click('#btnExtrude');
await page.waitForSelector('#featPanel:not([hidden])');
await page.click('#fpOk');
await page.waitForFunction(() => /trianglar|Fel/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
console.log('3D:', await page.textContent('#status'));
await page.click('#btnCode');
const codeText = await page.inputValue('#code');
assert.match(codeText, /module extrudera_1\(\)/); assert.match(codeText, /difference\(\)/);
await page.screenshot({ path: `${out}/model3d.png` });

// Sparat efter omladdning
await page.reload();
await page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
await page.click('#btnTree');
assert.equal(await page.locator('#featureList li').count(), 2, 'skiss + extrudering');
await page.screenshot({ path: `${out}/tree.png` });
console.log('efter omladdning:', await page.textContent('#status'));

// Stående läge
const docJson = await page.evaluate(() => { const s = window.__scadshape.storage; return s.get('scadshape.doc.' + s.get('scadshape.current')); });
const p2 = await session({ width: 412, height: 915 });
await p2.page.goto(url);
await p2.page.waitForSelector('body:not(.loading)');
await p2.page.evaluate(async d => { const s = window.__scadshape.storage; s.set('scadshape.doc.' + s.get('scadshape.current'), d); await s.saved(); }, docJson);
await p2.page.reload();
await p2.page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
await p2.page.click('#btnTree');
await p2.page.click('button.feature');
await p2.page.waitForTimeout(150);
await p2.page.screenshot({ path: `${out}/portrait-sketch.png` });

await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
