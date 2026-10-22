// Lagring för modellerna (projects.ts): IndexedDB (databasen "scadshape", tabellen "kv", text per
// nyckel). openStorage() (main.ts, innan modellen läses) läser allt till minnet, så resten av koden
// läser och skriver synkront; varje ändring skrivs genast vidare till IndexedDB.
// Modellerna låg i localStorage före 2026-10-22: finns de kvar där flyttas de hit (skrivs, läses
// tillbaka och jämförs, tas sedan bort ur localStorage). Utan IndexedDB (Node-tester, blockerad
// lagring) används localStorage som förut, annars bara minnet.

import { remoteLog } from './remote';

const DB = 'scadshape';
const STORE = 'kv';
/** Nycklarna som hör hit: projektlistan, aktuellt projekt och dokumenten (inte UI-inställningarna). */
const OURS = /^scadshape\.(projects|current|doc(\..+)?)$/;

type Kind = 'indexeddb' | 'localstorage' | 'memory';
const mem = new Map<string, string>();
const pending = new Map<string, string | null>();
let db: IDBDatabase | null = null;
let kind: Kind = 'memory';
let saved: Promise<void> = Promise.resolve();

/** Anropas om en skrivning misslyckas (t.ex. full lagring) – ändringen finns då bara i minnet. */
export const storageHooks = { error: (_e: unknown) => {} };

const done = (tx: IDBTransaction) =>
  new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = tx.onabort = () => rej(tx.error ?? new Error('IndexedDB-transaktionen avbröts'));
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

/** Modellnycklarna i localStorage (tomt om den saknas eller är blockerad). */
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
 * Finns modellnycklar i localStorage är flytten inte klar (de tas bort först när IndexedDB bevisligen
 * har dem), eller så kördes en session utan IndexedDB: localStorage är då nyast och ersätter allt.
 */
async function moveFromLocalStorage(d: IDBDatabase, items: [string, string][]) {
  const tx = d.transaction(STORE, 'readwrite', { durability: 'strict' });
  const store = tx.objectStore(STORE);
  store.clear();
  for (const [k, v] of items) store.put(v, k);
  await done(tx);
  const back = await readAll(d);
  if (back.size !== items.length || items.some(([k, v]) => back.get(k) !== v)) throw new Error('kontrollen efter flytten stämde inte');
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
      // Be webbläsaren att inte rensa lagringen när det blir ont om plats (beviljas oftast för installerade appar).
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
    /* blockerad: bara minnet */
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
    // Allt som ändras i samma varv skrivs i en transaktion.
    if (!pending.size) queueMicrotask(flush);
    pending.set(k, v);
  } else if (kind === 'localstorage') {
    try {
      if (v === null) globalThis.localStorage.removeItem(k);
      else globalThis.localStorage.setItem(k, v);
    } catch (e) {
      storageHooks.error(e); // full eller blockerad: finns kvar i minnet under sessionen
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

/** Var modellerna sparas just nu. */
export const storageKind = () => kind;
/** Väntar tills allt som ändrats hittills är skrivet (tester). */
export const storageSaved = () => (pending.size ? new Promise<void>(r => queueMicrotask(() => r())).then(() => saved) : saved);

let opening: Promise<void> | null = null;
/** Läs in lagringen (en gång). Före det är den tom och skrivningar stannar i minnet. */
export const openStorage = () => (opening ??= open());

/** Testkrok (tools/browser): läs/skriv/töm lagringen oavsett var den ligger. */
export const storageForTests = {
  get: kv.get,
  set: kv.set,
  remove: kv.remove,
  keys: () => [...mem.keys()],
  /** Tömmer modellerna (minnet och lagringen); ladda om sidan efteråt. */
  clear() {
    for (const k of [...mem.keys()]) kv.remove(k);
    return storageSaved();
  },
  saved: () => storageSaved(),
  kind: () => kind,
};
