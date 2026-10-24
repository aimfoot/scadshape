// Tests for the code's problem list (diagnose.ts): merging, lines, follow-ups and the hints – the
// latter on tests/ai-mistakes/*.scad, typical mistakes of AI-written code run through the real
// OpenSCAD WASM. Each file's first line says what the hint must contain: // expect: …
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { setLang } from '../src/i18n';
import { diagnose, meshProblems, problemsForAi } from '../src/diagnose';
import { midAirStarts } from '../src/floating';
import { parseBinaryStl } from '../src/stl';
import { FONTS_CONF, fontsFor } from '../src/fonts';
import { lint } from '../src/lint';
import { applyFix } from '../src/fixes';
import { aiPrompt, codeFromChat, looksLikeScad } from '../src/aiprompt';
import { buildModel } from '../src/model3d';
import { EXAMPLES, buildExample } from '../src/examples/models';
setLang('en');

let n = 0;
const test = async (name: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log('ok', name); };

await test('the same warning thousands of times is one problem; undefined values after it are follow-ups', () => {
  const log = [
    ...Array(2496).fill('WARNING: Ignoring unknown function \'radians\' in file /in.scad, line 3'),
    ...Array(1248).fill('WARNING: undefined operation (number * undefined) in file /in.scad, line 9'),
    'WARNING: Unable to convert points[9] = [undef, undef] to a vec2 of numbers in file /in.scad, line 20',
    'Total rendering time: 0:00:00.100',
  ];
  const ps = diagnose(log, 'a = 1;\nb = 2;\nfunction inv(a) = tan(a) - radians(a);\n');
  assert.deepEqual(ps.map(p => [p.line, p.count, p.followUp]), [[3, 2496, false], [9, 1248, true], [20, 1, true]]);
  assert.match(ps[0].hint!, /has no radians\(\)\. Write x \* PI \/ 180/);
  const text = problemsForAi(ps, 'a = 1;\nb = 2;\nfunction inv(a) = tan(a) - radians(a);\n', 'OpenSCAD 2026.10');
  assert.match(text, /^My OpenSCAD code \(OpenSCAD 2026\.10, Manifold backend; libraries available: BOSL2, /);
  assert.match(text, /\nLine 3: WARNING: Ignoring unknown function 'radians' \(2496 times\)\n {4}function inv\(a\) = tan\(a\) - radians\(a\);\n/);
  assert.match(text, /\(plus 1249 follow-on warnings about undefined values\)/);
  assert.doesNotMatch(text, /Line 9/);
});

await test('an error inside a library is placed on the line that called it', () => {
  const ps = diagnose([
    'ERROR: Assertion \'is_vector(size, 3)\' failed: "',
    'TRACE: assignment to "checks" in file /libraries/BOSL2/shapes3d.scad, line 370',
    'TRACE: called by \'cuboid\' in file /in.scad, line 2',
    'Current top level object is empty.',
  ], 'include <BOSL2/std.scad>\ncuboid([10, 10], rounding = 30);\n');
  assert.deepEqual(ps.map(p => [p.severity, p.line]), [['error', 2]]);
});

await test('"the result is empty" alone gets its own hint; with other problems it is left out', () => {
  assert.match(diagnose(['Current top level object is empty.'], 'if (false) cube(1);')[0].hint!, /draws no body/);
  assert.equal(diagnose(['WARNING: Ignoring unknown module \'cuboid\' in file /in.scad, line 1', 'Current top level object is empty.'], 'cuboid(1);').length, 1);
});

await test('the checks raise no false alarms on correct code', () => {
  const correct = [
    'a = 30; cube([10 * cos(a), 10 * sin(a * 180 / PI / 50), tan(45) * 3]);', // degrees, or converted
    'r = 2 * PI * 10; rotate([0, 0, 45]) cube([r, 1, 1]);', // PI outside the trig
    'x = 7 % 3; y = 2 * 3; flag = false; if (!flag) cube(x + y);', // %, * and ! in expressions
    'function total(v, i = 0) = i < len(v) ? v[i] + total(v, i + 1) : 0; cube(total([1, 2]));',
    'for (i = [0:2]) let(x = i * 10) translate([x, 0, 0]) cube(5);',
    'pts = [for (i = [0:5]) let(a = i * 60) [cos(a), sin(a)] * 10]; polygon(pts);',
    'linear_extrude(2) text("Hi", font = "Liberation Sans:style=Bold"); translate([0, 20]) linear_extrude(2) text("x", font = "Orbitron");',
    '$fn = 96; color("red") cube(1); color("blue") translate([5, 0, 0]) cube(1);', // two colored parts is not an assembly yet
    '// rotate(PI) in a comment, and "sin(PI)" in a string\necho("sin(PI)"); cube(1);',
  ];
  for (const src of correct) assert.deepEqual(lint(src).map(p => p.hint), [], src);
  // The app's own code: the examples and the models built from them.
  const files = [...readdirSync(`${process.env.ROOT}/src/examples`).filter(f => f.endsWith('.scad')).map(f => `${process.env.ROOT}/src/examples/${f}`),
    ...readdirSync(`${process.env.ROOT}/tests/fixtures`).filter(f => f.endsWith('.scad')).map(f => `${process.env.ROOT}/tests/fixtures/${f}`)];
  for (const f of files) assert.deepEqual(lint(readFileSync(f, 'utf8')).map(p => `${p.line}: ${p.hint}`), [], f);
  for (const ex of EXAMPLES) assert.deepEqual(lint(buildModel(buildExample(ex.id)).code).map(p => p.hint), [], ex.id);
});

await test('fixes only where the change is clear, with the brackets the context needs', () => {
  const unknownFn = (name: string, src: string) => diagnose([`WARNING: Ignoring unknown function '${name}' in file /in.scad, line 1`], src)[0].fix;
  const fixed = (name: string, src: string) => { const f = unknownFn(name, src); return f ? applyFix(src, f) : null; };
  assert.equal(fixed('radians', 'x = cos(radians(a));'), 'x = cos(a);');
  assert.equal(fixed('radians', 'arc = r * radians(a + b);'), 'arc = r * (a + b) * PI / 180;');
  assert.equal(fixed('radians', 'k = 1 / radians(a);'), 'k = 1 / (a * PI / 180);');
  assert.equal(fixed('radians', 'v = [radians(a), sin(radians(b))];'), 'v = [a * PI / 180, sin(b)];');
  assert.equal(fixed('radians', 'x = cos(radians(a) / 2);'), null); // half of what? left to the user
  assert.equal(fixed('degrees', 'd = degrees(atan2(y, x)) + degrees(t);'), 'd = atan2(y, x) + t * 180 / PI;');
  assert.equal(fixed('deg2rad', 'echo(str("a", deg2rad(30)));'), 'echo(str("a", 30 * PI / 180));');
  // Library lines go after the other includes, or after the opening comment.
  const inc = (name: string, src: string) => applyFix(src, diagnose([`WARNING: Ignoring unknown module '${name}' in file /in.scad, line 3`], src)[0].fix!);
  assert.equal(inc('cuboid', '// Box\n// by AI\ncuboid(10);\n'), '// Box\n// by AI\ninclude <BOSL2/std.scad>\ncuboid(10);\n');
  assert.equal(inc('spur_gear', 'include <BOSL2/std.scad>\n$fn = 64;\nspur_gear(mod = 2, teeth = 9);'), 'include <BOSL2/std.scad>\ninclude <BOSL2/gears.scad>\n$fn = 64;\nspur_gear(mod = 2, teeth = 9);');
  assert.equal(inc('child', 'module m() child();\nmodule n() child(1);'), 'module m() children(0);\nmodule n() children(1);');
  assert.equal(diagnose(['WARNING: Ignoring unknown module \'widht_box\' in file /in.scad, line 2'], 'module width_box() cube(1);\nwidht_box();')[0].fix, undefined);
  // PI in angles: only where the angle is PI times something.
  const deg = (src: string) => { const f = lint(src).find(p => p.fix)?.fix; return f ? applyFix(src, f) : null; };
  assert.equal(deg('x = sin(PI / 2);'), 'x = sin(90);');
  assert.equal(deg('x = cos(-PI/4);'), 'x = cos(-45);');
  assert.equal(deg('x = sin(2 * PI * i / n);'), 'x = sin(2 * 180 * i / n);');
  assert.equal(deg('x = sin(PI / 7);'), 'x = sin(180 / 7);');
  assert.equal(deg('rotate(a = PI / 2, v = [1, 0, 0]) cube(1);'), 'rotate(a = 90, v = [1, 0, 0]) cube(1);');
  assert.equal(deg('rotate([PI / 2, 0, t * PI]) cube(1);'), 'rotate([90, 0, t * 180]) cube(1);');
  assert.equal(deg('x = sin(PI / 4 + a);'), null);
  assert.equal(deg('x = sin(sqrt(PI));'), null);
  assert.equal(deg('x = sin(PI * PI);'), null);
  assert.equal(deg('// one\n%  translate([1, 0, 0]) cube(1);'), '// one\ntranslate([1, 0, 0]) cube(1);');
});

await test('the code is picked out of an AI chat answer', () => {
  const answer = 'Here is a box:\n\n```openscad\nwidth = 40;\ncube([width, 20, 10]);\n```\n\nAnd to print it:\n```bash\nopenscad -o box.stl box.scad\n```\nEnjoy!';
  assert.equal(codeFromChat(answer), 'width = 40;\ncube([width, 20, 10]);\n');
  // Without a language: the longest block; without fences: the text itself.
  assert.equal(codeFromChat('```\na=1;\n```\ntext\n```\ncube(10);\nsphere(5);\n```'), 'cube(10);\nsphere(5);\n');
  assert.equal(codeFromChat('  cube(10);\n'), 'cube(10);\n');
  assert.ok(looksLikeScad('cube(10);') && !looksLikeScad('https://example.com/model') && !looksLikeScad('Sure! Here is your model.'));
});

await test('the prompt tells the AI what the app runs', () => {
  const p = aiPrompt({ version: 'OpenSCAD 2026.10.15', bed: { w: 180, d: 180, h: 180 }, printer: 'Bambu Lab A1 mini' });
  assert.match(p, /scadshape \(OpenSCAD 2026\.10\.15, Manifold backend\)/);
  assert.match(p, /Libraries available: BOSL2, Round-Anything, dotSCAD, gridfinity-rebuilt-openscad, MCAD \(/);
  assert.match(p, /Fonts for text\(\): Liberation Sans, Liberation Serif, Liberation Mono, Allerta Stencil, Bebas Neue, Pacifico, Orbitron\./);
  assert.match(p, /print on Bambu Lab A1 mini \(180 × 180 × 180 mm\)/);
  assert.match(p, /There is no radians\(\)/);
  assert.match(p, /What I want: $/);
  assert.match(aiPrompt({ version: 'OpenSCAD', bed: { w: 200, d: 150, h: 100 }, printer: null }), /print on 200 × 150 × 100 mm:/);
});

// ---- The corpus, through the real OpenSCAD ---------------------------------------------------

const ROOT = process.env.ROOT!;
const wasmBinary = readFileSync(ROOT + '/vendor/openscad/openscad.wasm');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { default: OpenSCAD } = (await import(ROOT + '/vendor/openscad/openscad.js')) as { default: (o: object) => Promise<any> };
const libFiles: [string, Buffer][] = [];
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.scad')) libFiles.push([relative(ROOT + '/vendor/libraries', p), readFileSync(p)]); } };
walk(ROOT + '/vendor/libraries');

/** OpenSCAD's log for the code, set up like the app's worker (/in.scad, libraries, fonts on demand). */
async function log(src: string) {
  return (await run(src)).log;
}
async function run(src: string) {
  const out: string[] = [];
  const inst = await OpenSCAD({ noInitialRun: true, wasmBinary, print: (s: string) => out.push(s), printErr: (s: string) => out.push(s),
    preRun: [(m: { ENV: Record<string, string> }) => { m.ENV.OPENSCADPATH = '/libraries'; m.ENV.FONTCONFIG_FILE = '/fonts/fonts.conf'; }] });
  for (const [p, b] of libFiles) { inst.FS.mkdirTree('/libraries/' + p.slice(0, p.lastIndexOf('/'))); inst.FS.writeFile('/libraries/' + p, b); }
  inst.FS.mkdirTree('/fonts');
  for (const f of fontsFor(src)) inst.FS.writeFile(`/fonts/${f}`, readFileSync(ROOT + '/public/fonts/' + f));
  inst.FS.writeFile('/fonts/fonts.conf', FONTS_CONF);
  inst.FS.writeFile('/in.scad', src);
  try { inst.callMain(['/in.scad', '-o', '/out.stl', '--export-format=binstl', '--backend=manifold']); } catch (e) { out.push(String(e)); }
  let stl: Uint8Array | null = null;
  try { stl = inst.FS.readFile('/out.stl') as Uint8Array; } catch { /* nothing rendered */ }
  return { log: out, stl };
}
/** Triangles and size of a binary STL (or null). */
function shape(stl: Uint8Array | null) {
  if (!stl || stl.length < 84) return null;
  const v = new DataView(stl.buffer, stl.byteOffset, stl.byteLength), n = v.getUint32(80, true);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) { const x = v.getFloat32(84 + 50 * i + 12 + 4 * k, true); min[k % 3] = Math.min(min[k % 3], x); max[k % 3] = Math.max(max[k % 3], x); }
  return { n, size: [0, 1, 2].map(i => Math.round((max[i] - min[i]) * 1000) / 1000) };
}

await test('font names with an alias render as the app\'s font (Arial Bold is Liberation Sans Bold)', async () => {
  const text = (font: string) => `linear_extrude(2) text("Hej 123", size = 10, font = "${font}");`;
  for (const [asked, real] of [['Arial:style=Bold', 'Liberation Sans:style=Bold'], ['Helvetica', 'Liberation Sans'], ['Times New Roman', 'Liberation Serif'], ['Courier New', 'Liberation Mono']]) {
    const a = shape((await run(text(asked))).stl), b = shape((await run(text(real))).stl);
    assert.ok(a && b, asked);
    assert.deepEqual(a, b, `${asked} vs ${real}`);
  }
  // …and differ from each other, so the alias is not just the default font.
  assert.notDeepEqual(shape((await run(text('Times New Roman'))).stl), shape((await run(text('Arial'))).stl));
  assert.notDeepEqual(shape((await run(text('Arial:style=Bold'))).stl), shape((await run(text('Arial'))).stl));
});

await test('MCAD is in the app: its involute gear renders without problems', async () => {
  const src = 'use <MCAD/involute_gears.scad>\ngear(number_of_teeth = 20, circular_pitch = 200, gear_thickness = 5, rim_thickness = 5, hub_thickness = 8, bore_diameter = 5);\n';
  const r = await run(src);
  const s = shape(r.stl);
  assert.ok(s && s.n > 500, JSON.stringify(s));
  assert.deepEqual(diagnose(r.log, src).filter(p => p.severity !== 'note').map(p => p.message), []);
});

/** All problems the app shows: OpenSCAD's log, the checks of the code, and of the rendered model. */
async function problems(src: string) {
  const r = await run(src);
  return [...diagnose(r.log, src), ...(r.stl ? meshProblems(parseBinaryStl(r.stl.slice().buffer).positions) : [])];
}
const floating = async (src: string) => {
  const stl = (await run(src)).stl;
  assert.ok(stl, src);
  return midAirStarts(parseBinaryStl(stl.slice().buffer).positions).map(p => `z ${Math.round(p.min[2] * 100) / 100}${p.count > 1 ? ` ×${p.count}` : ''}`);
};

await test('places that start in mid-air are found; on the bed, on another part, overhangs and bridges are not', async () => {
  assert.deepEqual(await floating('cube(10); translate([20, 0, 5]) cube(4);'), ['z 5']);
  assert.deepEqual(await floating('cube(10, center = true); translate([20, 0, 0]) cube(4, center = true);'), ['z -2']);
  assert.deepEqual(await floating('cube(10); translate([30, 0, 10]) sphere(5, $fn = 48);'), ['z 5.01']); // a round bottom (OpenSCAD's lowest ring, not the pole)
  // Inside one body: ridges hanging from the ceiling of a cavity open at the bottom (an AI's "box").
  assert.deepEqual(await floating('difference() { cube(40); translate([5, 5, -1]) cube([30, 30, 36]); } for (i = [0:3]) translate([10 + i * 6, 18, 28]) cube([2, 2, 8]);'), ['z 28 ×4']);
  const fine = [
    'cube([10, 10, 20]); translate([-10, 0, 20]) cube([30, 10, 3]);', // a T: the arms overhang, joined to the stem
    'difference() { cube([60, 20, 20]); translate([5, -1, 0]) cube([50, 22, 15]); }', // a bridge over a gap
    'difference() { cube(20); translate([-1, 10, 10]) rotate([0, 90, 0]) cylinder(d = 6, h = 22); }', // a hole lying down
    'difference() { cube(20); translate([10, 10, -1]) cylinder(d = 6, h = 8); }', // a blind hole from below
    'cube(10); translate([20, 0, 0]) cylinder(r = 3, h = 8);', // side by side
    'cube([60, 20, 2]); translate([5, 5, 2]) linear_extrude(1) text("Hi i!", size = 8);', // letters standing on a plate
    'cube([20, 20, 10]); translate([0, 0, 10]) cube([20, 20, 2]);', // a lid lying exactly on a box
    'translate([0, 0, -5]) cube(10); translate([30, 0, 0]) sphere(5);', // below z = 0: the bottom of the model counts
    'difference() { cube(20, center = true); sphere(12); }', // one body with holes
    'difference() { cube(20); translate([10, 10, 10]) sphere(4); }', // a closed void inside: its own shell, facing inwards
  ];
  for (const src of fine) assert.deepEqual(await floating(src), [], src);
  for (const ex of EXAMPLES) assert.deepEqual(await floating(buildModel(buildExample(ex.id)).code), [], ex.id);
  // Runs after every render: fast also on a heavy model (here ~300k triangles in two bodies).
  const heavy = parseBinaryStl((await run('$fn = 360; sphere(20); translate([60, 0, 0]) sphere(20);')).stl!.slice().buffer);
  const t0 = performance.now();
  assert.deepEqual(midAirStarts(heavy.positions), []);
  console.log(`  floating check: ${heavy.triangles} triangles in ${Math.round(performance.now() - t0)} ms`);
  // snap_box's dome button pokes 1 mm out under its lid, so the lid's bottom is z = -1 and the box,
  // from z = 0, really starts 1 mm up in the air.
  const expected: Record<string, string[]> = { 'snap_box.scad': ['z 0'] };
  for (const f of readdirSync(`${ROOT}/tests/fixtures`).filter(f => f.endsWith('.scad')))
    assert.deepEqual(await floating(readFileSync(`${ROOT}/tests/fixtures/${f}`, 'utf8')), expected[f] ?? [], f);
});

const dir = `${ROOT}/tests/ai-mistakes`;
for (const f of readdirSync(dir).filter(x => x.endsWith('.scad')).sort()) {
  await test(`ai-mistakes/${f}`, async () => {
    const src = readFileSync(`${dir}/${f}`, 'utf8');
    const expect = /^\/\/ expect: (.+)$/m.exec(src)![1];
    const ps = await problems(src);    const main = ps.filter(p => !p.followUp);
    assert.ok(main.length, 'no problem found');
    const hit = main.find(p => p.hint?.includes(expect));
    assert.ok(hit, `${main.map(p => `${p.line}: ${p.message} → ${p.hint}`).join(' | ')}`);
    // A problem of the rendered model (meshProblems) has no line of code.
    assert.ok(hit.line !== null || hit.mesh, `no line: ${hit.message}`);
    // // fix: the fixed line(s) must contain this, and after the fix the problem is gone and it renders.
    // Without it there must be no fix: a guess is left to the user.
    const fix = /^\/\/ fix: (.+)$/m.exec(src)?.[1];
    if (!fix) return assert.equal(hit.fix?.preview, undefined);
    assert.ok(hit.fix?.preview.includes(fix), `fix: ${hit.fix?.preview}`);
    const fixed = applyFix(src, hit.fix!);
    const same = (ps: typeof main) => ps.filter(p => !p.followUp && p.hint?.includes(expect)).length;
    assert.ok(same(await problems(fixed)) < same(main), `still there after the fix:\n${fixed}`);
    assert.ok(shape((await run(fixed)).stl), `nothing rendered after the fix:\n${fixed}`);
  });
}
console.log(`${n} diagnose tests ok`);
