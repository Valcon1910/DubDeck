// The maps you made, kept on this device (Community Maps puts them online).
// Your times on them stay here too: one best per version of the map, since an
// edit changes the road.
import { cleanMap, medalsOf, roadDefOf, THEMES, versionOf, type CustomMap } from "./sim/custom.ts";
import { PHYSICS_V } from "./sim/race.ts";
import { fromB64, toB64 } from "./records.ts";
import type { MapDef } from "./maps.ts";

const KEY = "hexdrift.mymaps.v1";
const BEST = "hexdrift.mybest.v1";

function read<T>(key: string, fallback: T): T {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as T : fallback; } catch { return fallback; }
}
function write(key: string, v: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; }
}

export function myMaps(): CustomMap[] {
  const raw = read<unknown[]>(KEY, []);
  const out: CustomMap[] = [];
  for (const r of Array.isArray(raw) ? raw : []) { const m = cleanMap(r, ""); if (m && m.id) out.push(m); }
  return out.sort((a, b) => b.updated - a.updated);
}
export const myMap = (id: string) => myMaps().find((m) => m.id === id) ?? null;

/** Saves a map (false when the device's storage is full). */
export function saveMap(m: CustomMap): boolean {
  const all = myMaps().filter((x) => x.id !== m.id);
  all.unshift({ ...m, updated: Date.now() });
  return write(KEY, all);
}
export function deleteMap(id: string) {
  write(KEY, myMaps().filter((x) => x.id !== id));
  const b = read<Record<string, MyBest>>(BEST, {});
  for (const k of Object.keys(b)) if (k.startsWith(id + ":")) delete b[k];
  write(BEST, b);
}

/** The author time counts only on the version it was driven on. */
export const authorOf = (m: CustomMap) => m.author && m.author.hash === versionOf(m) ? m.author : null;

/** The map as the game sees it. Without an author time the medals wait (shown as —). */
export function mapDefOf(m: CustomMap): MapDef {
  const a = authorOf(m);
  const th = THEMES[m.theme];
  return {
    id: `${m.id}-${versionOf(m)}`, name: m.name, biome: th.biome, difficulty: "Medium",
    blurb: `${th.name} · made by you`, road: roadDefOf(m),
    medals: a ? medalsOf(a.ticks) : { vortex: 0, gold: 0, silver: 0, bronze: 0 }, since: PHYSICS_V,
  };
}

export interface MyBest { t: number; inputs: string }
export const myBest = (m: CustomMap): MyBest | null => read<Record<string, MyBest>>(BEST, {})[`${m.id}:${versionOf(m)}`] ?? null;

/**
 * Takes a finish on your map: your best on this version, and the author time
 * (which sets the medals) when it's the fastest yet. Returns the updated map.
 */
export function finishOn(m: CustomMap, ticks: number, inputs: number[]): { map: CustomMap; best: boolean; author: boolean } {
  const v = versionOf(m);
  const all = read<Record<string, MyBest>>(BEST, {});
  const k = `${m.id}:${v}`;
  const best = !all[k] || ticks < all[k].t;
  const enc = toB64(Uint8Array.from(inputs));
  if (best) { all[k] = { t: ticks, inputs: enc }; write(BEST, all); }
  const a = authorOf(m);
  const author = !a || ticks < a.ticks;
  const map = author ? { ...m, author: { ticks, inputs: enc, hash: v } } : m;
  if (author) saveMap(map);
  return { map, best, author };
}

export const bestInputs = (b: MyBest) => fromB64(b.inputs);
