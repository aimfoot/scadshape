// Mät OpenSCAD-WASM (samma webb-build som appen) i Node.
//   node tools/bench-node.mjs <fil.scad> [manifold|cgal] [binstl|off]
import { readFileSync } from 'node:fs';
const [scadPath, backend = 'manifold', fmt = 'binstl'] = process.argv.slice(2);
const { default: OpenSCAD } = await import('../vendor/openscad/openscad.js');
const wasmBinary = readFileSync(new URL('../vendor/openscad/openscad.wasm', import.meta.url));
const src = readFileSync(scadPath, 'utf8');
const out = '/out.' + (fmt === 'binstl' ? 'stl' : fmt);
for (let i = 0; i < 3; i++) {
  const t0 = performance.now();
  const log = [];
  const inst = await OpenSCAD({ noInitialRun: true, wasmBinary, print: s => log.push(s), printErr: s => log.push(s) });
  const t1 = performance.now();
  inst.FS.writeFile('/in.scad', src);
  let rc;
  try { rc = inst.callMain(['/in.scad', '-o', out, '--export-format=' + fmt, `--backend=${backend}`]); }
  catch (e) { rc = e?.status ?? String(e); }
  const t2 = performance.now();
  let size = 0; try { size = inst.FS.readFile(out).length; } catch {}
  console.log(`körning ${i}: init ${(t1 - t0).toFixed(0)} ms, render ${(t2 - t1).toFixed(0)} ms, rc=${rc}, ut=${size} B${fmt === 'binstl' ? ', tri=' + (size - 84) / 50 : ''}`);
  if (i === 0 && rc !== 0) console.log(log.join('\n'));
}
