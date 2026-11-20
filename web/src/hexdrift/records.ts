// Best runs, kept on this device in IndexedDB (the browser's storage for
// apps: bigger and longer-lasting than cookies). A run is the list of input
// bytes, so it doubles as the ghost and, later, as proof for online records.
// Falls back to localStorage if IndexedDB isn't available.

/** Bump when the physics change: older runs can't be replayed exactly. */
export const PHYSICS_V = 3;

export interface Run {
  map: string;
  t: number; // finish time in steps
  inputs: Uint8Array;
  at: number; // when it was set
  v: number; // physics version
  synced?: boolean; // sent to the online records (step 3)
}

const DB = "hexdrift", STORE = "best";
let dbp: Promise<IDBDatabase | null> | null = null;
const cache = new Map<string, Run>();
let loaded: Promise<Map<string, Run>> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "map" }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}

const b64 = (a: Uint8Array) => { let s = ""; for (const b of a) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function lsRead(): Run[] {
  const out: Run[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!k.startsWith("hexdrift.best.")) continue;
      const v = JSON.parse(localStorage.getItem(k) ?? "null");
      if (v && typeof v.t === "number" && typeof v.i === "string") {
        out.push({ map: k.slice(14), t: v.t, inputs: unb64(v.i), at: v.at ?? 0, v: v.v ?? 1 });
      }
    }
  } catch { /* blocked */ }
  return out;
}

/** All best runs (loaded once, then served from memory). */
export function allBests(): Promise<Map<string, Run>> {
  if (loaded) return loaded;
  loaded = (async () => {
    const db = await open();
    const old = lsRead();
    if (!db) { for (const r of old) if (r.v === PHYSICS_V) cache.set(r.map, r); return cache; }
    const rows = await new Promise<Run[]>((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as Run[]);
      req.onerror = () => resolve([]);
    });
    // Runs from older physics can't be replayed or compared: start fresh.
    for (const r of rows) if (r.v === PHYSICS_V) cache.set(r.map, r);
    // Move step-1 records (localStorage) into IndexedDB.
    for (const r of old) {
      if (r.v !== PHYSICS_V) { try { localStorage.removeItem(`hexdrift.best.${r.map}`); } catch { /* */ } continue; }
      const cur = cache.get(r.map);
      if (!cur || r.t < cur.t) { cache.set(r.map, r); await write(db, r); }
      try { localStorage.removeItem(`hexdrift.best.${r.map}`); } catch { /* */ }
    }
    return cache;
  })();
  return loaded;
}

export const bestNow = (map: string) => cache.get(map) ?? null;

function write(db: IDBDatabase, r: Run) {
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

/** Saves the run if it beats the stored best. Returns true when it did. */
export async function offerBest(map: string, t: number, inputs: number[]): Promise<boolean> {
  await allBests();
  const cur = cache.get(map);
  if (cur && cur.t <= t && cur.v === PHYSICS_V) return false;
  const r: Run = { map, t, inputs: Uint8Array.from(inputs), at: Date.now(), v: PHYSICS_V, synced: false };
  cache.set(map, r);
  const db = await open();
  if (db) await write(db, r);
  else try { localStorage.setItem(`hexdrift.best.${map}`, JSON.stringify({ t, i: b64(r.inputs), at: r.at, v: r.v })); } catch { /* full */ }
  return true;
}

/** For tests: forget a map's best. */
export async function clearBest(map: string) {
  cache.delete(map);
  const db = await open();
  if (db) await new Promise<void>((resolve) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(map); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
  try { localStorage.removeItem(`hexdrift.best.${map}`); } catch { /* */ }
}

// ── The run in progress, saved every few seconds so a reload doesn't lose it ─
export interface Live { map: string; inputs: Uint8Array; v: number }
const LIVE = "hexdrift.live";

export function saveLive(map: string, inputs: number[]) {
  try { localStorage.setItem(LIVE, JSON.stringify({ map, i: b64(Uint8Array.from(inputs)), v: PHYSICS_V, at: Date.now() })); } catch { /* */ }
}
export function clearLive() { try { localStorage.removeItem(LIVE); } catch { /* */ } }
export function readLive(): Live | null {
  try {
    const v = JSON.parse(localStorage.getItem(LIVE) ?? "null");
    if (!v || v.v !== PHYSICS_V || Date.now() - v.at > 12 * 3600e3) return null;
    return { map: v.map, inputs: unb64(v.i), v: v.v };
  } catch { return null; }
}
