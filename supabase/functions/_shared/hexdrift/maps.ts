// Copied from web/src/hexdrift by scripts/hexdrift-share.mjs. Don't edit here.
// Built-in maps. Medal times are in steps (1/60 s); "vortex" is the author
// time. They were set from the autopilot (sim/bot.ts) with
// `node scripts/hexdrift-maps.ts`, which also checks each map can be finished.
import { buildTrack, type Track } from "./track.ts";

export type BiomeId = "city" | "canyon" | "glacier" | "sky" | "desert";

export interface Biome {
  name: string;
  sky: string; fog: string; ground: string;
  road: string; roadAlt: string; edge: string; wall: string; accent: string;
  fogNear: number; fogFar: number;
}

export const BIOMES: Record<BiomeId, Biome> = {
  city: { name: "City", sky: "#1b1440", fog: "#2a1d5c", ground: "#1d1b2e", road: "#3b3a52", roadAlt: "#34334a", edge: "#ff3df2", wall: "#23e5ff", accent: "#ffd23d", fogNear: 120, fogFar: 520 },
  canyon: { name: "Canyon", sky: "#f2b38a", fog: "#e9a27a", ground: "#b8532f", road: "#5b4a42", roadAlt: "#53433c", edge: "#f4e2c4", wall: "#8b3a1e", accent: "#ffe066", fogNear: 160, fogFar: 640 },
  glacier: { name: "Glacier", sky: "#bfe3ff", fog: "#d9efff", ground: "#eef7ff", road: "#5a6b80", roadAlt: "#536276", edge: "#ffffff", wall: "#7fd0ff", accent: "#3dbbff", fogNear: 120, fogFar: 520 },
  sky: { name: "Sky", sky: "#7cc7ff", fog: "#bfe6ff", ground: "#ffffff", road: "#4c5672", roadAlt: "#454e69", edge: "#ffe27a", wall: "#ffffff", accent: "#ff7ad9", fogNear: 200, fogFar: 760 },
  desert: { name: "Desert", sky: "#ffd9a0", fog: "#ffe2b4", ground: "#e8c27a", road: "#6b5b4b", roadAlt: "#625344", edge: "#fff3d6", wall: "#c98a3d", accent: "#ff6b3d", fogNear: 180, fogFar: 720 },
};

export interface MapDef {
  id: string;
  name: string;
  biome: BiomeId;
  difficulty: "Beginner" | "Medium" | "Hard" | "Expert";
  recipe: string;
  medals: { vortex: number; gold: number; silver: number; bronze: number };
}

export const MAPS: MapDef[] = [
  {
    id: "neon-downtown", name: "Neon Downtown", biome: "city", difficulty: "Beginner",
    recipe: "W+ S3 C R S2 B S2 R S C S3 L S2 R S2 C S2 R S4 B F",
    medals: { vortex: 1211, gold: 1323, silver: 1523, bronze: 1872 },
  },
  {
    id: "canyon-rush", name: "Canyon Rush", biome: "canyon", difficulty: "Medium",
    recipe: "S2 U S C L S2 D S B J G S2 C R S3 U U S L S2 C D D S2 R S B J G S F",
    medals: { vortex: 1278, gold: 1397, silver: 1608, bronze: 1977 },
  },
  {
    id: "glacier-run", name: "Glacier Run", biome: "glacier", difficulty: "Medium",
    recipe: "W+ S2 I+ S2 I- C R S2 I+ L S L I- S2 C R S3 I+ S2 I- B S F",
    medals: { vortex: 926, gold: 1012, silver: 1165, bronze: 1433 },
  },
  {
    id: "cloud-kingdom", name: "Cloud Kingdom", biome: "sky", difficulty: "Hard",
    recipe: "S2 B J G S C U U S R S2 B J G S2 C L D S J G S C S R B S2 F",
    medals: { vortex: 983, gold: 1074, silver: 1236, bronze: 1520 },
  },
  {
    id: "desert-mirage", name: "Desert Mirage", biome: "desert", difficulty: "Medium",
    recipe: "S2 B S3 C R S4 B S4 R S C S2 L S3 B S4 R S2 D S2 F",
    medals: { vortex: 1274, gold: 1392, silver: 1602, bronze: 1970 },
  },
];

const built = new Map<string, Track>();
export function trackOf(m: MapDef): Track {
  let t = built.get(m.id);
  if (!t) { t = buildTrack(m.recipe, { sky: m.biome === "sky" }); built.set(m.id, t); }
  return t;
}

export type Medal = "vortex" | "gold" | "silver" | "bronze" | null;
export function medalFor(m: MapDef, ticks: number): Medal {
  if (ticks <= m.medals.vortex) return "vortex";
  if (ticks <= m.medals.gold) return "gold";
  if (ticks <= m.medals.silver) return "silver";
  if (ticks <= m.medals.bronze) return "bronze";
  return null;
}
