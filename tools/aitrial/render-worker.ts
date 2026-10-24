// One OpenSCAD run in the app's WASM build, set up like the app's worker (/in.scad, libraries,
// fonts on demand). Runs in a worker thread so the caller can stop code that never finishes.
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FONTS_CONF, fontsFor } from '../../src/fonts';

const { root, src, out, args } = workerData as { root: string; src: string; out: string; args: string[] };
const libFiles: [string, Buffer][] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.scad')) libFiles.push([relative(root + '/vendor/libraries', p), readFileSync(p)]);
  }
};
walk(root + '/vendor/libraries');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { default: OpenSCAD } = (await import(root + '/vendor/openscad/openscad.js')) as { default: (o: object) => Promise<any> };
const log: string[] = [];
const inst = await OpenSCAD({ noInitialRun: true, wasmBinary: readFileSync(root + '/vendor/openscad/openscad.wasm'),
  print: (s: string) => log.push(s), printErr: (s: string) => log.push(s),
  preRun: [(m: { ENV: Record<string, string> }) => { m.ENV.OPENSCADPATH = '/libraries'; m.ENV.FONTCONFIG_FILE = '/fonts/fonts.conf'; }] });
for (const [p, b] of libFiles) { inst.FS.mkdirTree('/libraries/' + p.slice(0, p.lastIndexOf('/'))); inst.FS.writeFile('/libraries/' + p, b); }
inst.FS.mkdirTree('/fonts');
for (const f of fontsFor(src)) inst.FS.writeFile(`/fonts/${f}`, readFileSync(root + '/public/fonts/' + f));
inst.FS.writeFile('/fonts/fonts.conf', FONTS_CONF);
inst.FS.writeFile('/in.scad', src);
let rc = -1;
try { rc = inst.callMain(['/in.scad', '-o', out, ...args]); } catch (e) { log.push(String(e)); }
let data: Uint8Array | null = null;
try { data = inst.FS.readFile(out) as Uint8Array; } catch { /* nothing written */ }
parentPort!.postMessage({ rc, log, data });
