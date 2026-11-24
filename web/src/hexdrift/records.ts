// Best runs, kept on this device in IndexedDB (the browser's storage for
// apps: bigger and longer-lasting than cookies). A run is the list of input
// bytes, so it doubles as the ghost and, later, as proof for online records.
// Falls back to localStorage if IndexedDB isn't available.

import { PHYSICS_V } from "./sim/race.ts";
import { MAPS } from "./maps.ts";
export { PHYSICS_V };

export interface Run {
  map: string;
  t: number; // finish time in steps
  inputs: Uint8Array;
  at: number; // when it was set
  v: number; // physics version
  synced?: boolean; // sent to the online records (step 3)
  owner?: string; // the account it was sent as (or came from)
}

/**
 * Times from older physics can't be replayed (no ghost, not sent online),
 * but they still count for the map's best time and medal as long as that
 * map hasn't changed since: maps.ts says from which version each map's
 * times are still comparable ("since"). Only changed maps lose progress.
 */
export interface Best { t: number; legacy: boolean }
const LEGACY = "hexdrift.legacy";
let legacy: Record<string, { t: number; v: number }> = {};
function sinceOf(map: string) { return MAPS.find((m) => m.id === map)?.since ?? PHYSICS_V; }
function readLegacy() {
  try {
    const v = JSON.parse(localStorage.getItem(LEGACY) ?? "{}");
    if (v && typeof v === "object") legacy = v;
  } catch { legacy = {}; }
  // A map changed since: those old times no longer count.
  for (const [m, r] of Object.entries(legacy)) if (!(r.v >= sinceOf(m))) delete legacy[m];
}
function keepLegacy(map: string, t: number, v: number) {
  if (v >= PHYSICS_V || v < sinceOf(map)) return false;
  const cur = legacy[map];
  if (cur && cur.t <= t) return false;
  legacy[map] = { t, v };
  try { localStorage.setItem(LEGACY, JSON.stringify(legacy)); } catch { /* full */ }
  return true;
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
    readLegacy();
    const db = await open();
    const old = lsRead();
    for (const r of old) if (r.v !== PHYSICS_V) keepLegacy(r.map, r.t, r.v);
    if (!db) { for (const r of old) if (r.v === PHYSICS_V) cache.set(r.map, r); return cache; }
    const rows = await new Promise<Run[]>((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as Run[]);
      req.onerror = () => resolve([]);
    });
    // Runs from older physics can't be replayed: their times are kept (above).
    for (const r of rows) {
      if (r.v === PHYSICS_V) cache.set(r.map, r);
      else keepLegacy(r.map, r.t, r.v);
    }
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

/** The best time on a map, counting kept times from older physics. */
export function bestTimeNow(map: string): Best | null {
  const r = cache.get(map), l = legacy[map];
  if (l && (!r || l.t < r.t)) return { t: l.t, legacy: true };
  return r ? { t: r.t, legacy: false } : null;
}

/** Best time on every map (for the menu and medal points). */
export async function allTimes(): Promise<Map<string, Best>> {
  await allBests();
  const out = new Map<string, Best>();
  for (const m of new Set([...cache.keys(), ...Object.keys(legacy)])) { const b = bestTimeNow(m); if (b) out.set(m, b); }
  return out;
}

/**
 * Takes in a run of this account from the online records (another device):
 * kept when it beats the one here. Returns true when something changed.
 */
export async function adoptRun(map: string, t: number, inputs: Uint8Array, v: number, owner: string, at: number): Promise<boolean> {
  await allBests();
  if (v !== PHYSICS_V) return keepLegacy(map, t, v);
  const cur = cache.get(map);
  if (cur && cur.t <= t) return false;
  const r: Run = { map, t, inputs, at, v, synced: true, owner };
  cache.set(map, r);
  const db = await open();
  if (db) await write(db, r);
  return true;
}

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
  if (legacy[map]) { delete legacy[map]; try { localStorage.setItem(LEGACY, JSON.stringify(legacy)); } catch { /* */ } }
  const db = await open();
  if (db) await new Promise<void>((resolve) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(map); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
  try { localStorage.removeItem(`hexdrift.best.${map}`); } catch { /* */ }
}

/** Runs not yet sent to the online records (never ones another account brought in). */
export async function unsynced(me: string): Promise<Run[]> {
  const m = await allBests();
  return [...m.values()].filter((r) => !r.synced && r.v === PHYSICS_V && (!r.owner || r.owner === me));
}

/** Marks a run as sent (unless a newer best replaced it meanwhile). */
export async function markSynced(map: string, t: number, owner?: string) {
  const r = cache.get(map);
  if (!r || r.t !== t) return;
  r.synced = true;
  if (owner) r.owner = owner;
  const db = await open();
  if (db) await write(db, r);
}

export const toB64 = b64;
export const fromB64 = unb64;

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
