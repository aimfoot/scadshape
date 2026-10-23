// Diagnostics: is OpenSCAD slow because the worker ends up on a small CPU core? Compares the same
// work on the main thread and in a worker. The result is sent to data/client.jsonl.

import { remoteLog, installErrorReporting } from './remote';
import plate from './examples/plate.scad';

installErrorReporting();

const out = document.querySelector('#out') as HTMLElement;
const btn = document.querySelector('#run') as HTMLButtonElement;
const line = (s: string) => {
  out.textContent += s + '\n';
};

// Pure JS load (the same code runs in the worker via a Blob URL).
const CPU_SRC = `function cpu() {
  const t0 = performance.now();
  let x = 0;
  for (let i = 0; i < 3e7; i++) x += Math.sqrt(i) * 1.0000001;
  return { ms: performance.now() - t0, x };
}`;
// eslint-disable-next-line no-new-func
const cpu = new Function(`${CPU_SRC}; return cpu();`) as () => { ms: number };

function inWorker<T>(body: string): Promise<T> {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
  const w = new Worker(url, { type: 'module' });
  return new Promise<T>((resolve, reject) => {
    w.onmessage = e => (w.terminate(), URL.revokeObjectURL(url), resolve(e.data));
    w.onerror = e => (w.terminate(), reject(new Error(e.message)));
  });
}

const base = new URL('./openscad/', location.href).href;

// OpenSCAD rendering of the plate; the same code is used on the main thread and in the worker.
const SCAD_SRC = `async function scad(base, src, runs) {
  const { default: OpenSCAD } = await import(base + 'openscad.js');
  const module = await WebAssembly.compileStreaming(fetch(base + 'openscad.wasm'));
  const times = [];
  for (let i = 0; i < runs; i++) {
    const inst = await OpenSCAD({ noInitialRun: true, print() {}, printErr() {},
      instantiateWasm(imports, done) { WebAssembly.instantiate(module, imports).then(x => done(x, module)); return {}; } });
    inst.FS.writeFile('/in.scad', src);
    const t0 = performance.now();
    inst.callMain(['/in.scad', '-o', '/out.stl', '--export-format=binstl', '--backend=manifold']);
    times.push(Math.round(performance.now() - t0));
  }
  return times;
}`;
// eslint-disable-next-line no-new-func
const scadMain = new Function('base', 'src', 'runs', `${SCAD_SRC}; return scad(base, src, runs);`) as (
  b: string, s: string, r: number,
) => Promise<number[]>;

async function run() {
  btn.disabled = true;
  out.textContent = '';
  const res: Record<string, unknown> = { cores: navigator.hardwareConcurrency };
  try {
    line('JS loop, main thread …');
    await new Promise(r => setTimeout(r, 50));
    res.jsMain = [cpu().ms, cpu().ms, cpu().ms].map(Math.round);
    line(`  ${(res.jsMain as number[]).join(', ')} ms`);

    line('JS-loop, worker …');
    res.jsWorker = await inWorker<number[]>(`${CPU_SRC}; postMessage([cpu().ms, cpu().ms, cpu().ms].map(Math.round));`);
    line(`  ${(res.jsWorker as number[]).join(', ')} ms`);

    line('JS loop, 4 workers at once …');
    res.jsWorker4 = await Promise.all(
      [0, 1, 2, 3].map(() => inWorker<number>(`${CPU_SRC}; postMessage(Math.round(cpu().ms));`)),
    );
    line(`  ${(res.jsWorker4 as number[]).join(', ')} ms`);

    line('OpenSCAD plate, worker …');
    res.scadWorker = await inWorker<number[]>(
      `${SCAD_SRC}; scad(${JSON.stringify(base)}, ${JSON.stringify(plate)}, 3).then(t => postMessage(t));`,
    );
    line(`  ${(res.scadWorker as number[]).join(', ')} ms`);

    line('OpenSCAD plate, main thread (the page freezes for a while) …');
    await new Promise(r => setTimeout(r, 50));
    res.scadMain = await scadMain(base, plate, 3);
    line(`  ${(res.scadMain as number[]).join(', ')} ms`);

    line('\nDone – sent to the server.');
  } catch (e) {
    res.error = String(e);
    line(`Error: ${e}`);
  }
  remoteLog('diag', res);
  btn.disabled = false;
}

btn.addEventListener('click', run);
