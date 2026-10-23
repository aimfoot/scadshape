// The example models (src/examples/models.ts): fully defined sketches, build without errors, render
// in OpenSCAD, and a changed variable changes the model – in both languages.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLang } from '../src/i18n';
import { EXAMPLES, buildExample } from '../src/examples/models';
import { fontsFor } from '../src/fonts';
import { buildModel } from '../src/model3d';
import { evalParams } from '../src/params';
import { syncSketchParams } from '../src/paramsync';
import { loadSolver } from '../src/sketch/solver';
import { parseBinaryStl } from '../src/stl';
import type { SketchFeature } from '../src/features/common';

let n = 0;
const test = async (name: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log('ok', name); };
const solver = await loadSolver(process.env.WASM);
const wasmBinary = readFileSync(process.env.ROOT + '/vendor/openscad/openscad.wasm');
const { default: OpenSCAD } = (await import(process.env.ROOT + '/vendor/openscad/openscad.js')) as { default: (o: object) => Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Render and return the size (bounding box) and volume. */
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
  const rc = inst.callMain(['/in.scad', '-o', '/out.stl', '--export-format=binstl', '--backend=manifold']);
  if (rc !== 0) throw new Error('OpenSCAD: ' + log.filter(l => /ERROR|WARNING/.test(l)).join('\n'));
  const p = parseBinaryStl(inst.FS.readFile('/out.stl').slice().buffer).positions;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) { min[i % 3] = Math.min(min[i % 3], p[i]); max[i % 3] = Math.max(max[i % 3], p[i]); }
  let vol = 0;
  for (let i = 0; i < p.length; i += 9) vol += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
  return { size: max.map((v, i) => v - min[i]), triangles: p.length / 9, vol };
}

/** Change the first variable (×1.5) and sync the sketches' dimensions, as when changing them under Variables. */
function scaleFirstParam(doc: ReturnType<typeof buildExample>) {
  doc.params[0].expr = String(Number(doc.params[0].expr) * 1.5);
  const vars = evalParams(doc.params).vars;
  for (const f of doc.features) if (f.type === 'sketch') {
    const r = syncSketchParams(f as SketchFeature, vars, solver);
    assert.ok(!r.error, r.error);
  }
}

for (const lang of ['sv', 'en'] as const) {
  setLang(lang);
  for (const ex of EXAMPLES) {
    await test(`example ${ex.id} (${lang})`, async () => {
      const doc = buildExample(ex.id);
      for (const f of doc.features) if (f.type === 'sketch') {
        const r = solver.solve(f as SketchFeature);
        assert.ok(r.ok, `${ex.id}/${f.name}: ${JSON.stringify(r)}`);
        assert.equal(r.dof, 0, `${ex.id}/${f.name}: should be fully defined`);
      }
      const m = buildModel(doc);
      assert.equal(m.errors.size, 0, [...m.errors.values()].join('; '));
      assert.ok(m.solids > 0);
      const a = await render(m.code);
      assert.ok(a.triangles > 12, `${ex.id}: ${a.triangles} triangles`);
      if (ex.id === 'plate') {
        // Two through M4 holes (Ø 4.5, countersink Ø 8.8): more than 2 × π·2.25²·4 ≈ 127 mm³
        // removed from the plate.
        const solid = 70 * 30 * 4 - (4 - Math.PI) * 5 * 5 * 4; // rounded corners r 5
        assert.ok(solid - a.vol > 127, `${ex.id}: the holes only remove ${(solid - a.vol).toFixed(1)} mm³`);
      }
      // Larger first variable → larger model (width/length/diameter).
      scaleFirstParam(doc);
      const m2 = buildModel(doc);
      assert.equal(m2.errors.size, 0, [...m2.errors.values()].join('; '));
      const b = await render(m2.code);
      assert.ok(Math.max(...b.size) > Math.max(...a.size) + 1, `${ex.id}: ${a.size} → ${b.size}`);
      if (lang === 'sv') console.log(`   ${ex.id}: ${a.size.map(v => v.toFixed(1)).join(' × ')} mm → ${b.size.map(v => v.toFixed(1)).join(' × ')} mm, ${doc.features.length} features`);
    });
  }
}
console.log(`${n} example tests ok`);
