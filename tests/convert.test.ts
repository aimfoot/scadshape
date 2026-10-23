// Tests for .scad → sketches and features (convert/scad2doc.ts) with the real OpenSCAD WASM. The
// conversion succeeds when the new model has the same volume and size as the original (the original
// is rendered at fine resolution: circles without $fn become real circles in the sketches).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { setLang } from '../src/i18n';
import { scadToDoc, svgLoops, type ConvertEngine } from '../src/convert/scad2doc';
import { parseCsg, csgToScad } from '../src/convert/csg';
import { scadParams } from '../src/convert/params';
import { evalParams } from '../src/params';
import { syncSketchParams } from '../src/paramsync';
import type { SketchFeature } from '../src/doc';
import { buildModel } from '../src/model3d';
import { parseBinaryStl } from '../src/stl';
import { fontsFor } from '../src/fonts';
import { loadSolver } from '../src/sketch/solver';
import type { SketchData } from '../src/sketch/model';
setLang('en');
const solver = await loadSolver(process.env.WASM);

const ROOT = process.env.ROOT!;
const wasmBinary = readFileSync(ROOT + '/vendor/openscad/openscad.wasm');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { default: OpenSCAD } = (await import(ROOT + '/vendor/openscad/openscad.js')) as { default: (o: object) => Promise<any> };
const libFiles: [string, Buffer][] = [];
const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.scad')) libFiles.push([relative(ROOT + '/vendor/libraries', p), readFileSync(p)]); } };
walk(ROOT + '/vendor/libraries');

async function run(src: string, out: string, args: string[] = []) {
  const log: string[] = [];
  const inst = await OpenSCAD({ noInitialRun: true, wasmBinary, print: (s: string) => log.push(s), printErr: (s: string) => log.push(s),
    preRun: [(m: { ENV: Record<string, string> }) => { m.ENV.OPENSCADPATH = '/libraries:/libraries/dotSCAD/src:/libraries/gridfinity-rebuilt-openscad'; m.ENV.FONTCONFIG_FILE = '/fonts/fonts.conf'; }] });
  for (const [p, b] of libFiles) { inst.FS.mkdirTree('/libraries/' + p.slice(0, p.lastIndexOf('/'))); inst.FS.writeFile('/libraries/' + p, b); }
  const fonts = fontsFor(src);
  inst.FS.mkdirTree('/fonts');
  for (const f of fonts) inst.FS.writeFile(`/fonts/${f}`, readFileSync(ROOT + '/public/fonts/' + f));
  inst.FS.writeFile('/fonts/fonts.conf', '<?xml version="1.0"?>\n<fontconfig><dir>/fonts</dir></fontconfig>\n');
  inst.FS.writeFile('/in.scad', src);
  let rc: number;
  try { rc = inst.callMain(['/in.scad', '-o', out, ...args]); } catch (e) { rc = -1; log.push(String(e)); }
  if (rc !== 0) throw new Error(`OpenSCAD ${rc}: ${log.filter(l => /ERROR|WARN/.test(l)).join(' | ')}`);
  return inst.FS.readFile(out) as Uint8Array;
}
const engine: ConvertEngine = {
  csg: async src => new TextDecoder().decode(await run(src, '/out.csg')),
  svg: async src => new TextDecoder().decode(await run(src, '/out.svg')),
};
async function mesh(src: string) {
  const m = parseBinaryStl((await run(src, '/out.stl', ['--export-format=binstl', '--backend=manifold'])).slice().buffer);
  const p = m.positions;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let vol = 0;
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 9; k++) { const a = k % 3; min[a] = Math.min(min[a], p[i + k]); max[a] = Math.max(max[a], p[i + k]); }
    vol += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
  }
  return { vol, min, max };
}
let n = 0;
const test = async (name: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log('ok', name); };

/** Convert, render both and compare. Returns statistics and deviations. */
async function compare(src: string) {
  const t0 = performance.now();
  const r = await scadToDoc(src, engine);
  const ms = performance.now() - t0;
  const m = buildModel(r.doc);
  assert.equal(m.errors.size, 0, [...m.errors.values()].join(' | '));
  const a = await mesh(src + '\n$fa = 1; $fs = 0.2;\n');
  const b = await mesh(m.code);
  const dv = Math.abs(a.vol - b.vol) / Math.abs(a.vol);
  const db = Math.max(...[0, 1, 2].flatMap(i => [Math.abs(a.min[i] - b.min[i]), Math.abs(a.max[i] - b.max[i])]));
  return { ...r, ms, dv, db, features: r.doc.features.length };
}

await test('the CSG parser reads and writes back', () => {
  const nodes = parseCsg('group() {\n multmatrix([[1, 0, 0, 3], [0, 1, 0, 3], [0, 0, 1, 0], [0, 0, 0, 1]]) {\n  cylinder($fn = 48, h = 8.4, r1 = 3, r2 = 3, center = false);\n }\n text(text = "Hej \\"du\\"", size = 10);\n polygon(points = [[0, 0], [1, 0.5e-3], [-2, 3]], paths = undef, convexity = 1);\n}');
  assert.equal(nodes[0].children.length, 3);
  assert.equal(nodes[0].children[0].children[0].args.h, 8.4);
  assert.equal(nodes[0].children[1].args.text, 'Hej "du"');
  assert.deepEqual(nodes[0].children[2].args.points, [[0, 0], [1, 0.0005], [-2, 3]]);
  assert.equal(nodes[0].children[2].args.paths, null);
  assert.deepEqual(parseCsg(csgToScad(nodes[0])), nodes);
  assert.deepEqual(svgLoops('<path d="M 1,2 L 3,-4 L 5,6 z M 0,0 L 1,0 L 1,1 z"/>'), [[{ x: 1, y: -2 }, { x: 3, y: 4 }, { x: 5, y: -6 }], [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: -1 }]]);
});

await test('plate with two holes: two sketches, dimensions, exact volume', async () => {
  const r = await compare('difference() {\n  cube([40, 30, 10]);\n  translate([10, 10, -1]) cylinder(h = 12, r = 3);\n  translate([30, 20, -1]) cylinder(h = 12, d = 6);\n}');
  assert.deepEqual([r.sketches, r.extrudes, r.codeBlocks], [2, 2, 0], JSON.stringify(r.doc.features.map(f => f.type)));
  assert.ok(r.dv < 0.002 && r.db < 1e-3, `volume ${r.dv}, size ${r.db}`);
  const sk = r.doc.features[0] as { constraints: { type: string; value?: number }[] };
  assert.deepEqual(sk.constraints.filter(c => c.type === 'distance').map(c => c.value), [40, 30]);
  const holes = r.doc.features[2] as { constraints: { type: string; value?: number }[]; offset?: string };
  assert.deepEqual(holes.constraints.filter(c => c.type === 'diameter').map(c => c.value), [6, 6]); assert.equal(holes.offset, '-1');
  // Each hole is placed from the origin: x and y as dimensions.
  assert.deepEqual(holes.constraints.filter(c => c.type === 'distance').map(c => c.value), [10, 10, 30, 20]);
  assert.equal(solver.solve(holes as unknown as SketchData).dof, 0);
  assert.equal((r.doc.features[3] as { op: string }).op, 'remove');
});

await test('rounded box (hull of cylinders), rotation to XZ, hexagon, cone and sphere as Revolve', async () => {
  const src = `
    $fn = 64;
    hull() for (x = [0, 50], y = [0, 30]) translate([x, y, 0]) cylinder(r = 5, h = 20);
    translate([0, -10, 0]) rotate([90, 0, 0]) linear_extrude(4) square([20, 10]);
    translate([80, 0, 0]) cylinder(r = 6, h = 5, $fn = 6);
    translate([80, 30, 0]) cylinder(r1 = 6, r2 = 2, h = 8);
    translate([100, 30, 10]) rotate([0, 90, 0]) cylinder(r1 = 3, r2 = 5, h = 6, center = true);
    translate([0, 60, 10]) sphere(r = 8);`;
  const r = await compare(src);
  assert.deepEqual([r.codeBlocks, r.revolves], [0, 3], JSON.stringify(r.doc.features.map(f => f.type)));
  const kinds = r.doc.features.filter(f => f.type === 'sketch').map(f => (f as { plane: string }).plane);
  assert.ok(kinds.includes('XZ'), kinds.join());
  const box = r.doc.features[0] as SketchData & { entities: Record<string, { type: string }> };
  assert.deepEqual(Object.values(box.entities).map(e => e.type).sort(), ['arc', 'arc', 'arc', 'arc', 'line', 'line', 'line', 'line']);
  // Parametric and fully defined: dimensions 60 × 40, radius 5 and the bottom left corner's center at
  // the origin – and the solver moves nothing.
  const before = JSON.stringify(box.points);
  const sol = solver.solve(box);
  assert.ok(sol.ok, JSON.stringify(sol)); assert.equal(sol.dof, 0); assert.deepEqual(sol.redundant, []);
  for (const [id, p] of Object.entries(box.points)) { const q = JSON.parse(before)[id]; assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 1e-6, id); }
  assert.deepEqual(box.constraints.filter(c => 'value' in c).map(c => (c as { value: number }).value).sort((a, b) => a - b), [5, 40, 60]);
  assert.deepEqual(box.constraints.filter(c => c.type === 'hpoints' || c.type === 'vpoints').map(c => c.type).sort(), ['hpoints', 'vpoints']);
  // OpenSCAD's sphere does not reach all the way to the poles (the points lie between them) – hence
  // 0.02 mm.
  assert.ok(r.dv < 0.002 && r.db < 0.02, `volume ${r.dv}, size ${r.db}`);
});

await test('offset and text are drawn by OpenSCAD and become lines and arcs', async () => {
  const r = await compare('linear_extrude(3) offset(r = 4, $fn = 32) square([30, 20]);\ntranslate([0, 40, 0]) linear_extrude(2) text("Hej", size = 10, font = "Liberation Sans");');
  assert.equal(r.codeBlocks, 0);
  const s = r.doc.features[0] as { entities: Record<string, { type: string }> };
  assert.equal(Object.values(s.entities).filter(e => e.type === 'arc').length, 4, 'four rounded corners');
  assert.ok(r.dv < 0.005, `volume ${r.dv}`);
});

await test('top-level variables are read from the code (vectors, Hidden, modules and include skipped)', () => {
  const ps = scadParams(`include <BOSL2/std.scad>
/* [Size] */
width = 60; // [30:100]
size = [40, 30.5, 2];
outer = width + 2*wall; // uses wall before it is set: allowed in OpenSCAD, not in the variables list
label = "a;b";
round = true;
module m(r = 3) { inner = 5; cylinder(r = r); }
twice = 1; twice = 2;
/* [Hidden] */
wall = 2;
eps = 0.01;
$fn = 64;
z = size[2] + size.y;
top = 1;
/* [Shape] */
lip = top + width/2;
`);
  // Hidden: eps, z and wall are unused (outer was dropped); top comes along because lip uses it.
  assert.deepEqual(ps.map(p => `${p.name}=${p.expr}`), ['width=60', 'size_x=40', 'size_y=30,5', 'size_z=2', 'top=1', 'lip=top + width/2']);
});

await test('converted AI-style code gets its variables, and changing them gives the same model as OpenSCAD', async () => {
  const src = `// Mounting plate
/* [Size] */
width = 60;
depth = 40;
thickness = 4;
hole_r = 2.5;
corner_r = 3;
/* [Hidden] */
$fn = 48;

difference() {
  hull() for (x = [corner_r, width - corner_r], y = [corner_r, depth - corner_r]) translate([x, y, 0]) cylinder(r = corner_r, h = thickness);
  for (x = [8, 18]) translate([x, 8, -1]) cylinder(h = thickness + 2, r = hole_r);
}
translate([0, 0, thickness]) cube([10, depth, 7]);
`;
  const r = await scadToDoc(src, engine);
  assert.deepEqual(r.doc.params.map(p => p.name), ['width', 'depth', 'thickness', 'hole_r', 'corner_r']);
  const sks = r.doc.features.filter((f): f is SketchFeature => f.type === 'sketch');
  const exprs = sks.map(sk => sk.constraints.flatMap(c => ('expr' in c && c.expr ? [c.expr] : [])).sort());
  // The rounded plate is placed by its outer edges on the axes; the holes at fixed numbers.
  assert.deepEqual(exprs, [['corner_r', 'depth', 'width'], ['2*hole_r', '2*hole_r'], ['depth']], JSON.stringify(exprs));
  assert.deepEqual(r.doc.features.flatMap(f => (f.type === 'extrude' ? [f.depth] : [])), ['thickness', 'thickness + 2', '7']);
  assert.deepEqual(sks.map(s => s.offset), [undefined, '-1', 'thickness']);
  assert.equal(r.linked, 9);
  // Change the variables as in the variables dialog and compare with OpenSCAD's own result.
  const set: Record<string, string> = { width: '80', depth: '50', thickness: '6', hole_r: '2', corner_r: '5' };
  for (const p of r.doc.params) p.expr = set[p.name];
  const { vars } = evalParams(r.doc.params);
  for (const sk of sks) assert.ok(!syncSketchParams(sk, vars, solver).error, sk.name);
  const a = await mesh(src + Object.entries(set).map(([k, v]) => `${k} = ${v};`).join('\n') + '\n$fa = 1; $fs = 0.2;\n');
  const b = await mesh(buildModel(r.doc).code);
  const dv = Math.abs(a.vol - b.vol) / a.vol;
  const db = Math.max(...[0, 1, 2].flatMap(i => [Math.abs(a.min[i] - b.min[i]), Math.abs(a.max[i] - b.max[i])]));
  assert.ok(dv < 0.005 && db < 1e-3, `volume ${dv}, size ${db}`);
});

await test('products of variables: the code\'s own expression is kept, a built one is not', async () => {
  // The width is written in the code (m * z + 2 * wall): exact. The position is m*z + wall from two
  // translates, which one variable at a time looks like 20*m + 1,5*z + wall - 30: wrong as soon as
  // m and z both change, so it stays a number.
  const r = await scadToDoc('m = 1.5; z = 20; wall = 3;\ntranslate([m * z, 0, 0]) translate([wall, 0, 0]) cube([m * z + 2 * wall, 10, wall]);', engine);
  const sk = r.doc.features[0] as SketchFeature;
  const dims = sk.constraints.filter(c => c.type === 'distance') as { p1: string; dir: string; value: number; expr?: string }[];
  assert.deepEqual(dims.map(c => [c.p1 === 'O' ? 'at' : 'size', c.dir, c.value, c.expr]),
    [['size', 'h', 36, 'm * z + 2 * wall'], ['size', 'v', 10, undefined], ['at', 'h', 33, undefined]]);
  assert.equal(r.doc.features.find(f => f.type === 'extrude')!.depth, 'wall');
});

// tests/fixtures: public test models. tests/private (only exists locally, not published): own
// files.
const fixtureDirs = ['fixtures', 'private'].filter(d => existsSync(`${ROOT}/tests/${d}`));
for (const [dir, f] of fixtureDirs.flatMap(d => readdirSync(`${ROOT}/tests/${d}`).filter(f => f.endsWith('.scad')).map(f => [d, f]))) {
  await test(`file: ${dir}/${f}`, async () => {
    const r = await compare(readFileSync(`${ROOT}/tests/${dir}/${f}`, 'utf8'));
    console.log(`   ${f}: ${r.sketches} sketches, ${r.extrudes} extrudes, ${r.revolves} revolves, ${r.codeBlocks} code blocks, ${r.features} features, volume ±${(r.dv * 100).toFixed(2)} %, size ±${r.db.toFixed(3)} mm, ${Math.round(r.ms)} ms`);
    assert.ok(r.dv < 0.01, `the volume differs by ${(r.dv * 100).toFixed(2)} %`);
  });
}
console.log(`${n} conversion tests ok`);
