// Diagnos: är OpenSCAD långsamt för att workern hamnar på en liten CPU-kärna?
// Jämför samma arbete på huvudtråden och i en worker. Resultatet skickas till data/client.jsonl.

import { remoteLog, installErrorReporting } from './remote';
import plattan from './examples/plattan.scad';

installErrorReporting();

const out = document.querySelector('#out') as HTMLElement;
const btn = document.querySelector('#run') as HTMLButtonElement;
const line = (s: string) => {
  out.textContent += s + '\n';
};

// Ren JS-belastning (samma kod körs i workern via Blob-URL).
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

// OpenSCAD-rendering av plattan; samma kod används på huvudtråden och i workern.
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
    line('JS-loop, huvudtråd …');
    await new Promise(r => setTimeout(r, 50));
    res.jsMain = [cpu().ms, cpu().ms, cpu().ms].map(Math.round);
    line(`  ${(res.jsMain as number[]).join(', ')} ms`);

    line('JS-loop, worker …');
    res.jsWorker = await inWorker<number[]>(`${CPU_SRC}; postMessage([cpu().ms, cpu().ms, cpu().ms].map(Math.round));`);
    line(`  ${(res.jsWorker as number[]).join(', ')} ms`);

    line('JS-loop, 4 workers samtidigt …');
    res.jsWorker4 = await Promise.all(
      [0, 1, 2, 3].map(() => inWorker<number>(`${CPU_SRC}; postMessage(Math.round(cpu().ms));`)),
    );
    line(`  ${(res.jsWorker4 as number[]).join(', ')} ms`);

    line('OpenSCAD plattan, worker …');
    res.scadWorker = await inWorker<number[]>(
      `${SCAD_SRC}; scad(${JSON.stringify(base)}, ${JSON.stringify(plattan)}, 3).then(t => postMessage(t));`,
    );
    line(`  ${(res.scadWorker as number[]).join(', ')} ms`);

    line('OpenSCAD plattan, huvudtråd (sidan fryser en stund) …');
    await new Promise(r => setTimeout(r, 50));
    res.scadMain = await scadMain(base, plattan, 3);
    line(`  ${(res.scadMain as number[]).join(', ')} ms`);

    line('\nKlart – skickat till servern.');
  } catch (e) {
    res.error = String(e);
    line(`Fel: ${e}`);
  }
  remoteLog('diag', res);
  btn.disabled = false;
}

btn.addEventListener('click', run);
