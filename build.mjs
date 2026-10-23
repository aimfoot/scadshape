// Build scadshape into dist/ (served directly by serve.py – rebuilding publishes immediately).
// node build.mjs            build once
// node build.mjs --watch    rebuild on changes
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = new URL('.', import.meta.url).pathname;
// --out <dir>: build somewhere else (e.g. dist-next to test without publishing).
const outArg = process.argv.indexOf('--out');
const dist = outArg > 0 ? join(root, process.argv[outArg + 1]) : join(root, 'dist');
const watch = process.argv.includes('--watch');

// Empty dist/ but keep the directory itself (the service bind-mounts it).
mkdirSync(dist, { recursive: true });
for (const name of readdirSync(dist)) rmSync(join(dist, name), { recursive: true, force: true });
cpSync(join(root, 'public'), dist, { recursive: true });
cpSync(join(root, 'vendor/openscad'), join(dist, 'openscad'), { recursive: true });
cpSync(join(root, 'node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm'), join(dist, 'planegcs.wasm'));

// Licenstexter ("Om scadshape", src/licenses.ts): vendor/licenses (tools/licenses.sh) + beroendenas LICENSE.
cpSync(join(root, 'vendor/licenses'), join(dist, 'licenses'), { recursive: true });
cpSync(join(root, 'node_modules/three/LICENSE'), join(dist, 'licenses/three.txt'));
cpSync(join(root, 'node_modules/@salusoft89/planegcs/LICENSE'), join(dist, 'licenses/planegcs.txt'));
for (const lib of readdirSync(join(root, 'vendor/libraries')))
  cpSync(join(root, 'vendor/libraries', lib, 'LICENSE'), join(dist, 'licenses', `lib-${lib}.txt`));

// OpenSCAD libraries (vendor/libraries/<name>/) → dist/libs/<name>.json { "<name>/file.scad": text,
// … }; the worker only fetches them when the code uses them (src/libs.ts).
mkdirSync(join(dist, 'libs'), { recursive: true });
for (const lib of readdirSync(join(root, 'vendor/libraries'))) {
  const files = {};
  const walk = rel => {
    for (const name of readdirSync(join(root, 'vendor/libraries', rel))) {
      const r = `${rel}/${name}`;
      if (statSync(join(root, 'vendor/libraries', r)).isDirectory()) walk(r);
      else if (/\.scad$|^LICENSE/.test(name)) files[r] = readFileSync(join(root, 'vendor/libraries', r), 'utf8');
    }
  };
  walk(lib);
  writeFileSync(join(dist, 'libs', `${lib}.json`), JSON.stringify(files));
}

// Precompress large files; serve.py sends .gz when the browser supports it.
function precompress(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) precompress(p);
    else if (/\.(js|wasm|css|html|json)$/.test(name) && statSync(p).size > 8192)
      writeFileSync(p + '.gz', gzipSync(readFileSync(p), { level: constants.Z_BEST_COMPRESSION }));
  }
}

/** Service worker with a list of the app's files and a hash of the content (new hash = new version). */
function writeServiceWorker(dir) {
  const files = [];
  const walk = sub => {
    for (const name of readdirSync(join(dir, sub)).sort()) {
      const rel = sub ? `${sub}/${name}` : name;
      if (statSync(join(dir, rel)).isDirectory()) walk(rel);
      else if (!/\.gz$|^diag\.|^sw\.js$|VERSION$/.test(name) && rel !== 'diag.html') files.push(rel);
    }
  };
  walk('');
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update(readFileSync(join(dir, f)));
  const list = ['./', ...files.filter(f => f !== 'index.html')];
  const sw = readFileSync(join(root, 'src/sw.template.js'), 'utf8')
    .replace('__VERSION__', hash.digest('hex').slice(0, 12))
    .replace('__FILES__', JSON.stringify(list));
  writeFileSync(join(dir, 'sw.js'), sw);
}

const options = {
  entryPoints: { main: 'src/main.ts', 'scad.worker': 'src/scad.worker.ts', diag: 'src/diag.ts' },
  outdir: dist,
  bundle: true,
  format: 'esm',
  target: ['chrome120'],
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  loader: { '.scad': 'text' },
  // android/build.sh sets SCADSHAPE_VERSION: the app build, without developer tools
  // (src/globals.d.ts).
  define: { __APP_VERSION__: JSON.stringify(process.env.SCADSHAPE_VERSION ?? ''), __DEV_TOOLS__: String(!process.env.SCADSHAPE_VERSION) },
  external: ['node:*'], // planegcs loads Node modules only in Node
  logLevel: 'info',
  plugins: [{ name: 'gz', setup: b => b.onEnd(r => r.errors.length || (writeServiceWorker(dist), precompress(dist))) }],
};

if (watch) await (await esbuild.context(options)).watch();
else await esbuild.build(options);
