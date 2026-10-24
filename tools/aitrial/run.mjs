// Build and run the AI trial (trial.ts): node tools/aitrial/run.mjs [request numbers …]
// Environment: MODEL (default haiku), ROUNDS (3), PARALLEL (4), OUT (default tools/aitrial/out),
// REQUESTS (default tools/aitrial/requests.json), ASK_MS (600000, the limit for one chat answer).
// Uses the claude CLI with the given model, so it costs usage.
import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const root = new URL('../..', import.meta.url).pathname;
const out = process.env.OUT ?? `${root}tools/aitrial/out`;
const build = `${out}/build`;
mkdirSync(build, { recursive: true });
for (const name of ['trial', 'render-worker'])
  await esbuild.build({ entryPoints: [`${root}tools/aitrial/${name}.ts`], bundle: true, platform: 'node', format: 'esm', outfile: `${build}/${name}.mjs`, logLevel: 'warning',
    define: { __APP_VERSION__: '""', __DEV_TOOLS__: 'false' } });
execFileSync('node', [`${build}/trial.mjs`, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ROOT: root, OUT: out, WORKER: `${build}/render-worker.mjs` } });
