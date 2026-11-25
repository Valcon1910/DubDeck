// The garage: what your car looks like. The cars are low-poly lookalikes in
// the spirit of real ones, with their own names and no badges. Every car drives exactly the same
// (same size, same physics), so records stay fair; looks are just for fun.
// Some parts are free; the rest unlock with medal points, earned by your best
// medal on each map (bronze 1, silver 2, gold 3, Vortex 4).
import { MAPS, medalFor, type Medal } from "./maps.ts";

export interface BodyDef { id: string; name: string; need: number; blurb: string; paint: string; accent: string }
export interface Item { id: string; name: string; need: number; color?: string; color2?: string; style?: string }

/** The cars. Each has its own model (render/car.ts) and factory colours. */
export const BODIES: BodyDef[] = [
  { id: "coupe", name: "Grand Coupe", need: 0, blurb: "Long-hood luxury coupe", paint: "#1f3d78", accent: "#c9d3e2" },
  { id: "furia", name: "Furia", need: 0, blurb: "Cab-forward supercar", paint: "#d70f14", accent: "#ffcf1a" },
  { id: "rig", name: "Cyber Rig", need: 0, blurb: "Steel-panelled electric truck", paint: "#b4b8bd", accent: "#1c1d21" },
  { id: "zenith", name: "Zenith", need: 6, blurb: "Mid-engine track car, big wing", paint: "#ffcc12", accent: "#15161a" },
  { id: "formula", name: "Formula X", need: 12, blurb: "Open-wheel single-seater", paint: "#ff8a1f", accent: "#15161a" },
  { id: "brawler", name: "Brawler", need: 0, blurb: "70s muscle fastback", paint: "#c2421a", accent: "#f4f1e8" },
  { id: "kaze", name: "Kaze R", need: 4, blurb: "90s twin-turbo coupe", paint: "#e9ecef", accent: "#c8102e" },
  { id: "scrambler", name: "Scrambler", need: 2, blurb: "Rally hatchback, mud flaps and all", paint: "#1d4fd8", accent: "#ffd21a" },
  { id: "dune", name: "Dune Runner", need: 8, blurb: "Desert trophy truck", paint: "#f2efe6", accent: "#ff6a13" },
  { id: "endura", name: "Endura", need: 16, blurb: "Endurance hypercar, Le Mans style", paint: "#0c7a5a", accent: "#e9f04a" },
];

export const PAINTS: Item[] = [
  { id: "factory", name: "Factory", need: 0 },
  { id: "frost", name: "Frost", need: 0, color: "#e8edf7" },
  { id: "ember", name: "Ember", need: 0, color: "#ff5a3c" },
  { id: "lime", name: "Lime", need: 0, color: "#8cff5a" },
  { id: "ocean", name: "Ocean", need: 0, color: "#2f7bff" },
  { id: "racing", name: "Racing green", need: 0, color: "#0f5a3a" },
  { id: "sun", name: "Sun", need: 0, color: "#ffe14d" },
  { id: "rose", name: "Rose", need: 2, color: "#ff6fb5" },
  { id: "mint", name: "Mint", need: 4, color: "#5fffd2" },
  { id: "violet", name: "Violet", need: 5, color: "#8f5bff" },
  { id: "copper", name: "Copper", need: 8, color: "#c8763f" },
  { id: "chrome", name: "Chrome", need: 12, color: "#a9b2c0" },
  { id: "obsidian", name: "Obsidian", need: 16, color: "#1a1030" },
];

/** Wing, caliper and trim colour. */
export const ACCENTS: Item[] = [{ id: "factory", name: "Factory", need: 0 }, { id: "map", name: "Map colour", need: 0 }, ...PAINTS.slice(1)];

export const WINGS: Item[] = [
  { id: "stock", name: "Factory", need: 0 },
  { id: "none", name: "No wing", need: 0 },
  { id: "high", name: "High wing", need: 0 },
  { id: "low", name: "Lip", need: 0 },
  { id: "twin", name: "Twin deck", need: 5 },
  { id: "duck", name: "Ducktail", need: 3 },
  { id: "gt", name: "GT wing", need: 9 },
  { id: "swan", name: "Swan neck", need: 11 },
];

export const RIMS: Item[] = [
  { id: "stock", name: "Factory", need: 0 },
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
  { id: "rack", name: "Roof rack", need: 2 },
  { id: "pod", name: "Rally lights", need: 6 },
  { id: "fin", name: "Shark fin", need: 8 },
  { id: "box", name: "Roof box", need: 10 },
  { id: "scoop", name: "Roof scoop", need: 14 },
];

export const TRAILS: Item[] = [
  { id: "cyan", name: "Cyan ribbon", need: 0, color: "#7af7ff", color2: "#3d6bff", style: "ribbon" },
  { id: "flame", name: "Flame", need: 0, color: "#ffd23d", color2: "#ff3d1a", style: "flame" },
  { id: "pink", name: "Twin streaks", need: 3, color: "#ff5fd2", color2: "#7a3dff", style: "twin" },
  { id: "green", name: "Toxic", need: 6, color: "#8cff5a", color2: "#1aa84a", style: "ribbon" },
  { id: "lightning", name: "Lightning", need: 8, color: "#d8f0ff", color2: "#5f9bff", style: "lightning" },
  { id: "white", name: "White hot", need: 10, color: "#ffffff", color2: "#ffb03d", style: "flame" },
  { id: "galaxy", name: "Galaxy", need: 14, color: "#a46bff", color2: "#3dd6ff", style: "galaxy" },
  { id: "rainbow", name: "Rainbow", need: 20, style: "rainbow" },
];

export const FINISHES: Item[] = [
  { id: "confetti", name: "Confetti", need: 0, color: "#ffd23d" },
  { id: "sparkles", name: "Sparkles", need: 0, color: "#ffe9a0" },
  { id: "shockwave", name: "Shockwave", need: 4, color: "#7af7ff" },
  { id: "fireworks", name: "Fireworks", need: 8, color: "#ff5a3c" },
  { id: "lightning", name: "Thunder", need: 12, color: "#8fd4ff" },
  { id: "vortex", name: "Vortex", need: 16, color: "#a46bff" },
];

export interface Look { body: string; paint: string; accent: string; wing: string; rims: string; extra: string; trail: string; finish: string }
export type Slot = keyof Look;

export const SLOTS: { slot: Slot; label: string; items: (Item | BodyDef)[] }[] = [
  { slot: "body", label: "Car", items: BODIES },
  { slot: "paint", label: "Paint", items: PAINTS },
  { slot: "accent", label: "Accent", items: ACCENTS },
  { slot: "wing", label: "Wing", items: WINGS },
  { slot: "rims", label: "Rims", items: RIMS },
  { slot: "extra", label: "Roof", items: EXTRAS },
  { slot: "trail", label: "Trail", items: TRAILS },
  { slot: "finish", label: "Finish", items: FINISHES },
];

export const DEFAULT_LOOK: Look = { body: "coupe", paint: "factory", accent: "factory", wing: "stock", rims: "stock", extra: "none", trail: "cyan", finish: "confetti" };

export const MEDAL_POINTS: Record<Exclude<Medal, null>, number> = { bronze: 1, silver: 2, gold: 3, vortex: 4 };
export const MAX_POINTS = MAPS.length * 4;

/** Medal points from your best time on each map. */
export function medalPoints(bests: Map<string, { t: number }>) {
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
