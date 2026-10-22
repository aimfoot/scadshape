// Importerade filer (STL) i webbläsarens IndexedDB, efter innehållshash. Dokumentet (kv.ts) sparar
// bara hashen, så att modellen hålls liten. Motorn skriver filen till /imports/<hash>.stl
// före renderingen (scad.ts). Utan IndexedDB (tester, privat läge) bara i minnet.

const DB = 'scadshape-files';
const STORE = 'files';
const mem = new Map<string, Uint8Array>();
const known = new Set<string>();
let loaded = false;
let dbp: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  dbp ??= new Promise(resolve => {
    try {
      const req = globalThis.indexedDB?.open(DB, 1);
      if (!req) return resolve(null);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

const call = <T>(req: IDBRequest<T>) => new Promise<T>((res, rej) => ((req.onsuccess = () => res(req.result)), (req.onerror = () => rej(req.error))));

/** Läs in vilka filer som finns (så att modellbygget vet om en fil saknas). */
export async function initBlobs() {
  const d = await db();
  if (d) for (const k of await call(d.transaction(STORE).objectStore(STORE).getAllKeys())) known.add(String(k));
  loaded = true;
}

/** Har listan över sparade filer lästs in? (Innan dess antas filerna finnas.) */
export const blobsLoaded = () => loaded;
export const hasBlob = (hash: string) => known.has(hash) || mem.has(hash);

/** Innehållshash (två 32-bitars FNV-varianter + längd; crypto.subtle finns inte över http). */
export function blobHash(b: Uint8Array): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ b.length;
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i], 0x01000193);
    h2 = Math.imul(h2 ^ b[i], 0x5bd1e995) ^ (h2 >>> 15);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2) + b.length.toString(16).padStart(8, '0');
}

export async function putBlob(bytes: Uint8Array): Promise<string> {
  const hash = blobHash(bytes);
  mem.set(hash, bytes);
  known.add(hash);
  const d = await db();
  if (d) {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(bytes, hash);
    await new Promise<void>((res, rej) => ((tx.oncomplete = () => res()), (tx.onerror = () => rej(tx.error))));
  }
  return hash;
}

export async function getBlob(hash: string): Promise<Uint8Array | null> {
  const m = mem.get(hash);
  if (m) return m;
  const d = await db();
  if (!d) return null;
  const v = (await call(d.transaction(STORE).objectStore(STORE).get(hash))) as Uint8Array | ArrayBuffer | undefined;
  if (!v) return null;
  const bytes = v instanceof Uint8Array ? v : new Uint8Array(v);
  mem.set(hash, bytes);
  return bytes;
}

/** Sökvägen i motorns filsystem. */
export const importPath = (hash: string) => `/imports/${hash}.stl`;
/** Hashar som en OpenSCAD-kod importerar. */
export const importsIn = (src: string) => [...new Set([...src.matchAll(/\/imports\/([0-9a-f]{24})\.stl/g)].map(m => m[1]))];

// ---- Inbäddning i .scadshape.json ----------------------------------------------------------------

function toBase64(b: Uint8Array) {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Lägg till de importerade filerna (base64) i en exporterad projektfil. */
export async function embedBlobs(json: string): Promise<string> {
  const o = JSON.parse(json) as { doc?: { features?: { type: string; file?: string }[] }; files?: Record<string, string> };
  const hashes = [...new Set((o.doc?.features ?? []).filter(f => f.type === 'mesh' && f.file).map(f => f.file!))];
  if (!hashes.length) return json;
  o.files = {};
  for (const h of hashes) {
    const b = await getBlob(h);
    if (b) o.files[h] = toBase64(b);
  }
  return JSON.stringify(o, null, 1);
}

/** Spara filer som är inbäddade i en projektfil. */
export async function storeEmbedded(text: string) {
  let o: { files?: Record<string, string> };
  try {
    o = JSON.parse(text);
  } catch {
    return;
  }
  for (const [h, b64] of Object.entries(o?.files ?? {})) {
    if (!/^[0-9a-f]{24}$/.test(h) || typeof b64 !== 'string') continue;
    const bytes = fromBase64(b64);
    if (blobHash(bytes) === h) await putBlob(bytes);
  }
}
