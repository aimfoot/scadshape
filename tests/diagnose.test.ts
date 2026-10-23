// Tests for the code's problem list (diagnose.ts): merging, lines, follow-ups and the hints – the
// latter on tests/ai-mistakes/*.scad, typical mistakes of AI-written code run through the real
// OpenSCAD WASM. Each file's first line says what the hint must contain: // expect: …
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { setLang } from '../src/i18n';
import { diagnose, problemsForAi } from '../src/diagnose';
import { fontsFor } from '../src/fonts';
import { lint } from '../src/lint';
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
  const out: string[] = [];
  const inst = await OpenSCAD({ noInitialRun: true, wasmBinary, print: (s: string) => out.push(s), printErr: (s: string) => out.push(s),
    preRun: [(m: { ENV: Record<string, string> }) => { m.ENV.OPENSCADPATH = '/libraries'; m.ENV.FONTCONFIG_FILE = '/fonts/fonts.conf'; }] });
  for (const [p, b] of libFiles) { inst.FS.mkdirTree('/libraries/' + p.slice(0, p.lastIndexOf('/'))); inst.FS.writeFile('/libraries/' + p, b); }
  inst.FS.mkdirTree('/fonts');
  for (const f of fontsFor(src)) inst.FS.writeFile(`/fonts/${f}`, readFileSync(ROOT + '/public/fonts/' + f));
  inst.FS.writeFile('/fonts/fonts.conf', '<?xml version="1.0"?>\n<fontconfig><dir>/fonts</dir></fontconfig>\n');
  inst.FS.writeFile('/in.scad', src);
  try { inst.callMain(['/in.scad', '-o', '/out.stl', '--export-format=binstl', '--backend=manifold']); } catch (e) { out.push(String(e)); }
  return out;
}

const dir = `${ROOT}/tests/ai-mistakes`;
for (const f of readdirSync(dir).filter(x => x.endsWith('.scad')).sort()) {
  await test(`ai-mistakes/${f}`, async () => {
    const src = readFileSync(`${dir}/${f}`, 'utf8');
    const expect = /^\/\/ expect: (.+)$/m.exec(src)![1];
    const ps = diagnose(await log(src), src);
    const main = ps.filter(p => !p.followUp);
    assert.ok(main.length, 'no problem found');
    const hit = main.find(p => p.hint?.includes(expect));
    assert.ok(hit, `${main.map(p => `${p.line}: ${p.message} → ${p.hint}`).join(' | ')}`);
    assert.ok(hit.line !== null, `no line: ${hit.message}`);
  });
}
console.log(`${n} diagnose tests ok`);
