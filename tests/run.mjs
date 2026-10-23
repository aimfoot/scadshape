// Build and run the tests: node tests/run.mjs  (scad files for OpenSCAD end up in tests/out/)
import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const root = new URL('..', import.meta.url).pathname;
const out = root + 'tests/out';
mkdirSync(out, { recursive: true });
const env = { ...process.env, OUT: out, TESTDIR: root + 'tests', ROOT: root, WASM: root + 'node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm' };
for (const name of ['sketch', 'solver', 'projects', 'model', 'convert', 'measure', 'svg', 'examples']) {
  await esbuild.build({ entryPoints: [`${root}tests/${name}.test.ts`], bundle: true, platform: 'node', format: 'esm', outfile: `${out}/${name}.test.mjs`, logLevel: 'warning',
    define: { __APP_VERSION__: '""', __DEV_TOOLS__: 'false' } }); // like build.mjs (src/globals.d.ts)
  execFileSync('node', [`${out}/${name}.test.mjs`], { stdio: 'inherit', env });
}
