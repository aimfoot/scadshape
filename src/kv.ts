// Storage for the models (projects.ts): IndexedDB (database "scadshape", store "kv", text per key).
// openStorage() (main.ts, before the model is read) loads everything into memory, so the rest of
// the code reads and writes synchronously; every change is written through to IndexedDB right away.
// The models were in localStorage before 2026-10-22: if they are still there they are moved here
// (written, read back and compared, then removed from localStorage). Without IndexedDB (Node tests,
// blocked storage) localStorage is used as before, otherwise only memory.

import { remoteLog } from './remote';

const DB = 'scadshape';
const STORE = 'kv';
/** The keys that belong here: the project list, the current project and the documents (not the UI settings). */
const OURS = /^scadshape\.(projects|current|doc(\..+)?)$/;

type Kind = 'indexeddb' | 'localstorage' | 'memory';
const mem = new Map<string, string>();
const pending = new Map<string, string | null>();
let db: IDBDatabase | null = null;
let kind: Kind = 'memory';
let saved: Promise<void> = Promise.resolve();

/** Called if a write fails (e.g. storage full) – the change then only exists in memory. */
export const storageHooks = { error: (_e: unknown) => {} };

const done = (tx: IDBTransaction) =>
  new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = tx.onabort = () => rej(tx.error ?? new Error('The IndexedDB transaction was aborted'));
  });
const call = <T>(req: IDBRequest<T>) => new Promise<T>((res, rej) => ((req.onsuccess = () => res(req.result)), (req.onerror = () => rej(req.error))));

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
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
}

async function readAll(d: IDBDatabase) {
  const store = d.transaction(STORE).objectStore(STORE);
  const [keys, values] = await Promise.all([call(store.getAllKeys()), call(store.getAll())]);
  return new Map(keys.map((k, i) => [String(k), String(values[i])]));
}

/** The model keys in localStorage (empty if it is missing or blocked). */
function localItems(): [string, string][] {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return [];
    const keys = Array.from({ length: ls.length }, (_, i) => ls.key(i)).filter((k): k is string => !!k && OURS.test(k));
    return keys.map(k => [k, ls.getItem(k) ?? '']);
  } catch {
    return [];
  }
}

/**
 * If model keys exist in localStorage the move is not finished (they are only removed once
 * IndexedDB demonstrably has them), or a session ran without IndexedDB: localStorage is then newest
 * and replaces everything.
 */
async function moveFromLocalStorage(d: IDBDatabase, items: [string, string][]) {
  const tx = d.transaction(STORE, 'readwrite', { durability: 'strict' });
  const store = tx.objectStore(STORE);
  store.clear();
  for (const [k, v] of items) store.put(v, k);
  await done(tx);
  const back = await readAll(d);
  if (back.size !== items.length || items.some(([k, v]) => back.get(k) !== v)) throw new Error('the check after the move did not match');
  for (const [k] of items) globalThis.localStorage.removeItem(k);
  remoteLog('storage-moved', { keys: items.length, bytes: items.reduce((n, [, v]) => n + v.length, 0) });
}

async function open() {
  const d = await openDb();
  if (d) {
    try {
      const old = localItems();
      if (old.length) await moveFromLocalStorage(d, old);
      for (const [k, v] of await readAll(d)) mem.set(k, v);
      db = d;
      kind = 'indexeddb';
      // Ask the browser not to clear the storage when space runs low (usually granted for installed
      // apps).
      void globalThis.navigator?.storage?.persist?.().catch(() => {});
      return;
    } catch (e) {
      remoteLog('storage-error', { err: String(e) });
      mem.clear();
    }
  }
  for (const [k, v] of localItems()) mem.set(k, v);
  try {
    if (globalThis.localStorage) kind = 'localstorage';
  } catch {
    /* blocked: memory only */
  }
}

function flush() {
  if (!db) return;
  const items = [...pending];
  pending.clear();
  let tx: IDBTransaction;
  try {
    tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const [k, v] of items) {
      if (v === null) store.delete(k);
      else store.put(v, k);
    }
  } catch (e) {
    remoteLog('storage-error', { err: String(e) });
    return storageHooks.error(e);
  }
  const p = done(tx).catch(e => {
    remoteLog('storage-error', { err: String(e) });
    storageHooks.error(e);
  });
  saved = Promise.all([saved, p]).then(() => {});
}

function write(k: string, v: string | null) {
  if (kind === 'indexeddb') {
    // Everything changed in the same tick is written in one transaction.
    if (!pending.size) queueMicrotask(flush);
    pending.set(k, v);
  } else if (kind === 'localstorage') {
    try {
      if (v === null) globalThis.localStorage.removeItem(k);
      else globalThis.localStorage.setItem(k, v);
    } catch (e) {
      storageHooks.error(e); // full or blocked: stays in memory for the session
    }
  }
}

export const kv = {
  get: (k: string): string | null => mem.get(k) ?? null,
  set(k: string, v: string) {
    mem.set(k, v);
    write(k, v);
  },
  remove(k: string) {
    mem.delete(k);
    write(k, null);
  },
};

/** Where the models are stored right now. */
export const storageKind = () => kind;
/** Waits until everything changed so far has been written (tests). */
export const storageSaved = () => (pending.size ? new Promise<void>(r => queueMicrotask(() => r())).then(() => saved) : saved);

let opening: Promise<void> | null = null;
/** Load the storage (once). Before that it is empty and writes stay in memory. */
export const openStorage = () => (opening ??= open());

/** Test hook (tools/browser): read/write/clear the storage wherever it is. */
export const storageForTests = {
  get: kv.get,
  set: kv.set,
  remove: kv.remove,
  keys: () => [...mem.keys()],
  /** Clears the models (memory and storage); reload the page afterwards. */
  clear() {
    for (const k of [...mem.keys()]) kv.remove(k);
    return storageSaved();
  },
  saved: () => storageSaved(),
  kind: () => kind,
};
