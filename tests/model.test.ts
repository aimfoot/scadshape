// Tester för features → OpenSCAD → mesh (riktig OpenSCAD-WASM, Manifold).
import { setLang } from '../src/i18n';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyHoleSize, emptyDoc, holeCandidates, insertFeature, migrate, newExtrude, newFeature, newHole, newRevolve, newSketch, removeFeature, type Doc } from '../src/doc';
import { minorDiameter } from '../src/features/threads';
import { fontsFor } from '../src/fonts';
import { buildModel } from '../src/model3d';
import { parseBinaryStl } from '../src/stl';
import { emptySketch, newId, type SketchData } from '../src/sketch/model';
import { evalParams } from '../src/params';
import { parseExpr } from '../src/expr';
import { regionsOf, findLoops, selectRegions } from '../src/sketch/regions';
import { facePlane, findCurveRef, findFaceRef, offsetExpr, planeReference, sketchReference, slantedFace, surfaceDepth } from '../src/faceref';
import { planeFrame, sketchFrame, toWorld } from '../src/frame';
import { KINDS } from '../src/features';
import { repeatCircles } from '../src/features/pattern';
import { addFaceLoops, faceLoops, smoothFace } from '../src/faceoutline';
import { WORLD_SKETCH } from '../src/features/code';
setLang('sv'); // testerna förväntar sig svenska namn och fel

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b} (±${eps})`);
let n = 0;
const test = async (name: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log('ok', name); };
const wasmBinary = readFileSync(process.env.ROOT + '/vendor/openscad/openscad.wasm');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { default: OpenSCAD } = (await import(process.env.ROOT + '/vendor/openscad/openscad.js')) as { default: (o: object) => Promise<any> };

async function render(code: string) {
  const log: string[] = [];
  const inst = await OpenSCAD({ noInitialRun: true, wasmBinary, preRun: [(m: { ENV: Record<string, string> }) => { m.ENV.FONTCONFIG_FILE = '/fonts/fonts.conf'; }], print: (s: string) => log.push(s), printErr: (s: string) => log.push(s) });
  const fonts = fontsFor(code);
  if (fonts.length) {
    inst.FS.mkdirTree('/fonts');
    for (const f of fonts) inst.FS.writeFile(`/fonts/${f}`, readFileSync(process.env.ROOT + '/public/fonts/' + f));
    inst.FS.writeFile('/fonts/fonts.conf', '<?xml version="1.0"?>\n<fontconfig><dir>/fonts</dir></fontconfig>\n');
  }
  inst.FS.writeFile('/in.scad', code);
  let rc: number;
  try { rc = inst.callMain(['/in.scad', '-o', '/out.stl', '--export-format=binstl', '--backend=manifold']); } catch (e) { rc = -1; log.push(String(e)); }
  if (rc !== 0) throw new Error('OpenSCAD: ' + log.filter(l => /ERROR|WARNING/.test(l)).join('\n') + '\n' + code);
  const m = parseBinaryStl(inst.FS.readFile('/out.stl').slice().buffer);
  const p = m.positions;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let vol = 0;
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 9; k++) { const a = k % 3; min[a] = Math.min(min[a], p[i + k]); max[a] = Math.max(max[a], p[i + k]); }
    vol += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
  }
  return { min, max, vol, tri: m.triangles, pos: p };
}

function pt(sk: SketchData, x: number, y: number) { const id = newId(sk, 'p'); sk.points[id] = { x, y }; return id; }
function line(sk: SketchData, a: string, b: string) { const id = newId(sk, 'e'); sk.entities[id] = { type: 'line', p1: a, p2: b }; return id; }
function rect(sk: SketchData, x0: number, y0: number, x1: number, y1: number) {
  const a = pt(sk, x0, y0), b = pt(sk, x1, y0), c = pt(sk, x1, y1), d = pt(sk, x0, y1);
  return [line(sk, a, b), line(sk, b, c), line(sk, c, d), line(sk, d, a)];
}
function circle(sk: SketchData, x: number, y: number, r: number) { const id = newId(sk, 'e'); sk.entities[id] = { type: 'circle', c: pt(sk, x, y), r }; return id; }
const box = (r: Awaited<ReturnType<typeof render>>) => [...r.min, ...r.max].map(v => Math.round(v * 1000) / 1000);

await test('uttryck med variabler', () => {
  const vars = evalParams([{ name: 'b', expr: '40' }, { name: 'h', expr: 'b/2 + 1,5' }, { name: 'x', expr: 'okänd*2' }]);
  assert.equal(vars.vars.get('h'), 21.5); assert.match(vars.errors.get('x')!, /Okänd variabel/);
  assert.deepEqual(parseExpr('b*2', vars.vars), { value: 80, error: undefined, uses: ['b'] });
});
await test('migrering v1 → v2: en extrudering per skiss med profiler', () => {
  const s1 = { ...newSketch(emptyDoc(), 'XY'), type: 'sketch' }; rect(s1 as SketchData, 0, 0, 10, 10);
  const s2 = { ...newSketch(emptyDoc(), 'XZ'), id: 'tom', name: 'Skiss 2' };
  const doc = migrate({ v: 1, features: [s1, s2], previewHeight: 7 })!;
  assert.equal(doc.v, 2); assert.deepEqual(doc.features.map(f => f.type), ['sketch', 'extrude', 'sketch']);
  assert.equal((doc.features[1] as { depth: string }).depth, '7');
});
await test('extrudera normal / omvänd / symmetrisk', async () => {
  for (const [dir, z0, z1] of [['normal', 0, 8], ['reverse', -8, 0], ['symmetric', -4, 4]] as const) {
    const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, 0, 0, 20, 10);
    const e = newExtrude(doc, s.id); e.depth = '8'; e.direction = dir; insertFeature(doc, e);
    const r = await render(buildModel(doc).code);
    assert.deepEqual(box(r), [0, 0, z0, 20, 10, z1], dir); near(r.vol, 1600, 1e-3);
  }
});
await test('plan XZ och YZ hamnar rätt', async () => {
  for (const [plane, want] of [['XZ', [0, -5, 0, 20, 0, 10]], ['YZ', [0, 0, 0, 5, 20, 10]]] as const) {
    const doc = emptyDoc(); const s = newSketch(doc, plane); insertFeature(doc, s); rect(s, 0, 0, 20, 10);
    const e = newExtrude(doc, s.id); e.depth = '5'; insertFeature(doc, e);
    assert.deepEqual(box(await render(buildModel(doc).code)), [...want], plane);
  }
});
await test('regionval: ring eller skiva', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s);
  rect(s, -20, -20, 20, 20); circle(s, 0, 0, 10);
  const { loops } = findLoops(s); const regs = regionsOf(loops);
  assert.equal(regs.length, 2);
  assert.deepEqual(selectRegions(regs, loops, null).length, 1, 'standard = ringen');
  const e = newExtrude(doc, s.id); e.depth = '1'; insertFeature(doc, e);
  near((await render(buildModel(doc).code)).vol, 1600 - Math.PI * 100, 0.5);
  e.regions = [{ x: 1, y: 1 }]; // tryck i skivan
  near((await render(buildModel(doc).code)).vol, Math.PI * 100, 0.5);
  e.regions = [{ x: 1, y: 1 }, { x: 15, y: 15 }]; // båda
  near((await render(buildModel(doc).code)).vol, 1600, 0.5);
});
await test('ta bort och snitt', async () => {
  const doc = emptyDoc();
  const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, 0, 0, 30, 30);
  const e = newExtrude(doc, s.id); e.depth = '10'; insertFeature(doc, e);
  const s2 = newSketch(doc, 'XY'); insertFeature(doc, s2); circle(s2, 15, 15, 5);
  const hole = newExtrude(doc, s2.id); hole.depth = '10'; hole.op = 'remove'; insertFeature(doc, hole);
  const m = buildModel(doc);
  assert.match(m.code, /difference\(\)/); assert.equal(m.errors.size, 0);
  near((await render(m.code)).vol, 9000 - Math.PI * 250, 3); // polygonhål ≈ 0,3 % mindre än cirkeln
  hole.op = 'intersect';
  near((await render(buildModel(doc).code)).vol, Math.PI * 250, 3);
});
await test('ta bort utan kropp ger fel, men resten byggs', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, 0, 0, 5, 5);
  const e = newExtrude(doc, s.id); e.op = 'remove'; insertFeature(doc, e);
  const m = buildModel(doc); assert.match(m.errors.get(e.id)!, /ingen kropp/); assert.equal(m.solids, 0);
});
await test('revolve runt skissens Y-axel (cylinder med hål)', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XZ'); insertFeature(doc, s); rect(s, 5, 0, 10, 20);
  const r = newRevolve(doc, s.id); insertFeature(doc, r);
  const res = await render(buildModel(doc).code);
  near(res.vol, Math.PI * (100 - 25) * 20, 15); // rör: R10, r5, h20
  assert.deepEqual(box(res).map(v => Math.round(v)), [-10, -10, 0, 10, 10, 20]);
});
await test('revolve runt en linje i skissen, halvt varv, profil på negativa sidan', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s);
  const ax = line(s, pt(s, 0, 0), pt(s, 40, 0)); s.entities[ax].construction = true;
  rect(s, 10, -10, 30, -5); // under axeln
  const r = newRevolve(doc, s.id); r.axis = { kind: 'line', e: ax }; r.angle = '180'; insertFeature(doc, r);
  const res = await render(buildModel(doc).code);
  near(res.vol, (Math.PI * (100 - 25) * 20) / 2, 10);
  near(res.min[0], 10, 1e-3); near(res.max[0], 30, 1e-3); // axeln längs X
});
await test('revolve: profil som korsar axeln ger fel', () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, -5, 0, 5, 10);
  const r = newRevolve(doc, s.id); insertFeature(doc, r);
  assert.match(buildModel(doc).errors.get(r.id)!, /korsar axeln/);
});
await test('variabel i höjd blir OpenSCAD-variabel', async () => {
  const doc = emptyDoc(); doc.params = [{ name: 'tjocklek', expr: '2,5' }];
  const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, 0, 0, 10, 10);
  const e = newExtrude(doc, s.id); e.depth = 'tjocklek*2'; insertFeature(doc, e);
  const m = buildModel(doc);
  assert.match(m.code, /^tjocklek = 2\.5;$/m); assert.match(m.code, /height = \(tjocklek\*2\)/);
  near((await render(m.code)).max[2], 5);
  e.depth = 'okänd';
  assert.match(buildModel(doc).errors.get(e.id)!, /Okänd variabel/);
});
await test('rollback, undertryck och borttagning', () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, 0, 0, 5, 5);
  const e1 = newExtrude(doc, s.id); insertFeature(doc, e1);
  const e2 = newExtrude(doc, s.id); e2.op = 'remove'; insertFeature(doc, e2);
  assert.equal(buildModel(doc).solids, 2);
  doc.rollback = 2; assert.equal(buildModel(doc).solids, 1);
  const e3 = newExtrude(doc, s.id); insertFeature(doc, e3);
  assert.deepEqual(doc.features.map(f => f.id), [s.id, e1.id, e3.id, e2.id]); assert.equal(doc.rollback, 3);
  doc.rollback = null; e1.suppressed = true;
  assert.equal(buildModel(doc).solids, 2);
  removeFeature(doc, s); assert.equal(doc.features.length, 0, 'beroende features följer med');
});
await test('svenska variabelnamn blir giltiga OpenSCAD-namn', async () => {
  const doc = emptyDoc(); doc.params = [{ name: 'höjd', expr: '3' }, { name: 'hojd', expr: 'höjd*2' }, { name: 'Ålder', expr: '1' }];
  const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, 0, 0, 10, 10);
  const e = newExtrude(doc, s.id); e.depth = 'hojd + höjd'; insertFeature(doc, e);
  const m = buildModel(doc);
  assert.match(m.code, /^hojd_2 = 3; \/\/ höjd$/m); assert.match(m.code, /^hojd = hojd_2\*2;$/m); assert.match(m.code, /^Alder = 1;/m);
  assert.match(m.code, /height = \(hojd \+ hojd_2\)\)/);
  near((await render(m.code)).max[2], 9);
});
/** Platta 20×20×10 på XY (z 0–10) och en hålskiss med fristående punkter. */
function plateWithHoleSketch(points: [number, number][]) {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, 0, 0, 20, 20);
  const e = newExtrude(doc, s.id); e.depth = '10'; insertFeature(doc, e);
  const hs = newSketch(doc, 'XY'); insertFeature(doc, hs);
  for (const [x, y] of points) hs.points[pt(hs, x, y)].standalone = true;
  return { doc, hs };
}
const circ = (r: number, fn: number) => (fn / 2) * r * r * Math.sin((2 * Math.PI) / fn); // polygonarea
await test('hål: två genomgående M3', async () => {
  const { doc, hs } = plateWithHoleSketch([[5, 5], [15, 15]]);
  const h = newHole(doc, hs.id); insertFeature(doc, h);
  assert.equal(holeCandidates(hs).length, 2);
  const m = buildModel(doc); assert.equal(m.errors.size, 0, [...m.errors.values()].join());
  const fn = (m.code.match(/cylinder\(d = 3\.4, h = 1000 \+ 0\.01, \$fn = (\d+)\)/) ?? [])[1];
  assert.ok(fn, m.code);
  near((await render(m.code)).vol, 4000 - 2 * circ(1.7, +fn) * 10, 0.05);
});
await test('hål: cylindrisk försänkning från ovansidan (start 10, nedåt)', async () => {
  const { doc, hs } = plateWithHoleSketch([[10, 10]]);
  const h = newHole(doc, hs.id); h.kind = 'counterbore'; h.start = '10'; h.direction = 'reverse'; insertFeature(doc, h);
  const code = buildModel(doc).code;
  const fns = [...code.matchAll(/\$fn = (\d+)/g)].map(x => +x[1]);
  const r = await render(code);
  near(r.vol, 4000 - circ(1.7, fns[0]) * (10 - 3.4) - circ(3.25, fns[1]) * 3.4, 0.05);
  assert.deepEqual([r.min[2], r.max[2]], [0, 10]);
});
await test('hål: konisk försänkning M4, 90°', async () => {
  const { doc, hs } = plateWithHoleSketch([[10, 10]]);
  const h = newHole(doc, hs.id); applyHoleSize(h, 'M4'); h.kind = 'countersink'; h.start = '10'; h.direction = 'reverse'; insertFeature(doc, h);
  const m = buildModel(doc); assert.equal(m.errors.size, 0);
  // Kon från Ø8,8 till Ø4,5 med 90°: höjd 2,15. Volymen ska ligga mellan hål utan och med cylindrisk försänkning.
  const v = (await render(m.code)).vol;
  const kon = (Math.PI * 2.15 / 3) * (4.4 ** 2 + 4.4 * 2.25 + 2.25 ** 2);
  near(v, 4000 - Math.PI * 2.25 ** 2 * (10 - 2.15) - kon, 1.5);
});
await test('hål: fel som ska fångas', () => {
  const { doc, hs } = plateWithHoleSketch([]);
  const h = newHole(doc, hs.id); insertFeature(doc, h);
  assert.match(buildModel(doc).errors.get(h.id)!, /fristående punkter/);
  hs.points[pt(hs, 5, 5)].standalone = true;
  h.kind = 'counterbore'; h.cbDiameter = '2';
  assert.match(buildModel(doc).errors.get(h.id)!, /större än hålet/);
  const empty = emptyDoc(); const s2 = newSketch(empty, 'XY'); insertFeature(empty, s2); s2.points[pt(s2, 0, 0)].standalone = true;
  const h2 = newHole(empty, s2.id); insertFeature(empty, h2);
  assert.match(buildModel(empty).errors.get(h2.id)!, /ingen kropp/);
});
const cylVol = (d: number, h: number) => Math.PI * (d / 2) ** 2 * h;
await test('gänga: utvändig M8 på en cylinder', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s);
  circle(s, 0, 0, 4);
  const e = newExtrude(doc, s.id); e.depth = '20'; insertFeature(doc, e);
  const th = newFeature(doc, 'thread', s); insertFeature(doc, th);
  assert.equal(th.size, 'M8'); assert.equal(th.mode, 'external');
  th.length = '15'; th.start = '5';
  const m = buildModel(doc); assert.equal(m.errors.size, 0, [...m.errors.values()].join());
  const r = await render(m.code);
  // 5 mm slät cylinder + 15 mm gänga: volymen mellan kärn- och ytterdiameter.
  const lo = cylVol(8, 5) + cylVol(minorDiameter(8, 1.25) - 0.4, 15), hi = cylVol(8, 20);
  assert.ok(r.vol > lo && r.vol < hi, `${r.vol} utanför ${lo}–${hi}`);
  near(r.max[2], 20, 1e-3); assert.ok(r.max[0] <= 4.001 && r.min[0] >= -4.001, JSON.stringify(r));
});
await test('hål: gängat M6 genom en platta', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, -10, -10, 10, 10);
  const e = newExtrude(doc, s.id); e.depth = '10'; insertFeature(doc, e);
  const hs = newSketch(doc, 'XY'); insertFeature(doc, hs); hs.points[pt(hs, 0, 0)].standalone = true;
  const h = newHole(doc, hs.id); h.kind = 'threaded'; applyHoleSize(h, 'M6'); h.threadLength = '10'; insertFeature(doc, h);
  assert.equal(h.pitch, '1');
  const m = buildModel(doc); assert.equal(m.errors.size, 0, [...m.errors.values()].join());
  const v = (await render(m.code)).vol;
  // Borttaget: mer än kärnhålet (mutterns innerdiameter), mindre än hela ytterdiametern + spel.
  assert.ok(v < 4000 - cylVol(minorDiameter(6, 1), 10) && v > 4000 - cylVol(6.2, 10), `${v}`);
});
await test('gänga: invändig i ett hål', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, -10, -10, 10, 10);
  circle(s, 0, 0, minorDiameter(10, 1.5) / 2);
  const e = newExtrude(doc, s.id); e.depth = '12'; insertFeature(doc, e);
  const th = newFeature(doc, 'thread', s); th.mode = 'internal'; th.circles = null; th.length = '12';
  // invändig: föreslå storlek från hålets innerdiameter
  th.size = 'M8'; (await import('../src/features/thread')).suggestThreadSize(th, s);
  assert.equal(th.size, 'M10'); insertFeature(doc, th);
  const m = buildModel(doc); assert.equal(m.errors.size, 0, [...m.errors.values()].join());
  const v = (await render(m.code)).vol;
  const ring = 4800 - cylVol(minorDiameter(10, 1.5), 12);
  assert.ok(v < ring && v > 4800 - cylVol(10.2, 12), `${v} vs ring ${ring}`);
});
/** Gängans riktning ur meshen: hörn på radien R runt (cx, cy) ska ligga på en helix θ/2π − s·z/P ≈ heltal; s = +1 är högergänga. */
function handedness(pos: Float32Array, cx: number, cy: number, R: number, P: number): 'right' | 'left' {
  const frac = (s: number) => {
    let hit = 0, all = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i] - cx, y = pos[i + 1] - cy;
      if (Math.abs(Math.hypot(x, y) - R) > 0.01) continue;
      const u = Math.atan2(y, x) / (2 * Math.PI) - (s * pos[i + 2]) / P;
      all++; if (Math.abs(u - Math.round(u)) < 0.08) hit++;
    }
    assert.ok(all > 50, `för få hörn på radien ${R} (${all})`);
    return hit / all;
  };
  const r = frac(1), l = frac(-1);
  assert.ok(Math.max(r, l) > 0.9, `ingen tydlig helix: ${r} / ${l}`);
  return r > l ? 'right' : 'left';
}
await test('gängor är högergängade i alla riktningar', async () => {
  for (const dir of ['normal', 'reverse'] as const) {
    const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); circle(s, 0, 0, 4);
    const e = newExtrude(doc, s.id); e.depth = '20'; e.direction = 'symmetric'; insertFeature(doc, e);
    const th = newFeature(doc, 'thread', s); th.length = '8'; th.direction = dir; th.chamfer = false; th.clearance = '0'; insertFeature(doc, th);
    assert.equal(handedness((await render(buildModel(doc).code)).pos, 0, 0, 4, 1.25), 'right', `gänga ${dir}`);
  }
  for (const dir of ['normal', 'reverse'] as const) {
    const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, -10, -10, 10, 10);
    const e = newExtrude(doc, s.id); e.depth = '20'; e.direction = 'symmetric'; insertFeature(doc, e);
    const hs = newSketch(doc, 'XY'); insertFeature(doc, hs); hs.points[pt(hs, 2, 1)].standalone = true;
    const h = newHole(doc, hs.id); h.kind = 'threaded'; applyHoleSize(h, 'M6'); h.clearance = '0'; h.direction = dir; insertFeature(doc, h);
    assert.equal(handedness((await render(buildModel(doc).code)).pos, 2, 1, 3, 1), 'right', `hål ${dir}`);
  }
});
const roundedRect = (w: number, h: number, r: number) => w * h - (4 - Math.PI) * Math.max(r, 0) ** 2;
await test('behållare med insticks­lock (rundad rektangel)', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s);
  (await import('../src/features/container')).containerTemplate(s);
  const c = newFeature(doc, 'container', s); insertFeature(doc, c);
  assert.equal(c.lid, 'lip');
  const m = buildModel(doc); assert.equal(m.errors.size, 0, [...m.errors.values()].join());
  const r = await render(m.code);
  // Behållaren 80×60×40 vid origo, locket 10 mm till höger.
  assert.deepEqual(box(r).map(Math.round), [-40, -30, 0, 130, 30, 40]);
  const boxVol = roundedRect(80, 60, 4) * 40 - roundedRect(76, 56, 2) * 38;
  const lidVol = roundedRect(80, 60, 4) * 2 + (roundedRect(75.6, 55.6, 1.8) - roundedRect(71.6, 51.6, 0)) * 6;
  near(r.vol, boxVol + lidVol, (boxVol + lidVol) * 0.003);
  c.lid = 'none'; c.radius = '0';
  near((await render(buildModel(doc).code)).vol, 80 * 60 * 40 - 76 * 56 * 38, 1);
  // Fack 3 × 2: två avdelare i X (56 långa) och en i Y (76 lång), 2 tjocka, 38 höga – minus korsningarna
  c.cellsX = '3'; c.cellsY = '2';
  near((await render(buildModel(doc).code)).vol, 80 * 60 * 40 - 76 * 56 * 38 + (2 * 56 + 76 - 2 * 2) * 2 * 38, 2);
  // Med insticks­lock blir avdelarna lägre (kant 6 + 0,5 mm)
  c.lid = 'lip'; const withLid = (await render(buildModel(doc).code.replace(/\/\/ Modell[\s\S]*$/, 'behallare_1();'))).vol;
  near(withLid, 80 * 60 * 40 - 76 * 56 * 38 + (2 * 56 + 76 - 2 * 2) * 2 * 31.5, 2);
  c.cellsX = '0'; assert.match(buildModel(doc).errors.get(c.id)!, /heltal/);
});
await test('burk med skruvlock: locket går att skruva på', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); circle(s, 0, 0, 25);
  const c = newFeature(doc, 'container', s); c.lid = 'screw';
  (await import('../src/features/container')).container.changed!(c, 'lid', s);
  assert.equal(c.clearance, '0,3'); insertFeature(doc, c);
  const m = buildModel(doc); assert.equal(m.errors.size, 0, [...m.errors.values()].join());
  const r = await render(m.code);
  // Burken Ø50 × 40 vid origo; locket (Ø50 + 2·(0,3 + 2) + grepp) bredvid.
  near(r.min[0], -25, 0.01); near(r.max[2], 40, 0.01);
  const Ro = 25 + 0.3 + 2;
  near(r.max[0], 25 + Ro + 10 + Ro + 0.8, 0.05);
  assert.equal(handedness(r.pos, 0, 0, 25, 2), 'right');
  // Lägg locket på burken (vänt, inskruvat helt) i olika vinklar: någon vinkel ska ge ~inget överlapp.
  const mod = m.code.replace(/\/\/ Modell[\s\S]*$/, '');
  const Hl = 2 + 8, lidX = 25 + Ro + 10;
  let best = Infinity;
  for (const a of [0, 60, 120, 180, 240, 300]) {
    const code = `${mod}\nintersection() {\n  behallare_1();\n  translate([0, 0, 40 + 2]) rotate([0, 0, ${a}]) rotate([180, 0, 0]) translate([-${lidX}, 0, 0]) behallare_1_lid();\n}`;
    let v = 0;
    try { v = (await render(code)).vol; } catch (e) { if (!/empty|tom|No top level|Current top level object is empty/i.test(String(e))) throw e; }
    best = Math.min(best, v);
  }
  assert.ok(best < 1, `minsta överlapp ${best} mm³`);
  c.lid = 'screw'; s.entities = {}; s.points = {}; rect(s, 0, 0, 40, 40);
  assert.match(buildModel(doc).errors.get(c.id)!, /cirkel/);
});
await test('upprepa: linjärt, rutnät, spegla och runt axel', async () => {
  const mk = () => { const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, 10, 0, 20, 10); const e = newExtrude(doc, s.id); e.depth = '5'; insertFeature(doc, e); return { doc, e }; };
  let { doc, e } = mk(); e.rep = 'linear'; e.repAxis = 'x'; e.repCount = '3'; e.repSpacing = '20';
  let r = await render(buildModel(doc).code); assert.deepEqual(box(r), [10, 0, 0, 60, 10, 5]); near(r.vol, 1500, 1e-3);
  ({ doc, e } = mk()); e.rep = 'grid'; e.repAxis = 'x'; e.repCount = '2'; e.repSpacing = '15'; e.repAxis2 = 'z'; e.repCount2 = '3'; e.repSpacing2 = '-10';
  r = await render(buildModel(doc).code); assert.deepEqual(box(r), [10, 0, -20, 35, 10, 5]); near(r.vol, 3000, 1e-3);
  e.repAxis2 = 'x'; assert.match(buildModel(doc).errors.get(e.id)!, /olika/);
  ({ doc, e } = mk()); e.rep = 'mirror'; e.repPlane = 'yz';
  r = await render(buildModel(doc).code); assert.deepEqual(box(r), [-20, 0, 0, 20, 10, 5]); near(r.vol, 1000, 1e-3);
  ({ doc, e } = mk()); e.rep = 'circular'; e.repRotAxis = 'z'; e.repCount = '4'; e.repAngle = '360';
  r = await render(buildModel(doc).code); assert.deepEqual(box(r), [-20, -20, 0, 20, 20, 5]); near(r.vol, 2000, 1e-3);
  e.repCount = '2,5'; assert.match(buildModel(doc).errors.get(e.id)!, /heltal/);
});
await test('skissa på en rund yta: hela manteln som referens, säte under det ritade', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); circle(s, 0, 0, 10);
  const e = newExtrude(doc, s.id); e.depth = '20'; insertFeature(doc, e);
  const r = await render(buildModel(doc).code);
  // Planet genom en mantelfacett (som när man trycker på manteln).
  let t0 = 0;
  for (let t = 0; t < r.pos.length; t += 9) {
    const n = [0, 1, 2].map(i => (r.pos[t + 3 + ((i + 1) % 3)] - r.pos[t + ((i + 1) % 3)]) * (r.pos[t + 6 + ((i + 2) % 3)] - r.pos[t + ((i + 2) % 3)]) - (r.pos[t + 3 + ((i + 2) % 3)] - r.pos[t + ((i + 2) % 3)]) * (r.pos[t + 6 + ((i + 1) % 3)] - r.pos[t + ((i + 1) % 3)]));
    if (Math.abs(n[2]) < 1e-9 * Math.hypot(...n) && n[0] > 0) { t0 = t; break; }
  }
  const P = (k: number): [number, number, number] => [r.pos[t0 + k * 3], r.pos[t0 + k * 3 + 1], r.pos[t0 + k * 3 + 2]];
  const [a, b, c] = [P(0), P(1), P(2)];
  const nrm: [number, number, number] = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
  const sf = slantedFace(r.pos, nrm, [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]);
  const fr = { ...sf.face, n: [sf.face.u[1] * sf.face.v[2] - sf.face.u[2] * sf.face.v[1], sf.face.u[2] * sf.face.v[0] - sf.face.u[0] * sf.face.v[2], sf.face.u[0] * sf.face.v[1] - sf.face.u[1] * sf.face.v[0]] as [number, number, number] };
  const ref = sketchReference(r.pos, fr);
  const xs = ref.segments.flat().map(p => p.x), ys = ref.segments.flat().map(p => p.y);
  near(Math.max(...xs) - Math.min(...xs), 20, 0.05); near(Math.max(...ys) - Math.min(...ys), 20, 1e-3);
  const touch = ref.segments.find(([p, q]) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(Math.abs(p.y - q.y) - 20) < 1e-6 && p.x > Math.min(...xs) + 1 && p.x < Math.max(...xs) - 1);
  assert.ok(touch, 'beröringslinjen');
  assert.ok(planeReference(r.pos, fr).segments.length <= 4, 'planet själv rör bara en remsa');
  const tx = touch[0].x;
  const d = surfaceDepth(r.pos, fr, { x0: tx + 3, y0: 5, x1: tx + 8, y1: 10 });
  assert.ok(d >= 10 - Math.sqrt(100 - 64) - 0.05 && d < 10 - Math.sqrt(100 - 81), `säte ${d}`);
  // Plan yta (toppen): ingen rund yta, inget säte.
  near(surfaceDepth(r.pos, planeFrame('XY', 20), { x0: -3, y0: -3, x1: 3, y1: 3 }), 0);
});
await test('extrudera en yta: toppens kontur med hål, bara den tryckta ytan', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s);
  rect(s, 0, 0, 40, 20); circle(s, 30, 10, 4); rect(s, 50, 0, 60, 10); // en andra platta i samma höjd
  const e = newExtrude(doc, s.id); e.depth = '10'; insertFeature(doc, e);
  const r = await render(buildModel(doc).code);
  const loops = faceLoops(r.pos, planeFrame('XY', 10), [10, 10, 10]);
  assert.equal(loops.length, 2, JSON.stringify(loops.map(l => l.kind)));
  const poly = loops.find(l => l.kind === 'poly'), circ = loops.find(l => l.kind === 'circle');
  assert.ok(poly && poly.kind === 'poly' && poly.pts.length === 4, JSON.stringify(poly));
  assert.deepEqual(poly.pts.map(p => [p.x, p.y]).sort(), [[0, 0], [0, 20], [40, 0], [40, 20]].sort());
  assert.ok(circ && circ.kind === 'circle'); near(circ.c.x, 30, 1e-3); near(circ.c.y, 10, 1e-3); near(circ.r, 4, 1e-3);
  // Som skiss på toppen: extrudera 5 uppåt → hålet går igenom hela.
  const top = newSketch(doc, 'XY'); top.offset = '10'; addFaceLoops(top, loops); insertFeature(doc, top);
  const e2 = newExtrude(doc, top.id); e2.depth = '5'; insertFeature(doc, e2);
  const r2 = await render(buildModel(doc).code);
  assert.deepEqual(box(r2), [0, 0, 0, 60, 20, 15]);
  near(r2.vol, 800 * 15 - Math.PI * 16 * 15 + 100 * 10, 15);
});
await test('extrudera en rund yta: cylindermanteln 2 mm utåt och inåt', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); circle(s, 0, 0, 10);
  const e = newExtrude(doc, s.id); e.depth = '20'; insertFeature(doc, e);
  const r = await render(buildModel(doc).code);
  // En mantelfacett åt +X
  let at: [number, number, number] = [0, 0, 0], nrm: [number, number, number] = [1, 0, 0];
  for (let t = 0; t < r.pos.length; t += 9) {
    const c = [0, 1, 2].map(i => (r.pos[t + i] + r.pos[t + 3 + i] + r.pos[t + 6 + i]) / 3);
    if (c[0] > 9 && Math.abs(c[1]) < 2) { at = c as [number, number, number]; nrm = [c[0], c[1], 0]; break; }
  }
  assert.equal(smoothFace(r.pos, [0, 0, 20], [0, 0, 1]), null, 'toppen är plan');
  const tris = smoothFace(r.pos, at, nrm)!;
  assert.ok(tris && tris.length / 9 > 20, 'hela manteln');
  assert.ok(tris.every((v, i) => i % 3 !== 2 || (v >= -1e-3 && v <= 20 + 1e-3)));
  const f = newFeature(doc, 'surface', WORLD_SKETCH); f.tris = tris; f.depth = '2'; insertFeature(doc, f);
  let r2 = await render(buildModel(doc).code);
  const [x0, , z0, x1, , z1] = box(r2);
  near(x1, 12, 0.05); near(x0, -12, 0.05); near(z0, 0, 1e-3); near(z1, 20, 1e-3);
  near(r2.vol, Math.PI * 144 * 20, Math.PI * 144 * 20 * 0.01);
  f.op = 'remove';
  r2 = await render(buildModel(doc).code);
  near(r2.vol, Math.PI * 64 * 20, Math.PI * 64 * 20 * 0.01);
  near(box(r2)[3], 8, 0.05);
});
await test('extruderad rund yta följer cylinderns mått (och ett håls)', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); const cid = circle(s, 5, 0, 10);
  const e = newExtrude(doc, s.id); e.depth = '20'; insertFeature(doc, e);
  const vars = evalParams([]).vars;
  const ref = findCurveRef(doc, vars, [1, 0, 0], [15, 0, 7])!;
  assert.deepEqual(ref, { feature: e.id, entity: cid, inside: false });
  assert.equal(findCurveRef(doc, vars, [0, 0, 1], [5, 0, 20]), null, 'toppen är ingen rund sida');
  const f = newFeature(doc, 'surface', WORLD_SKETCH); f.ref = ref; f.depth = '2'; insertFeature(doc, f);
  let r = await render(buildModel(doc).code);
  box(r).forEach((v, i) => near(v, [-7, -12, 0, 17, 12, 20][i], 0.02));
  near(r.vol, Math.PI * 144 * 20, Math.PI * 144 * 20 * 0.005);
  // Större cylinder: ytan följer med utan att väljas om.
  (s.entities[cid] as { r: number }).r = 15; e.depth = '30';
  r = await render(buildModel(doc).code);
  box(r).forEach((v, i) => near(v, [-12, -17, 0, 22, 17, 30][i], 0.02));
  near(r.vol, Math.PI * 289 * 30, Math.PI * 289 * 30 * 0.005);
  f.op = 'remove';
  r = await render(buildModel(doc).code);
  near(r.vol, Math.PI * 169 * 30, Math.PI * 169 * 30 * 0.005);
  f.depth = '20'; assert.match(buildModel(doc).errors.get(f.id)!, /radien/);
  // Ett hål: väggen vetter mot centrum; "utåt" (lägg till) krymper hålet.
  const d2 = emptyDoc(); const p = newSketch(d2, 'XY'); insertFeature(d2, p); rect(p, -20, -20, 20, 20); const hid = circle(p, 0, 0, 5);
  const pe = newExtrude(d2, p.id); pe.depth = '10'; insertFeature(d2, pe);
  const href = findCurveRef(d2, vars, [-1, 0, 0], [5, 0, 5])!;
  assert.deepEqual(href, { feature: pe.id, entity: hid, inside: true });
  const hf = newFeature(d2, 'surface', WORLD_SKETCH); hf.ref = href; hf.depth = '1'; insertFeature(d2, hf);
  r = await render(buildModel(d2).code);
  near(r.vol, (1600 - Math.PI * 16) * 10, 15);
  hf.op = 'remove';
  r = await render(buildModel(d2).code);
  near(r.vol, (1600 - Math.PI * 36) * 10, 15);
});
await test('upprepa runt en cirkels centrum (cylinder utanför origo, även i XZ)', async () => {
  for (const plane of ['XY', 'XZ'] as const) {
    const doc = emptyDoc();
    const cs = newSketch(doc, plane); insertFeature(doc, cs); const cid = circle(cs, 30, 10, 10);
    const cyl = newExtrude(doc, cs.id); cyl.depth = '10'; insertFeature(doc, cyl);
    const rs = newSketch(doc, plane); insertFeature(doc, rs); rect(rs, 38, 8, 42, 12);
    const rib = newExtrude(doc, rs.id); rib.depth = '10'; rib.rep = 'circular'; rib.repRotAxis = 'circle'; rib.repCircle = `${cs.id}/${cid}`; rib.repCount = '4'; rib.repAngle = '360';
    insertFeature(doc, rib);
    const m = buildModel(doc); assert.equal(m.errors.size, 0, [...m.errors.values()].join());
    const r = await render(m.code);
    // Fyra ribbor runt (30, 10): ytterkanten 12 mm från centrum åt alla håll.
    const [x0, y0, z0, x1, y1, z1] = box(r);
    if (plane === 'XY') assert.deepEqual([x0, y0, x1, y1], [18, -2, 42, 22]);
    else assert.deepEqual([x0, z0, x1, z1], [18, -2, 42, 22]);
    const opts = repeatCircles({ doc, before: doc.features.length });
    assert.deepEqual(opts.map(o => o.value), [`${cs.id}/${cid}`]);
    delete cs.entities[cid];
    assert.match(buildModel(doc).errors.get(rib.id)!, /cirkel/);
  }
});
await test('upprepa: sex hål runt en axel; gängor kan inte speglas', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, -30, -30, 30, 30);
  const e = newExtrude(doc, s.id); e.depth = '5'; insertFeature(doc, e);
  const hs = newSketch(doc, 'XY'); insertFeature(doc, hs); hs.points[pt(hs, 20, 0)].standalone = true;
  const h = newHole(doc, hs.id); h.kind = 'simple'; h.size = 'custom'; h.diameter = '4'; h.rep = 'circular'; h.repCount = '6'; h.repAngle = '360'; insertFeature(doc, h);
  const r = await render(buildModel(doc).code);
  near(r.vol, 3600 * 5 - 6 * cylVol(4, 5), 6 * cylVol(4, 5) * 0.01);
  h.kind = 'threaded'; applyHoleSize(h, 'M4'); h.rep = 'mirror';
  assert.match(buildModel(doc).errors.get(h.id)!, /speglas/);
});
await test('extrudera med hörnradie, fasad och avrundad kant', async () => {
  const mk = () => { const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, 0, 0, 20, 20); const e = newExtrude(doc, s.id); e.depth = '10'; insertFeature(doc, e); return { doc, e }; };
  let { doc, e } = mk(); e.radius = '3';
  let r = await render(buildModel(doc).code); near(r.vol, (400 - (4 - Math.PI) * 9) * 10, 4); assert.deepEqual(box(r), [0, 0, 0, 20, 20, 10]);
  ({ doc, e } = mk()); e.edge = 'chamfer'; e.edgeSize = '2';
  const exact = 400 * 8 + (800 - 160 + 32 / 3);
  r = await render(buildModel(doc).code); near(r.vol, exact, exact * 0.003); assert.deepEqual(box(r), [0, 0, 0, 20, 20, 10]);
  e.edgeWhere = 'both'; e.direction = 'symmetric';
  r = await render(buildModel(doc).code); near(r.vol, 400 * 6 + 2 * (800 - 160 + 32 / 3), exact * 0.003); assert.deepEqual(box(r), [0, 0, -5, 20, 20, 5]);
  ({ doc, e } = mk()); e.edge = 'fillet'; e.edgeSize = '3'; e.edgeWhere = 'near';
  // Avrundad kant: bortskuret per sida ≈ (1 − π/4)·r² gånger omkretsen (hörnen ger lite mer).
  const filletVol = 4000 - (1 - Math.PI / 4) * 9 * 80;
  r = await render(buildModel(doc).code); near(r.vol, filletVol, 15); assert.deepEqual(box(r), [0, 0, 0, 20, 20, 10]);
  e.edgeSize = '6'; e.edgeWhere = 'both'; assert.match(buildModel(doc).errors.get(e.id)!, /större än djupet/);
});
await test('text: upphöjd vid en punkt, ingraverad i en platta, svenska tecken och citattecken', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, -40, -15, 40, 15);
  const e = newExtrude(doc, s.id); e.depth = '5'; insertFeature(doc, e);
  const ts = newSketch(doc, 'XY'); ts.offset = '5'; insertFeature(doc, ts); ts.points[pt(ts, 10, 0)].standalone = true;
  const tx = newFeature(doc, 'text', ts); tx.text = 'Låda "1"'; tx.size = '8'; tx.depth = '1'; insertFeature(doc, tx);
  let m = buildModel(doc); assert.equal(m.errors.size, 0, [...m.errors.values()].join());
  assert.match(m.code, /text\("Låda \\"1\\"", size = 8, font = "Liberation Sans:style=Bold", halign = "center"/);
  let r = await render(m.code);
  near(r.max[2], 6, 1e-3); assert.ok(r.vol > 80 * 30 * 5 + 20, `${r.vol}`);
  // Texten centrerad kring punkten (10, 0) på ovansidan
  const txt = await render(m.code.replace(/\/\/ Modell[\s\S]*$/, 'text_1();'));
  near((txt.min[0] + txt.max[0]) / 2, 10, 0.6); near(txt.min[2], 5, 1e-3); assert.ok(txt.max[1] - txt.min[1] > 6, JSON.stringify(txt));
  // Ingraverad: riktningen vänds nedåt automatiskt och volymen minskar
  tx.op = 'remove'; (await import('../src/features/text')).text.changed!(tx, 'op', ts);
  assert.equal(tx.direction, 'reverse');
  r = await render(buildModel(doc).code); near(r.max[2], 5, 1e-3); assert.ok(r.vol < 80 * 30 * 5 - 20, `${r.vol}`);
  tx.font = 'stencil'; r = await render(buildModel(doc).code); assert.ok(r.vol < 12000);
  // Start: samma text på plattans skiss (z = 0) men lyft till ovansidan
  tx.sketch = s.id; tx.points = null; tx.start = '5'; tx.font = 'bold';
  r = await render(buildModel(doc).code); near(r.max[2], 5, 1e-3); assert.ok(r.vol < 80 * 30 * 5 - 20, `${r.vol}`);
  tx.text = '  '; assert.match(buildModel(doc).errors.get(tx.id)!, /Skriv en text/);
});
await test('skissa på en yta: plan, förskjutning som följer måttet, kontur och riktning', async () => {
  const doc = emptyDoc(); doc.params = [{ name: 'tjocklek', expr: '5' }];
  const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, 0, 0, 40, 20);
  const e = newExtrude(doc, s.id); e.depth = 'tjocklek'; insertFeature(doc, e);
  const s2 = newSketch(doc, 'XY'); insertFeature(doc, s2); circle(s2, 20, 10, 4);
  const cut = newExtrude(doc, s2.id); cut.depth = 'tjocklek'; cut.op = 'remove'; insertFeature(doc, cut);
  let r = await render(buildModel(doc).code);
  const vars = () => evalParams(doc.params).vars;
  // Ovansidan: XY på höjden "tjocklek"; konturen har plattans hörn och hålets mitt.
  assert.deepEqual(facePlane([0, 0, 1], [5, 5, 5.0000001]), { plane: 'XY', offset: 5, flipped: false });
  assert.equal(offsetExpr(doc, 'XY', 5, vars()), 'tjocklek');
  const ref = planeReference(r.pos, planeFrame('XY', 5));
  const has = (x: number, y: number) => ref.snaps.some(p => Math.abs(p.x - x) < 1e-3 && Math.abs(p.y - y) < 1e-3);
  for (const [x, y] of [[0, 0], [40, 0], [40, 20], [0, 20], [20, 10]]) assert.ok(has(x, y), `snäpp ${x},${y}: ${JSON.stringify(ref.snaps)}`);
  assert.equal(ref.snaps.length, 5, 'inga snäpp längs hålets kant');
  assert.equal(planeReference(r.pos, planeFrame('XY', 2.5)).segments.length, 0, 'inget mitt i plattan');
  // Upphöjning på ovansidan; byt till ta bort → skär nedåt.
  const top = newSketch(doc, 'XY'); top.offset = 'tjocklek'; top.outward = 'normal'; insertFeature(doc, top); rect(top, 2, 2, 8, 8);
  const boss = newExtrude(doc, top.id); boss.depth = '3'; insertFeature(doc, boss);
  assert.equal(boss.direction, 'normal');
  r = await render(buildModel(doc).code); near(r.max[2], 8, 1e-3);
  boss.op = 'remove'; KINDS.extrude.changed!(boss as never, 'op', top);
  assert.equal(boss.direction, 'reverse');
  r = await render(buildModel(doc).code); near(r.max[2], 5, 1e-3); near(r.vol, 800 * 5 - Math.PI * 16 * 5 - 36 * 3, 2);
  boss.op = 'add'; KINDS.extrude.changed!(boss as never, 'op', top); assert.equal(boss.direction, 'normal');
  // Måttet ändras → skissen på ytan följer med.
  doc.params[0].expr = '8';
  r = await render(buildModel(doc).code); near(r.max[2], 11, 1e-3);
  // Undersidan pekar nedåt: nya features bygger nedåt, hål borras uppåt (in i kroppen).
  const fb = facePlane([0, 0, -1], [5, 5, 0])!;
  assert.deepEqual(fb, { plane: 'XY', offset: 0, flipped: true });
  const bottom = newSketch(doc, 'XY'); bottom.outward = 'reverse'; insertFeature(doc, bottom); rect(bottom, 30, 2, 38, 8);
  const foot = newExtrude(doc, bottom.id); foot.depth = '2'; insertFeature(doc, foot);
  assert.equal(foot.direction, 'reverse');
  assert.equal(newHole(doc, bottom.id).direction, 'normal');
  assert.equal(newHole(doc, top.id).direction, 'reverse');
  assert.equal(newHole(doc, s.id).direction, 'normal', 'vanlig skiss: som förut');
  r = await render(buildModel(doc).code); near(r.min[2], -2, 1e-3);
  // Baksidan (normal +Y) ligger i Fram-planet förskjutet −20, och pekar mot planets negativa normal.
  const fs = facePlane([0, 1, 0], [5, 20, 2])!;
  assert.deepEqual(fs, { plane: 'XZ', offset: -20, flipped: true });
  assert.equal(offsetExpr(doc, 'XZ', -20, vars()), '-20');
  const back = newSketch(doc, 'XZ'); back.offset = '-20'; back.outward = 'reverse'; insertFeature(doc, back); rect(back, 5, 1, 15, 4);
  const tab = newExtrude(doc, back.id); tab.depth = '2'; insertFeature(doc, tab);
  r = await render(buildModel(doc).code); near(r.max[1], 22, 1e-3);
  const backRef = planeReference(r.pos, planeFrame('XZ', -20));
  assert.ok(backRef.snaps.some(p => Math.abs(p.x - 40) < 1e-3 && Math.abs(p.y - 8) < 1e-3), JSON.stringify(backRef.snaps));
  // Höger sida (normal +X) och sned yta.
  assert.deepEqual(facePlane([1, 0, 0], [40, 3, 3]), { plane: 'YZ', offset: 40, flipped: false });
  assert.equal(facePlane([0, 0.6, 0.8], [0, 0, 0]), null);
  // Symmetrisk extrudering: båda sidorna hittas som uttryck.
  e.direction = 'symmetric';
  assert.equal(offsetExpr(doc, 'XY', 4, vars()), 'tjocklek / 2');
  assert.equal(offsetExpr(doc, 'XY', -4, vars()), '-(tjocklek / 2)');
  e.direction = 'reverse';
  assert.equal(offsetExpr(doc, 'XY', -8, vars()), '-tjocklek');
  assert.equal(offsetExpr(doc, 'XY', 1.25, vars()), '1,25');
});
await test('skissa på en sned yta: eget plan, hål inåt och tapp utåt', async () => {
  const doc = emptyDoc();
  // Kil: profil i Höger-planet (y, z) = (0,0) (20,0) (0,10), 40 lång längs X → sluttning med normal (0, 1, 2)/√5.
  const s = newSketch(doc, 'YZ'); insertFeature(doc, s);
  const a = pt(s, 0, 0), b = pt(s, 20, 0), c = pt(s, 0, 10); line(s, a, b); line(s, b, c); line(s, c, a);
  const e = newExtrude(doc, s.id); e.depth = '40'; insertFeature(doc, e);
  let r = await render(buildModel(doc).code);
  near(r.vol, 4000, 1e-3);
  const n0: [number, number, number] = [0, 1 / Math.sqrt(5), 2 / Math.sqrt(5)];
  assert.equal(facePlane(n0, [20, 10, 5]), null, 'sned yta är inget grundplan');
  const sf = slantedFace(r.pos, n0, [20, 10, 5]);
  assert.equal(sf.plane, 'XY');
  assert.deepEqual(sf.face.o, [40, 20, 0], 'origo i nedre vänstra hörnet sett utifrån');
  const sk = newSketch(doc, sf.plane); sk.face = sf.face; sk.outward = 'normal'; insertFeature(doc, sk);
  const fr = sketchFrame(sk);
  for (let i = 0; i < 3; i++) near(fr.n[i], n0[i], 1e-9);
  const ref = planeReference(r.pos, fr);
  assert.equal(ref.segments.length, 4); assert.equal(ref.snaps.length, 4);
  const L = Math.sqrt(500);
  for (const [x, y] of [[0, 0], [40, 0], [40, L], [0, L]]) assert.ok(ref.snaps.some(p => Math.abs(p.x - x) < 1e-3 && Math.abs(p.y - y) < 1e-3), `${x},${y}: ${JSON.stringify(ref.snaps)}`);
  // Hål 3 mm in i ytan mitt på.
  circle(sk, 20, L / 2, 3);
  const hole = newExtrude(doc, sk.id); hole.depth = '3'; insertFeature(doc, hole);
  hole.op = 'remove'; KINDS.extrude.changed!(hole as never, 'op', sk);
  assert.equal(hole.direction, 'reverse');
  const code = buildModel(doc).code;
  assert.match(code, /multmatrix\(\[\[/);
  r = await render(code);
  near(r.vol, 4000 - Math.PI * 9 * 3, 0.5);
  // Samma cirkel som tapp utåt: sticker ut 2 mm längs normalen.
  hole.op = 'add'; KINDS.extrude.changed!(hole as never, 'op', sk); hole.depth = '2';
  r = await render(buildModel(doc).code);
  near(r.vol, 4000 + Math.PI * 9 * 2, 0.5);
  const tip = toWorld(fr, { x: 20, y: L / 2 }, 2);
  let reach = -Infinity; // längst ut längs normalen
  for (let i = 0; i < r.pos.length; i += 3) reach = Math.max(reach, (r.pos[i] - fr.o[0]) * fr.n[0] + (r.pos[i + 1] - fr.o[1]) * fr.n[1] + (r.pos[i + 2] - fr.o[2]) * fr.n[2]);
  near(reach, 2, 1e-3);
  assert.ok(tip[2] > 5, 'tappen sitter på sluttningen');
  // Sned ytskiss påverkar inte förskjutningsuttryck för grundplanen.
  assert.equal(offsetExpr(doc, 'XY', 0, evalParams([]).vars), '0');
});
await test('sned ytskiss följer måtten: längd, lutning, ändyta och borttagen källa', async () => {
  const doc = emptyDoc(); doc.params = [{ name: 'L', expr: '40' }];
  const vars = () => evalParams(doc.params).vars;
  const s = newSketch(doc, 'YZ'); insertFeature(doc, s);
  const a = pt(s, 0, 0), b = pt(s, 20, 0), c = pt(s, 0, 10); line(s, a, b); const slope = line(s, b, c); line(s, c, a);
  const e = newExtrude(doc, s.id); e.depth = 'L'; insertFeature(doc, e);
  let r = await render(buildModel(doc).code);
  const n0: [number, number, number] = [0, 1 / Math.sqrt(5), 2 / Math.sqrt(5)];
  const ref = findFaceRef(doc, vars(), n0, [20, 10, 5])!;
  assert.deepEqual(ref, { feature: e.id, entity: slope, sign: 1 });
  assert.equal(findFaceRef(doc, vars(), n0, [20, 30, 5]), null, 'utanför ytan');
  const sk = newSketch(doc, 'XY'); sk.face = slantedFace(r.pos, n0, [20, 10, 5]).face; sk.faceRef = ref; sk.outward = 'normal'; insertFeature(doc, sk);
  let fr = sketchFrame(sk, vars(), doc);
  assert.deepEqual(fr.o, sk.face.o, 'samma origo som ur meshen');
  circle(sk, 5, 5, 2);
  const boss = newExtrude(doc, sk.id); boss.depth = '2'; insertFeature(doc, boss);
  // Längre kil: ytans nedre vänstra hörn flyttar med (x = L).
  doc.params[0].expr = '60';
  fr = sketchFrame(sk, vars(), doc);
  assert.deepEqual(fr.o, [60, 20, 0]);
  r = await render(buildModel(doc).code);
  near(r.vol, 6000 + Math.PI * 4 * 2, 0.3);
  // Brantare kil (punkten flyttad som när ett mått ändras): normalen följer.
  s.points[c].y = 16;
  fr = sketchFrame(sk, vars(), doc);
  const want = [0, 16 / Math.hypot(16, 20), 20 / Math.hypot(16, 20)];
  for (let i = 0; i < 3; i++) near(fr.n[i], want[i], 1e-9);
  r = await render(buildModel(doc).code);
  near(r.vol, 0.5 * 20 * 16 * 60 + Math.PI * 4 * 2, 0.3);
  // Skiss på tappens ovansida (ändyta) följer tappens höjd.
  const top = toWorld(fr, { x: 5, y: 5 }, 2);
  const capRef = findFaceRef(doc, vars(), fr.n, top)!;
  assert.deepEqual(capRef, { feature: boss.id, cap: 'hi', sign: 1 });
  const sk2 = newSketch(doc, 'XY'); sk2.face = { o: top, u: fr.u, v: fr.v }; sk2.faceRef = capRef; sk2.outward = 'normal'; insertFeature(doc, sk2);
  const w = (q: number[]) => (q[0] - fr.o[0]) * fr.n[0] + (q[1] - fr.o[1]) * fr.n[1] + (q[2] - fr.o[2]) * fr.n[2];
  near(w(sketchFrame(sk2, vars(), doc).o), 2, 1e-9);
  boss.depth = '5';
  near(w(sketchFrame(sk2, vars(), doc).o), 5, 1e-9);
  // Källan borta → senast kända läge (face).
  removeFeature(doc, e);
  assert.deepEqual(sketchFrame(sk, vars(), doc).o, sk.face.o);
});

/** Behållarens kod utan modellraden, och locket lagt på lådan (vänt, kanten nedåt i lådan). */
function assembled(code: string, m: string, dx: number, H: number, fl: number) {
  const mod = code.replace(/\/\/ Modell[\s\S]*$/, '');
  return (body: string) => `${mod}\nintersection() {\n  ${body}\n  translate([0, 0, ${H + fl}]) rotate([180, 0, 0]) translate([-${dx}, 0, 0]) ${m}_lid();\n}`;
}
const volOrZero = async (code: string) => {
  try { return (await render(code)).vol; } catch (e) { if (/empty|top level/i.test(String(e))) return 0; throw e; }
};
await test('behållare med snäpplock: vulsten passar i spåret, och utan spår tar den i', async () => {
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s);
  (await import('../src/features/container')).containerTemplate(s);
  const c = newFeature(doc, 'container', s); c.lid = 'snap'; insertFeature(doc, c);
  assert.equal(c.snapDepth, '0,6'); assert.equal(c.clearance, '0,2');
  const m = buildModel(doc); assert.equal(m.errors.size, 0, [...m.errors.values()].join());
  const r = await render(m.code);
  assert.deepEqual(box(r).map(Math.round), [-40, -30, 0, 130, 30, 40]);
  const on = assembled(m.code, 'behallare_1', 90, 40, 2);
  const fit = await volOrZero(on('behallare_1();'));
  // Lådan med spår: vulsten ligger i spåret (bara skiktens trappsteg kan nudda).
  assert.ok(fit < 1, `överlapp med spår: ${fit}`);
  // Samma lock på en låda utan spår: vulsten tar i väggen – det är snäppet.
  c.lid = 'lip';
  const plain = buildModel(doc).code.replace(/\/\/ Modell[\s\S]*$/, '');
  c.lid = 'snap';
  const snapLid = m.code.match(/module behallare_1_lid\(\) \{[\s\S]*?\n\}/)![0];
  const plainBox = plain.replace(/module behallare_1_lid\(\) \{[\s\S]*?\n\}/, snapLid);
  const grip = await volOrZero(`${plainBox}\nintersection() {\n  behallare_1();\n  translate([0, 0, 42]) rotate([180, 0, 0]) translate([-90, 0, 0]) behallare_1_lid();\n}`);
  // Ringen runt: omkrets ~ 2·(75,6 + 55,6) − hörn, tvärsnitt ≈ (d − c) · vulstens höjd i det inträngande partiet.
  assert.ok(grip > 20 && grip < 120, `ingrepp utan spår: ${grip}`);
  console.log(`   snäpplock: överlapp med spår ${fit.toFixed(2)} mm³, utan spår ${grip.toFixed(1)} mm³`);
  // Fel som ska fångas.
  c.snapDepth = '0,2'; assert.match(buildModel(doc).errors.get(c.id)!, /spelet/);
  c.snapDepth = '1,5'; assert.match(buildModel(doc).errors.get(c.id)!, /tunn/);
  c.snapDepth = '0,6'; c.lipHeight = '2'; assert.match(buildModel(doc).errors.get(c.id)!, /låg/);
});

await test('snäpphake och urtag: volymer, riktning och töjning', async () => {
  const { snapStrain } = await import('../src/features/snap');
  const vars = evalParams([]).vars;
  near(snapStrain({ length: '12', thickness: '1,5', overhang: '1' }, vars)!, (1.5 * 1.5 * 1) / 144);
  // Platta 30 × 20 × 3 och en hake i (10, 10) på ovansidan, hullingen åt +X.
  const doc = emptyDoc(); const s = newSketch(doc, 'XY'); insertFeature(doc, s); rect(s, 0, 0, 30, 20);
  const e = newExtrude(doc, s.id); e.depth = '3'; insertFeature(doc, e);
  const top = newSketch(doc, 'XY'); top.offset = '3'; insertFeature(doc, top);
  const p = pt(top, 10, 10); top.points[p].standalone = true;
  const h = newFeature(doc, 'snap', top); insertFeature(doc, h);
  let m = buildModel(doc); assert.equal(m.errors.size, 0, [...m.errors.values()].join());
  let r = await render(m.code);
  // L = 12 ovanför plattan; hullingen 1 mm åt +X från balkens yta (x = 10,75).
  near(r.max[2], 15, 1e-3); near(r.max[0], 30, 1e-3);
  const barbTipX = Math.max(...Array.from({ length: r.pos.length / 3 }, (_, i) => (r.pos[i * 3 + 2] > 3.5 && r.pos[i * 3 + 2] < 14.9 ? r.pos[i * 3] : -Infinity)));
  near(barbTipX, 11.75, 1e-3);
  // Haken: balk 1,5 × 12 + rotfas 2 · ½ · 0,75² + hulling (trapets) – gånger bredden 6.
  const ramp = 1 / Math.tan(Math.PI / 6);
  const area = 1.5 * 12 + 0.75 * 0.75 + (0.4 * 1 + 0.5 * ramp * 1);
  near(r.vol, 30 * 20 * 3 + area * 6, 0.01);
  // Lösbar: 45°-baksida ger lite mer hulling.
  h.retention = 'release';
  near((await render(buildModel(doc).code)).vol, 30 * 20 * 3 + (area + 0.5) * 6, 0.01);
  // Riktning 90°: hullingen åt +Y.
  h.retention = 'lock'; h.angle = '90';
  r = await render(buildModel(doc).code);
  const tipY = Math.max(...Array.from({ length: r.pos.length / 3 }, (_, i) => (r.pos[i * 3 + 2] > 3.5 && r.pos[i * 3 + 2] < 14.9 ? r.pos[i * 3 + 1] : -Infinity)));
  near(tipY, 11.75, 1e-3);
  // Urtag: (t + y + 2c) × (b + 2c) × djup, nedåt i plattan.
  h.kind = 'catch'; (await import('../src/features/snap')).snap.changed!(h, 'kind', top);
  assert.equal(h.direction, 'reverse'); h.angle = '0'; h.depth = '2';
  m = buildModel(doc); assert.equal(m.errors.size, 0, [...m.errors.values()].join());
  near((await render(m.code)).vol, 30 * 20 * 3 - (1.5 + 1 + 0.4) * (6 + 0.4) * 2, 0.01);
  // För kort hake.
  h.kind = 'hook'; h.length = '2'; assert.match(buildModel(doc).errors.get(h.id)!, /kort/);
});
console.log(`${n} modelltester ok`);
