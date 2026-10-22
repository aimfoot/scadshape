// Web Worker som kör OpenSCAD (WASM, Manifold-backend).
// wasm-modulen kompileras en gång; varje rendering får en ny, ren instans
// (OpenSCADs main() är inte gjord för att köras flera gånger i samma process).

import { EXT, type WorkerRequest, type WorkerMessage } from './scad';

interface WorkerScope {
  postMessage(msg: WorkerMessage, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
}
const ctx = self as unknown as WorkerScope;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenSCADFactory = (opts: Record<string, unknown>) => Promise<any>;

const base = new URL('./openscad/', import.meta.url);
let ready: Promise<{ module: WebAssembly.Module; factory: OpenSCADFactory }> | null = null;

function load() {
  ready ??= (async () => {
    const t0 = performance.now();
    const wasmUrl = new URL('openscad.wasm', base);
    const compile = WebAssembly.compileStreaming(fetch(wasmUrl)).catch(async () =>
      // Fel MIME-typ eller liknande: kompilera från buffer i stället.
      WebAssembly.compile(await (await fetch(wasmUrl)).arrayBuffer()),
    );
    const [module, js] = await Promise.all([compile, import(new URL('openscad.js', base).href)]);
    ctx.postMessage({ type: 'loaded', ms: performance.now() - t0 });
    return { module, factory: js.default as OpenSCADFactory };
  })();
  return ready;
}

/** Typsnitt hämtas en gång per worker (dist/fonts/) och skrivs till varje instans. */
const fontCache = new Map<string, Promise<Uint8Array>>();
const FONTS_CONF = '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig><dir>/fonts</dir></fontconfig>\n';
function fetchFont(file: string) {
  if (!fontCache.has(file)) {
    const p = fetch(new URL(`./fonts/${file}`, import.meta.url)).then(async r => {
      if (!r.ok) throw new Error(`${file}: ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    });
    p.catch(() => fontCache.delete(file)); // försök igen nästa gång
    fontCache.set(file, p);
  }
  return fontCache.get(file)!;
}

/** Bibliotek (dist/libs/<namn>.json) hämtas en gång per worker och skrivs till /libraries i varje instans. */
const libCache = new Map<string, Promise<Record<string, string>>>();
function fetchLibrary(name: string) {
  if (!libCache.has(name)) {
    const p = fetch(new URL(`./libs/${name}.json`, import.meta.url)).then(async r => {
      if (!r.ok) throw new Error(`${name}: ${r.status}`);
      return (await r.json()) as Record<string, string>;
    });
    p.catch(() => libCache.delete(name)); // försök igen nästa gång
    libCache.set(name, p);
  }
  return libCache.get(name)!;
}

async function render(req: Extract<WorkerRequest, { type: 'render' }>) {
  const { module, factory } = await load();
  const log: string[] = [];
  const fonts = await Promise.all((req.fonts ?? []).map(async f => [f, await fetchFont(f)] as const));
  const libs = await Promise.all((req.libs ?? []).map(l => fetchLibrary(l.name)));
  const libPath = ['/libraries', ...(req.libs ?? []).flatMap(l => (l.paths ?? []).map(p => `/libraries/${p}`))].join(':');
  const t0 = performance.now();
  const inst = await factory({
    noInitialRun: true,
    // fontconfig läser sin konfiguration när programmet startar.
    preRun: [
      (m: { ENV: Record<string, string> }) => {
        if (fonts.length) m.ENV.FONTCONFIG_FILE = '/fonts/fonts.conf';
        if (libs.length) m.ENV.OPENSCADPATH = libPath; // include <BOSL2/std.scad>
      },
    ],
    print: (s: string) => log.push(s),
    printErr: (s: string) => log.push(s),
    instantiateWasm: (imports: WebAssembly.Imports, done: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) => {
      WebAssembly.instantiate(module, imports).then(i => done(i, module));
      return {};
    },
  });
  const t1 = performance.now();

  if (fonts.length) {
    inst.FS.mkdirTree('/fonts');
    for (const [name, data] of fonts) inst.FS.writeFile(`/fonts/${name}`, data);
    inst.FS.writeFile('/fonts/fonts.conf', FONTS_CONF);
  }
  for (const lib of libs)
    for (const [path, text] of Object.entries(lib)) {
      inst.FS.mkdirTree(`/libraries/${path.slice(0, path.lastIndexOf('/'))}`);
      inst.FS.writeFile(`/libraries/${path}`, text);
    }
  for (const [path, text] of Object.entries(req.files ?? {})) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir) inst.FS.mkdirTree(dir);
    inst.FS.writeFile(path, text);
  }
  inst.FS.writeFile('/in.scad', req.src);
  const out = `/out.${EXT[req.format]}`;
  let rc: number;
  try {
    rc = inst.callMain(['/in.scad', '-o', out, `--export-format=${req.format}`, '--backend=manifold']);
  } catch (e) {
    rc = typeof (e as { status?: number })?.status === 'number' ? (e as { status: number }).status : -1;
    log.push(String(e));
  }
  const t2 = performance.now();

  let data: ArrayBuffer | null = null;
  try {
    data = (inst.FS.readFile(out) as Uint8Array).slice().buffer;
  } catch {
    /* ingen utfil (t.ex. tom modell eller fel) */
  }
  ctx.postMessage(
    { type: 'result', id: req.id, ok: rc === 0 && data !== null, rc, data, log, initMs: t1 - t0, renderMs: t2 - t1 },
    data ? [data] : [],
  );
}

ctx.onmessage = ev => {
  const req = ev.data;
  if (req.type === 'load') load().catch(e => ctx.postMessage({ type: 'fatal', error: String(e) }));
  else if (req.type === 'render')
    render(req).catch(e =>
      ctx.postMessage({ type: 'result', id: req.id, ok: false, rc: -1, data: null, log: [String(e)], initMs: 0, renderMs: 0 }),
    );
};
