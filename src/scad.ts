// Client for the OpenSCAD worker: render(src) → Promise with mesh data and log.

import { fontsFor } from './fonts';
import { librariesFor } from './libs';
import { getBlob, importPath, importsIn } from './blobs';

export type ExportFormat = 'binstl' | 'off' | '3mf' | 'csg' | 'svg';

/** The output file's extension for a format. */
export const EXT: Record<ExportFormat, string> = { binstl: 'stl', off: 'off', '3mf': '3mf', csg: 'csg', svg: 'svg' };

export type WorkerRequest =
  | { type: 'load' }
  | { type: 'render'; id: number; src: string; format: ExportFormat; files?: Record<string, string | Uint8Array>; fonts?: string[]; libs?: { name: string; paths?: string[] }[] };

export interface RenderResult {
  ok: boolean;
  rc: number;
  data: ArrayBuffer | null;
  log: string[];
  initMs: number;
  renderMs: number;
}

export type WorkerMessage =
  | { type: 'loaded'; ms: number }
  | { type: 'fatal'; error: string }
  | ({ type: 'result'; id: number } & RenderResult);

export class RenderCancelled extends Error {
  constructor() {
    super('The rendering was cancelled');
  }
}

export class ScadEngine {
  private worker!: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: RenderResult) => void; reject: (e: Error) => void }>();
  /** Time to fetch and compile the wasm (ms), once the engine is ready. */
  loadMs: number | null = null;
  onLoaded?: (ms: number) => void;
  onFatal?: (error: string) => void;

  constructor() {
    this.spawn();
  }

  private spawn() {
    this.loadMs = null;
    this.worker = new Worker(new URL('./scad.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
      const m = ev.data;
      if (m.type === 'loaded') {
        this.loadMs = m.ms;
        this.onLoaded?.(m.ms);
      } else if (m.type === 'fatal') {
        this.onFatal?.(m.error);
      } else {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        p?.resolve(m);
      }
    };
    this.worker.onerror = ev => {
      const msg = ev.message || 'The worker crashed';
      this.onFatal?.(msg);
      this.restart(new Error(msg));
    };
    this.worker.postMessage({ type: 'load' } satisfies WorkerRequest);
  }

  /** Kill the worker, let pending renderings fail with `reason` and start a new one. */
  private restart(reason: Error) {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(reason);
    this.pending.clear();
    this.spawn();
  }

  get busy() {
    return this.pending.size > 0;
  }

  /** Render; after `timeoutMs` (if set) the worker is restarted and the promise rejected. */
  render(src: string, format: ExportFormat = 'binstl', files?: Record<string, string | Uint8Array>, timeoutMs?: number): Promise<RenderResult> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => this.pending.has(id) && this.restart(new Error(`No answer in ${Math.round(timeoutMs / 1000)} s`)), timeoutMs)
        : undefined;
      const done = () => clearTimeout(timer);
      this.pending.set(id, { resolve: r => (done(), resolve(r)), reject: e => (done(), reject(e)) });
      // Imported STL files (blobs.ts) are written to /imports/ in the engine's file system.
      importedFiles(src).then(
        imported => {
          if (!this.pending.has(id)) return; // cancelled while the files were being read
          this.worker.postMessage({ type: 'render', id, src, format, files: { ...files, ...imported }, fonts: fontsFor(src), libs: librariesFor(src) } satisfies WorkerRequest);
        },
        e => {
          const p = this.pending.get(id);
          this.pending.delete(id);
          p?.reject(e);
        },
      );
    });
  }

  /** Cancel the running rendering(s): the worker is killed and restarted. */
  cancel() {
    this.restart(new RenderCancelled());
  }
}

async function importedFiles(src: string): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  for (const h of importsIn(src)) {
    const b = await getBlob(h);
    if (b) out[importPath(h)] = b;
  }
  return out;
}

/** Pick out ERROR/WARNING lines from OpenSCAD's log. */
export function logProblems(log: string[]) {
  return log.filter(l => /^(ERROR|WARNING|TRACE)|Parser error|syntax error|abort/i.test(l));
}
