// The garage: what your car looks like. Every car drives exactly the same
// (same size, same physics), so records stay fair; looks are just for fun.
// Some parts are free; the rest unlock with medal points, earned by your best
// medal on each map (bronze 1, silver 2, gold 3, Vortex 4).
import { MAPS, medalFor, type Medal } from "./maps.ts";
import type { Run } from "./records.ts";

export type Profile2D = [number, number][];
export interface BodyDef { id: string; name: string; need: number; w: number; pts: Profile2D; cab: { y: number; z: number; s: number } | null }
export interface Item { id: string; name: string; need: number; color?: string }

/** Side outlines (z forward, y up). The wheels and hitbox are the same for all. */
export const BODIES: BodyDef[] = [
  { id: "viper", name: "Viper", need: 0, w: 1.05, pts: [[-2.1, 0.35], [2.25, 0.3], [2.3, 0.55], [0.7, 0.85], [-1.6, 0.95], [-2.15, 0.85]], cab: { y: 1.15, z: -0.45, s: 1 } },
  { id: "bolt", name: "Bolt", need: 0, w: 1.0, pts: [[-2.2, 0.3], [2.4, 0.28], [2.45, 0.45], [1.0, 0.7], [-1.2, 0.8], [-2.2, 0.75]], cab: { y: 0.98, z: -0.2, s: 0.9 } },
  { id: "brick", name: "Brick", need: 0, w: 1.12, pts: [[-2.1, 0.35], [2.1, 0.35], [2.15, 0.75], [1.3, 0.95], [-1.9, 1.1], [-2.15, 1.0]], cab: { y: 1.32, z: -0.4, s: 1.1 } },
  { id: "stinger", name: "Stinger", need: 3, w: 1.0, pts: [[-2.2, 0.3], [2.5, 0.25], [2.5, 0.38], [0.3, 0.7], [-1.8, 0.78], [-2.25, 0.6]], cab: { y: 0.92, z: -0.6, s: 0.85 } },
  { id: "hauler", name: "Hauler", need: 6, w: 1.15, pts: [[-2.15, 0.4], [2.1, 0.4], [2.2, 0.9], [1.2, 1.0], [0.9, 1.55], [-2.1, 1.55]], cab: null },
  { id: "phantom", name: "Phantom", need: 9, w: 1.05, pts: [[-2.3, 0.32], [2.35, 0.3], [2.4, 0.5], [1.4, 0.62], [-0.6, 1.0], [-2.3, 0.9]], cab: { y: 1.2, z: -0.9, s: 0.95 } },
  { id: "nova", name: "Nova", need: 13, w: 1.08, pts: [[-2.1, 0.35], [2.3, 0.3], [2.2, 0.62], [0.2, 1.0], [-1.0, 1.0], [-2.15, 0.7]], cab: { y: 1.22, z: -0.4, s: 0.8 } },
  { id: "apex", name: "Apex", need: 18, w: 1.0, pts: [[-2.3, 0.28], [2.6, 0.24], [2.6, 0.4], [0.8, 0.62], [-1.4, 0.85], [-2.35, 0.95]], cab: { y: 1.02, z: -0.5, s: 0.85 } },
];

export const PAINTS: Item[] = [
  { id: "frost", name: "Frost", need: 0, color: "#e8edf7" },
  { id: "ember", name: "Ember", need: 0, color: "#ff5a3c" },
  { id: "lime", name: "Lime", need: 0, color: "#8cff5a" },
  { id: "ocean", name: "Ocean", need: 0, color: "#2f7bff" },
  { id: "midnight", name: "Midnight", need: 0, color: "#262c45" },
  { id: "sun", name: "Sun", need: 0, color: "#ffc53d" },
  { id: "rose", name: "Rose", need: 2, color: "#ff6fb5" },
  { id: "mint", name: "Mint", need: 4, color: "#5fffd2" },
  { id: "violet", name: "Violet", need: 5, color: "#8f5bff" },
  { id: "copper", name: "Copper", need: 8, color: "#c8763f" },
  { id: "chrome", name: "Chrome", need: 12, color: "#d4dceb" },
  { id: "obsidian", name: "Obsidian", need: 16, color: "#101018" },
];

/** Wing, stripe and caliper colour. "Map" follows each map's own colour. */
export const ACCENTS: Item[] = [{ id: "map", name: "Map colour", need: 0 }, ...PAINTS];

export const WINGS: Item[] = [
  { id: "high", name: "High wing", need: 0 },
  { id: "none", name: "No wing", need: 0 },
  { id: "low", name: "Lip", need: 0 },
  { id: "twin", name: "Twin deck", need: 5 },
  { id: "swan", name: "Swan neck", need: 11 },
];

export const RIMS: Item[] = [
  { id: "accent", name: "Match accent", need: 0 },
  { id: "dark", name: "Dark", need: 0, color: "#2a2d38" },
  { id: "chrome", name: "Chrome", need: 0, color: "#cfd6e4" },
  { id: "gold", name: "Gold", need: 7, color: "#ffc53d" },
  { id: "neon", name: "Neon", need: 10, color: "#7af7ff" },
];

export const EXTRAS: Item[] = [
  { id: "none", name: "Nothing", need: 0 },
  { id: "antenna", name: "Antenna", need: 0 },
  { id: "lights", name: "Light bar", need: 4 },
  { id: "fin", name: "Shark fin", need: 8 },
  { id: "scoop", name: "Roof scoop", need: 14 },
];

export const TRAILS: Item[] = [
  { id: "cyan", name: "Cyan", need: 0, color: "#7af7ff" },
  { id: "flame", name: "Flame", need: 0, color: "#ff9a3d" },
  { id: "pink", name: "Pink", need: 3, color: "#ff5fd2" },
  { id: "green", name: "Toxic", need: 6, color: "#8cff5a" },
  { id: "white", name: "White hot", need: 10, color: "#ffffff" },
  { id: "rainbow", name: "Rainbow", need: 20 },
];

export interface Look { body: string; paint: string; accent: string; wing: string; rims: string; extra: string; trail: string }
export type Slot = keyof Look;

export const SLOTS: { slot: Slot; label: string; items: (Item | BodyDef)[] }[] = [
  { slot: "body", label: "Car", items: BODIES },
  { slot: "paint", label: "Paint", items: PAINTS },
  { slot: "accent", label: "Accent", items: ACCENTS },
  { slot: "wing", label: "Wing", items: WINGS },
  { slot: "rims", label: "Rims", items: RIMS },
  { slot: "extra", label: "Roof", items: EXTRAS },
  { slot: "trail", label: "Boost trail", items: TRAILS },
];

export const DEFAULT_LOOK: Look = { body: "viper", paint: "frost", accent: "map", wing: "high", rims: "accent", extra: "none", trail: "cyan" };

export const MEDAL_POINTS: Record<Exclude<Medal, null>, number> = { bronze: 1, silver: 2, gold: 3, vortex: 4 };
export const MAX_POINTS = MAPS.length * 4;

/** Medal points from your best time on each map. */
export function medalPoints(bests: Map<string, Run>) {
  let p = 0;
  for (const m of MAPS) {
    const b = bests.get(m.id);
    const medal = b ? medalFor(m, b.t) : null;
    if (medal) p += MEDAL_POINTS[medal];
  }
  return p;
}

export const itemsOf = (slot: Slot) => SLOTS.find((s) => s.slot === slot)!.items;
export const itemOf = (slot: Slot, id: string) => itemsOf(slot).find((i) => i.id === id) ?? itemsOf(slot)[0];

const KEY = "hexdrift.look";

/** Your saved look, with anything locked (or unknown) swapped for the default. */
export function readLook(points = Infinity): Look {
  let saved: Partial<Look> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { /* */ }
  const out = { ...DEFAULT_LOOK };
  for (const { slot, items } of SLOTS) {
    const it = items.find((i) => i.id === saved[slot]);
    if (it && it.need <= points) out[slot] = it.id;
  }
  return out;
}

export function saveLook(look: Look) {
  try { localStorage.setItem(KEY, JSON.stringify(look)); } catch { /* */ }
}
