// Built-in maps. Medal times are in steps (1/60 s); "vortex" is the author
// time. They were set from the autopilot (sim/bot.ts) with
// `node scripts/hexdrift-maps.ts`, which also checks each map can be finished.
import { buildRoadTrack, buildTrack, type Track } from "./sim/track.ts";
import type { RoadDef } from "./sim/road.ts";

export type BiomeId = "city" | "canyon" | "glacier" | "sky" | "desert" | "miami" | "storm" | "alpine" | "space" | "baja";

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
  miami: { name: "Miami", sky: "#ff9a6b", fog: "#ffb38a", ground: "#d8b98a", road: "#4a4552", roadAlt: "#46414e", edge: "#ffffff", wall: "#f2e6da", accent: "#ff4fa3", fogNear: 260, fogFar: 1400 },
  storm: { name: "Storm", sky: "#0b1024", fog: "#151b33", ground: "#1a1f2e", road: "#25262e", roadAlt: "#23242c", edge: "#dfe8ff", wall: "#3a4258", accent: "#2ee6ff", fogNear: 90, fogFar: 700 },
  alpine: { name: "Alpine", sky: "#7fb6ff", fog: "#cfe3f7", ground: "#6f8f5a", road: "#4b4d55", roadAlt: "#47494f", edge: "#ffffff", wall: "#c9ced6", accent: "#ff5a3d", fogNear: 300, fogFar: 1800 },
  space: { name: "Space", sky: "#05030f", fog: "#0a0720", ground: "#1b1830", road: "#2b2d3e", roadAlt: "#282a3a", edge: "#7cf7ff", wall: "#5b3dff", accent: "#ff3df2", fogNear: 600, fogFar: 2600 },
  baja: { name: "Baja", sky: "#9cc8f0", fog: "#efd9b4", ground: "#d9b27a", road: "#9a7552", roadAlt: "#93704e", edge: "#fff3d6", wall: "#b9874f", accent: "#ff7a1a", fogNear: 260, fogFar: 1600 },
  desert: { name: "Desert", sky: "#ffd9a0", fog: "#ffe2b4", ground: "#e8c27a", road: "#6b5b4b", roadAlt: "#625344", edge: "#fff3d6", wall: "#c98a3d", accent: "#ff6b3d", fogNear: 180, fogFar: 720 },
};

export interface MapDef {
  id: string;
  name: string;
  biome: BiomeId;
  difficulty: "Beginner" | "Medium" | "Hard" | "Expert";
  /** One or two sentences for the map's page. */
  blurb: string;
  /** Tile maps: the route as tiles. */
  recipe?: string;
  /** Road maps: smooth roads over real terrain. */
  road?: RoadDef;
  medals: { vortex: number; gold: number; silver: number; bronze: number };
  /**
   * The oldest physics version whose times still count on this map (for its
   * best time and medal). Raise it to the current PHYSICS_V when the map
   * changes so old times no longer compare; leave it when it doesn't.
   */
  since: number;
  /** Still being built: left out of the game. */
  wip?: boolean;
}

export const ALL_MAPS: MapDef[] = [
  {
    id: "miami-sunset", name: "Miami Sunset", biome: "miami", difficulty: "Medium",
    blurb: "Golden hour on the beach boulevard. Six lanes wide, palms and hotels on one side, the sea on the other. Cut across the sand, fly the marina and thread the downtown alley.",
    road: {
      land: { kind: "coast", seed: 11, base: 3, amp: 4, scale: 260, sea: 0, shore: [-1, 0, 90], fall: 26, shoulder: 0.15, verge: 6 },
      start: [-62, 0, 3.6, 0], bank: 4,
      route: "H12 S60 B S180 C S40 @a L60/70 S60 R60/70 S80 R60/70 S60 L60/70 @b S80 C L90/90 H9 WB S100 R45/60 S30 L45/60 W0 U10 S140 D10 S60 H10 @c R90/45 S70 L90/45 @d S60 R90/70 S100 BL S90 J3 S25 G32/-3 S60 C R90/70 S270 B S274 L90/70 B S160 C S40 R30/120 L30/120 S60 F S80",
      alts: [
        { from: "a", to: "b", via: [[0.3, 7], [0.7, 7]], hw: 6, surf: "sand", flush: true },
        { from: "c", to: "d", via: [[0.5, -6]], hw: 4.5 },
      ],
      dress: {
        kit: "miami",
        zones: [[0, 300, "boulevard", "beach"], [300, 860, "boulevard", "park"], [860, 2150, "downtown", "downtown"], [2150, 2700, "shops", "boulevard"], [2700, 3400, "boulevard", "beach"]],
        set: [["stand", 30, -1, 3], ["stand", 30, 1, 3], ["billboard", 200, -1, 2], ["pier", 150, 1, 30], ["beachbar", 420, 1, 6], ["guard_a", 240, 1, 20], ["stand", 3250, -1, 3], ["stand", 3250, 1, 3]],
      },
    },
    medals: { vortex: 3899, gold: 4261, silver: 4904, bronze: 6030 }, since: 6, wip: true,
  },
  {
    id: "miami-storm", name: "Miami Storm", biome: "storm", difficulty: "Beginner",
    blurb: "Midnight downpour downtown. Wide neon straights on soaked asphalt, a boost through the plaza and a back-alley cut for the brave. Brake early: the puddles bite.",
    road: {
      land: { kind: "coast", seed: 23, base: 3, amp: 3, scale: 300, sea: 0, shore: [1, 0, 260], fall: 26, shoulder: 0.15, verge: 6 },
      start: [0, 0, 4, 0], bank: 3,
      route: "H11 S60 B S200 C R90/70 S120 WB S160 W0 C R90/55 S90 @a S60 L90/60 S100 R90/60 @b S80 C B S220 R90/50 S140 C L60/90 S120 R60/90 S160 B S100 F",
      alts: [{ from: "a", to: "b", via: [[0.5, 4]], hw: 5 }],
      dress: {
        kit: "miami",
        zones: [[0, 330, "boulevard", "downtown"], [330, 1250, "downtown", "downtown"], [1250, 1900, "shops", "downtown"], [1900, 2600, "downtown", "shops"]],
        set: [["stand", 30, -1, 3], ["stand", 30, 1, 3], ["billboard", 180, 1, 2], ["billboard", 700, -1, 2], ["billboard", 1500, 1, 2]],
      },
    },
    medals: { vortex: 2809, gold: 3070, silver: 3533, bronze: 4344 }, since: 6, wip: true,
  },
  {
    id: "neon-downtown", blurb: "Midnight in the glass canyons. Long neon straights, a boost through the plaza and three tight turns that reward a clean line.", name: "Neon Downtown", biome: "city", difficulty: "Beginner",
    recipe: "W+ S3 C R S2 B S2 R S C S3 L S2 R S2 C S2 R S4 B F",
    medals: { vortex: 1211, gold: 1323, silver: 1523, bronze: 1872 }, since: 3,
  },
  {
    id: "canyon-rush", blurb: "Red rock, hot wind and a gap you have to jump. Climb out of the gorge, fly the ravine and keep your speed through the switchbacks.", name: "Canyon Rush", biome: "canyon", difficulty: "Medium",
    recipe: "S2 U S C L S2 D S B J G S2 C R S3 U U S L S2 C D D S2 R S B J G S F",
    medals: { vortex: 1278, gold: 1397, silver: 1608, bronze: 1977 }, since: 3,
  },
  {
    id: "glacier-run", blurb: "Sheet ice between blue walls. Grip comes and goes: brake before the frozen corners, not on them.", name: "Glacier Run", biome: "glacier", difficulty: "Medium",
    recipe: "W+ S2 I+ S2 I- C R S2 I+ L S L I- S2 C R S3 I+ S2 I- B S F",
    medals: { vortex: 926, gold: 1012, silver: 1165, bronze: 1433 }, since: 3,
  },
  {
    id: "cloud-kingdom", blurb: "Roads hung between sky islands. Three jumps over open air, and nothing below to catch you if you miss.", name: "Cloud Kingdom", biome: "sky", difficulty: "Hard",
    recipe: "S2 B J G S C U U S R S2 B J G S2 C L D S J G S C S R B S2 F",
    medals: { vortex: 983, gold: 1074, silver: 1236, bronze: 1520 }, since: 3,
  },
  {
    id: "desert-mirage", blurb: "Endless dunes, shimmering heat. Fast sweepers and boost pads that pay back every bit of commitment.", name: "Desert Mirage", biome: "desert", difficulty: "Medium",
    recipe: "S2 B S3 C R S4 B S4 R S C S2 L S3 B S4 R S2 D S2 F",
    medals: { vortex: 1274, gold: 1392, silver: 1602, bronze: 1970 }, since: 3,
  },
];

/** The maps in the game. */
export const MAPS: MapDef[] = ALL_MAPS.filter((m) => !m.wip);

const built = new Map<string, Track>();
export function trackOf(m: MapDef): Track {
  let t = built.get(m.id);
  if (!t) {
    t = m.road ? buildRoadTrack(m.road, m.biome) : buildTrack(m.recipe!, { sky: m.biome === "sky", theme: m.biome });
    built.set(m.id, t);
  }
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
