// Copied from web/src/hexdrift by scripts/hexdrift-share.mjs. Don't edit here.
// Composing a road map's scenery from a kit of ready-made objects (made in
// Blender: scripts/hexdrift-kit). The map gives its roads, its set pieces and
// what lines each stretch of road (beach, boulevard, downtown...); this fills
// everything else: buildings shoulder to shoulder along the roads facing
// them, then blocks behind on a grid of side streets, out to the horizon.
//
// The solid objects are part of the physics (a car that leaves the road
// hits them the same way on every device and in the record checker), so
// the layout comes only from the track: hashes and road geometry, with
// only + - * / sqrt and Math.floor / Math.imul.
import { hash } from "./math.ts";
import { GAP, landAt, MAT, roadDist, roadTerrain, TUN, WL, WR, type Road, type Sample, type Strip } from "./road.ts";

/** An object of a kit: its solid footprint (half sizes across a and deep b, centre shift cx/cz in its own frame), height, and room kept clear in front. */
export interface KitDef {
  a: number; b: number; h: number; cx?: number; cz?: number; front?: number; round?: boolean; solid?: boolean;
  /** Drawn out to the fog (open-air scenery), not just nearby. */
  vista?: boolean;
}

export const KITS: Record<string, Record<string, KitDef>> = {
  miami: {
    deco_a: { a: 8.6, b: 6.6, h: 22, front: 5 },
    deco_b: { a: 7.1, b: 5.6, h: 18.7, front: 5 },
    deco_c: { a: 9.6, b: 6.6, h: 25, front: 5 },
    deco_d: { a: 7.6, b: 6.1, h: 18.7, front: 5 },
    condo_a: { a: 12, b: 9.1, h: 70, front: 6 },
    condo_b: { a: 11, b: 8.1, h: 90, front: 6 },
    office_a: { a: 11, b: 11, h: 94 },
    shops_a: { a: 14, b: 5.2, h: 9.6, front: 2 },
    shops_b: { a: 12, b: 5.2, h: 9.6, front: 2 },
    garage: { a: 19, b: 12, h: 12.3, cx: 2 },
    guard_a: { a: 1.9, b: 1.9, h: 7.8, front: 4 },
    guard_b: { a: 1.9, b: 1.9, h: 7.8, front: 4 },
    beachbar: { a: 5.6, b: 5.1, h: 5.9 },
    palm_tall: { a: 0.4, b: 0.4, h: 12.5, round: true },
    palm_mid: { a: 0.4, b: 0.4, h: 8.9, round: true },
    palm_pair: { a: 0.9, b: 0.9, h: 10.5, round: true },
    busstop: { a: 2.6, b: 1.0, h: 2.8 },
    billboard: { a: 6.3, b: 0.5, h: 15.3 },
    foodtruck: { a: 1.2, b: 2.8, h: 3.5 },
    stand: { a: 19, b: 5.5, h: 16.7 },
    planter: { a: 2.0, b: 0.6, h: 1.5 },
    // Side roads closed off: the barrier row (solid), and the arrow board trailers behind it.
    closure: { a: 4.8, b: 0.32, h: 1.2 },
    arrow_r: { a: 1.0, b: 1.5, cz: -0.6, h: 3.5 }, arrow_l: { a: 1.0, b: 1.5, cz: -0.6, h: 3.5 },
    lamp2: { a: 0.3, b: 0.3, h: 9.2, round: true },
    sedan_r: { a: 0.93, b: 2.25, h: 1.7 }, sedan_b: { a: 0.93, b: 2.25, h: 1.7 }, sedan_w: { a: 0.93, b: 2.25, h: 1.7 },
    taxi: { a: 0.93, b: 2.25, h: 1.9 }, police: { a: 0.93, b: 2.25, h: 1.9 }, van: { a: 1.0, b: 2.7, h: 2.4 }, bus: { a: 1.3, b: 6, h: 3.3 },
    // Scenery out of reach (on the water, in the air): drawn only.
    yacht: { a: 2.6, b: 12, h: 8, solid: false }, sailboat: { a: 1.6, b: 5, h: 14, solid: false },
    pier: { a: 3.9, b: 31, h: 7, cz: 30, solid: false }, heli: { a: 5, b: 6, h: 2, solid: false },
  },
  alpine: {
    chalet_a: { a: 6.4, b: 5.6, cz: 0.25, h: 10.4, front: 3 },
    chalet_b: { a: 7.4, b: 6.1, cz: 0.25, h: 14.1, front: 3 },
    chalet_c: { a: 5.9, b: 5.6, cz: 0.25, h: 10.1, front: 3 },
    hotel: { a: 15, b: 9.5, cz: 2, h: 25, front: 4 },
    chapel: { a: 4.7, b: 8.9, h: 21.4, front: 3 },
    shops: { a: 12.8, b: 6, cz: 0.5, h: 9.7, front: 2 },
    barn: { a: 6.8, b: 5.2, h: 9.1 },
    hut: { a: 2.6, b: 2.1, h: 4.5 },
    stand: { a: 17.5, b: 5, h: 8.3 },
    // Trees: only the trunk is solid; the branches overlap their neighbours.
    pine_tall: { a: 0.5, b: 0.5, h: 16, round: true },
    pine_mid: { a: 0.4, b: 0.4, h: 10.6, round: true },
    pine_small: { a: 0.3, b: 0.3, h: 6.4, round: true },
    pine_trio: { a: 2.6, b: 2.2, h: 13.8, round: true },
    rock_a: { a: 2.6, b: 1.9, h: 3.1, round: true },
    rock_b: { a: 3.8, b: 3.8, h: 4.6, round: true },
    fence: { a: 4.1, b: 0.15, h: 1.3 },
    // Chevron boards round the sharp bends (lamps lit in turn the way the road goes).
    chevron_r: { a: 1.2, b: 0.15, h: 2.8 }, chevron_l: { a: 1.2, b: 0.15, h: 2.8 },
    icesign: { a: 0.15, b: 0.15, h: 3, round: true },
    lamp: { a: 0.2, b: 0.2, h: 5.1, round: true },
    lift: { a: 0.8, b: 0.8, h: 14.4 },
    plough: { a: 1.6, b: 4.2, cz: 0.4, h: 3.1 },
    sedan_r: { a: 0.93, b: 2.25, h: 2.1 }, sedan_b: { a: 0.93, b: 2.25, h: 1.8 }, sedan_w: { a: 0.93, b: 2.25, h: 2.1 },
    taxi: { a: 1.0, b: 2.5, h: 2.7 }, police: { a: 0.93, b: 2.25, h: 2.0 }, van: { a: 1.0, b: 2.7, h: 2.4 }, bus: { a: 1.3, b: 5.5, h: 3.3 },
  },
  baja: {
    adobe_a: { a: 5.1, b: 4.5, cz: 0.35, h: 4.6, front: 1 },
    adobe_b: { a: 6.6, b: 5, cx: 0.5, h: 7.3, front: 1 },
    adobe_c: { a: 4.6, b: 4.5, cz: 0.35, h: 4.4, front: 1 },
    adobe_d: { a: 6.1, b: 5, cx: 0.5, h: 7.1, front: 1 },
    cantina: { a: 8.3, b: 5, h: 7.7, front: 4.2 },
    tienda_a: { a: 5, b: 4, h: 4.8, front: 1.8 }, tienda_b: { a: 5, b: 4, h: 4.8, front: 1.8 },
    mission: { a: 6, b: 11.5, cz: -0.5, h: 19.3, front: 1 },
    gas: { a: 8.3, b: 8.5, h: 9.1 },
    watertower: { a: 2.1, b: 2.1, h: 13.2 },
    windpump: { a: 1.5, b: 1.5, h: 10.8 },
    palapa: { a: 3, b: 3, h: 3.9 },
    saguaro_a: { a: 0.45, b: 0.45, h: 8.3, round: true }, saguaro_b: { a: 0.4, b: 0.4, h: 6.2, round: true }, saguaro_c: { a: 0.55, b: 0.55, h: 10.4, round: true },
    cardon: { a: 1, b: 1, h: 7.5, round: true },
    // Low plants: drawn only (you drive through them).
    agave: { a: 2, b: 1.2, h: 1.1, solid: false }, shrubs: { a: 2.1, b: 1.8, h: 1, solid: false },
    fanpalm: { a: 0.35, b: 0.35, h: 13.2, round: true },
    rock_a: { a: 2.4, b: 2.4, h: 4, round: true }, rock_b: { a: 5, b: 4, h: 9, round: true }, mesa: { a: 13, b: 10, h: 21, round: true },
    pole: { a: 0.2, b: 0.2, h: 9, round: true },
    tyres: { a: 2, b: 0.6, h: 1.2 }, bales: { a: 3.2, b: 0.55, h: 1.8 },
    tent: { a: 4.1, b: 4.1, h: 3.8 },
    stand: { a: 15.1, b: 3.8, h: 7.4 },
    chevron_r: { a: 1.2, b: 0.15, h: 2.7 }, chevron_l: { a: 1.2, b: 0.15, h: 2.7 },
    wreck: { a: 0.9, b: 2.3, h: 1.5 },
    sedan_r: { a: 1.1, b: 2.7, h: 2 }, sedan_b: { a: 1.1, b: 2.7, h: 1.9 }, sedan_w: { a: 1.1, b: 2.7, h: 2 },
    taxi: { a: 1, b: 2, h: 1.8 }, police: { a: 1.1, b: 2.7, h: 1.9 }, van: { a: 1.1, b: 2.7, h: 1.9 }, bus: { a: 1.2, b: 5, h: 3.4 },
  },
  sky: {
    keep: { a: 9, b: 9, h: 34, front: 2, vista: true },
    gatehouse: { a: 8.2, b: 3.1, h: 19.6, vista: true },
    wizard: { a: 3, b: 3, h: 23, round: true, vista: true },
    temple: { a: 6, b: 6, h: 12.2, round: true },
    cottage_a: { a: 4, b: 3.7, h: 9.1, front: 1 }, cottage_b: { a: 4, b: 3.7, h: 9.1, front: 1 }, cottage_c: { a: 4, b: 3.7, h: 9.1, front: 1 },
    windmill: { a: 3, b: 3, h: 16.3, round: true },
    oak: { a: 0.5, b: 0.5, h: 8, round: true }, blossom: { a: 0.5, b: 0.5, h: 8, round: true }, cypress: { a: 0.4, b: 0.4, h: 9.4, round: true },
    flowers: { a: 2, b: 1, h: 0.7, solid: false },
    lantern: { a: 0.2, b: 0.2, h: 4.2, round: true },
    crystal: { a: 1.6, b: 1.6, h: 5.7, round: true },
    statue: { a: 1.2, b: 1.2, h: 6.8 },
    gazebo: { a: 3, b: 3, h: 5.2, round: true },
    stand: { a: 15, b: 4.4, cz: 0.5, h: 7.3 },
    chevron_r: { a: 1.2, b: 0.15, h: 2.7 }, chevron_l: { a: 1.2, b: 0.15, h: 2.7 },
    // The open air: drawn only.
    cloud_a: { a: 15, b: 12, h: 9, solid: false, vista: true }, cloud_b: { a: 25, b: 16, h: 12, solid: false, vista: true },
    islet_a: { a: 4.6, b: 4.6, h: 14, solid: false, vista: true }, islet_b: { a: 4.6, b: 4.6, h: 14, solid: false, vista: true },
    balloon_a: { a: 6.2, b: 6.2, h: 19, solid: false, vista: true }, balloon_b: { a: 6.2, b: 6.2, h: 19, solid: false, vista: true },
    airship: { a: 5.1, b: 17, h: 12, solid: false, vista: true },
  },
};

const SKY_AIR = ["cloud_a", "cloud_b", "cloud_a", "islet_a", "cloud_b", "balloon_a", "islet_b", "cloud_a", "cloud_b", "islet_a", "balloon_b", "cloud_a", "cloud_b", "airship"];

/** What lines each kind of strip: the frontage along the road, the blocks behind, and fillers between. */
interface Mix {
  front: string[]; back: string[]; filler: string[]; setback: number; tall?: string[];
  /** No street grid (forest, rocks). */
  wild?: boolean;
  /** Fillers scattered inside each block (default 3). */
  scatter?: number;
  /** What stands right by the road (default: the fillers). */
  kerb?: string[];
  /** Where there's no ground (between sky islands): drawn-only things in the open air. */
  air?: string[];
}
const MIXES: Record<string, Partial<Record<Strip, Mix>>> = {
  miami: {
    boulevard: { front: ["deco_a", "deco_b", "deco_c", "deco_d", "deco_a", "deco_c"], back: ["condo_a", "condo_b", "shops_a", "deco_b", "condo_a"], filler: ["palm_tall", "palm_mid", "palm_pair"], setback: 5 },
    downtown: { front: ["office_a", "condo_b", "shops_a", "shops_b", "garage", "condo_a"], back: ["office_a", "condo_b", "condo_a", "garage", "shops_b"], filler: ["palm_mid", "planter", "palm_mid", "busstop", "billboard", "planter", "lamp2"], setback: 4, tall: ["office_a", "condo_b"] },
    shops: { front: ["shops_a", "shops_b", "deco_b", "foodtruck"], back: ["deco_d", "condo_a", "shops_a"], filler: ["palm_mid", "planter", "lamp2", "busstop", "palm_mid"], setback: 3 },
    beach: { front: [], back: ["guard_a", "guard_b", "beachbar"], filler: ["palm_tall", "palm_pair", "palm_mid"], setback: 3 },
    park: { front: [], back: ["palm_pair", "beachbar", "palm_tall", "foodtruck", "palm_pair", "planter", "busstop"], filler: ["palm_mid", "planter", "lamp2"], setback: 4 },
  },
  alpine: {
    village: { front: ["chalet_a", "chalet_b", "shops", "chalet_c", "hotel", "chalet_a", "chapel", "chalet_c"], back: ["chalet_a", "chalet_c", "barn", "chalet_b", "hut", "chalet_a", "hotel"], filler: ["pine_mid", "lamp", "fence", "pine_small", "pine_trio", "rock_a"], setback: 5, tall: ["hotel"], scatter: 4 },
    forest: { front: [], back: ["pine_trio", "pine_tall", "pine_mid", "pine_trio", "rock_a", "pine_tall", "pine_mid", "pine_trio", "pine_tall", "hut"], filler: ["pine_mid", "pine_small", "pine_tall", "pine_trio", "rock_a", "pine_mid"], setback: 4, wild: true, scatter: 14 },
    cliff: { front: [], back: ["rock_b", "pine_trio", "rock_a", "rock_b", "pine_tall", "pine_mid"], filler: ["rock_a", "pine_small", "pine_mid", "rock_b", "pine_trio"], setback: 3, wild: true, scatter: 10 },
    park: { front: [], back: ["pine_trio", "pine_tall", "rock_a", "pine_mid", "barn", "pine_trio"], filler: ["pine_mid", "pine_small", "rock_a", "pine_trio"], setback: 4, wild: true, scatter: 12 },
  },
  baja: {
    village: { front: ["adobe_a", "tienda_a", "adobe_b", "cantina", "adobe_c", "gas", "adobe_d", "tienda_b", "mission", "adobe_a"], back: ["adobe_a", "adobe_c", "adobe_b", "adobe_d", "palapa", "adobe_a", "adobe_c", "tienda_b", "adobe_b", "watertower", "adobe_d", "adobe_a"], filler: ["fanpalm", "saguaro_b", "agave", "shrubs", "palapa"], kerb: ["fanpalm", "pole", "agave", "fanpalm", "shrubs"], setback: 4, scatter: 4 },
    desert: { front: [], back: ["saguaro_a", "cardon", "saguaro_c", "rock_a", "saguaro_b", "shrubs", "agave", "saguaro_a", "rock_b"], filler: ["saguaro_b", "agave", "shrubs", "saguaro_a", "cardon", "rock_a"], kerb: ["tyres", "saguaro_b", "bales", "pole", "agave", "tyres", "shrubs"], setback: 4, wild: true, scatter: 9 },
    cliff: { front: [], back: ["rock_b", "mesa", "rock_a", "rock_b", "cardon", "rock_a"], filler: ["rock_a", "shrubs", "saguaro_b", "agave", "rock_b"], setback: 3, wild: true, scatter: 8 },
    camp: { front: ["tent", "tent", "stand", "tent"], back: ["saguaro_a", "palapa", "rock_a", "cardon", "saguaro_c", "shrubs"], filler: ["saguaro_b", "agave", "shrubs", "rock_a"], kerb: ["tyres", "bales", "tyres", "bales", "fanpalm"], setback: 3, wild: true, scatter: 6 },
    park: { front: [], back: ["saguaro_a", "cardon", "rock_a", "saguaro_c", "shrubs"], filler: ["saguaro_b", "agave", "shrubs", "rock_a"], setback: 4, wild: true, scatter: 10 },
  },
  sky: {
    village: { front: ["cottage_a", "cottage_b", "keep", "cottage_c", "temple", "gatehouse", "cottage_a", "windmill", "wizard", "cottage_b"], back: ["cottage_a", "cottage_b", "cottage_c", "oak", "blossom", "cottage_a", "windmill", "cottage_b", "gazebo", "oak"], filler: ["lantern", "cypress", "flowers", "blossom", "statue", "oak"], kerb: ["lantern", "cypress", "flowers", "lantern", "statue"], setback: 4, wild: true, scatter: 6, air: SKY_AIR },
    park: { front: [], back: ["oak", "blossom", "gazebo", "temple", "cypress", "oak", "crystal", "windmill", "blossom"], filler: ["cypress", "flowers", "oak", "blossom", "crystal", "lantern"], kerb: ["lantern", "cypress", "flowers", "crystal", "blossom"], setback: 4, wild: true, scatter: 10, air: SKY_AIR },
    cliff: { front: [], back: ["crystal", "oak", "crystal", "cypress", "blossom"], filler: ["crystal", "cypress", "blossom", "flowers"], kerb: ["crystal", "lantern", "cypress"], setback: 3, wild: true, scatter: 8, air: SKY_AIR },
  },
};

/** A placed kit object. (fx, fz) is the way its front faces. */
export interface Placed { o: string; x: number; y: number; z: number; fx: number; fz: number; v: number }
/** A side street: a straight run between two points (traffic drives it). */
export interface Street { ax: number; az: number; bx: number; bz: number }

/** streets: the grid traffic drives; spurs: side roads off the race, closed where they meet it. */
export interface Composed { placed: Placed[]; streets: Street[]; spurs: Street[]; kit: Record<string, KitDef> }

/** Occupied ground, on a 2 m grid. */
class Occupancy {
  private cells = new Set<number>();
  private key(i: number, j: number) { return Math.imul(i, 73856093) ^ Math.imul(j, 19349663); }
  /** Is a turned box (half sizes a, b, plus margin m) free? Mark it if so (and mark is true; force marks it even if not). */
  box(x: number, z: number, fx: number, fz: number, a: number, b: number, m: number, mark: boolean, force = false): boolean {
    const A = a + m, B = b + m;
    const R = Math.sqrt(A * A + B * B) + 2;
    const i0 = Math.floor((x - R) / 2), i1 = Math.floor((x + R) / 2);
    const j0 = Math.floor((z - R) / 2), j1 = Math.floor((z + R) / 2);
    // The cell under its centre always counts (a small thing can miss every cell centre).
    const hit: number[] = [this.key(Math.floor(x / 2), Math.floor(z / 2))];
    if (this.cells.has(hit[0]) && !force) return false;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const px = i * 2 + 1 - x, pz = j * 2 + 1 - z;
        const lx = px * fz - pz * fx, lz = px * fx + pz * fz;
        const ax = lx < 0 ? -lx : lx, az = lz < 0 ? -lz : lz;
        if (ax > A || az > B) continue;
        const k = this.key(i, j);
        if (this.cells.has(k) && !force) return false;
        hit.push(k);
      }
    }
    if (mark) for (const k of hit) this.cells.add(k);
    return true;
  }
}

const cache = new WeakMap<Road, Composed>();

/** Lays out every kit object of a road map (worked out once per road). */
export function compose(road: Road): Composed | null {
  const dress = road.dress;
  if (!dress) return null;
  const have = cache.get(road);
  if (have) return have;
  const kit = KITS[dress.kit] ?? {};
  const mixes = MIXES[dress.kit] ?? {};
  const placed: Placed[] = [];
  const streets: Street[] = [];
  const spurs: Street[] = [];
  const occ = new Occupancy();
  const sea = road.land.sea;
  const main = road.strands[0].pts;
  const total = main[main.length - 1].s;

  const sandAt = (x: number, z: number) => sea !== undefined && landAt(road.land, x, z).mat === MAT.sand;
  const wetAt = (x: number, z: number) => sea !== undefined && landAt(road.land, x, z).h < sea + 0.3;
  /** Places an object if it fits: clear of every road by gap, on dry land, not on anything else. */
  const put = (o: string, x: number, z: number, fx: number, fz: number, v: number, gap: number, margin: number): boolean => {
    const d = kit[o];
    if (!d) return false;
    const rx = fz, rz = -fx; // its own x axis
    const cx = x + rx * (d.cx ?? 0) + fx * (d.cz ?? 0), cz = z + rz * (d.cx ?? 0) + fz * (d.cz ?? 0);
    const front = d.front ?? 0;
    // Clear of the roads: corners, edge middles and the centre (with the room in front).
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const lz = j > 0 ? d.b + front : j * d.b;
        const px = cx + rx * d.a * i + fx * lz, pz = cz + rz * d.a * i + fz * lz;
        if (roadDist(road, px, pz, gap + 1) < gap) return false;
        if (d.solid !== false && wetAt(px, pz)) return false;
      }
    }
    // Stands on the lowest ground under it (sunk a little).
    let y = 1e9;
    for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) {
      const g = roadTerrain(road, cx + rx * d.a * i + fx * d.b * j, cz + rz * d.a * i + fz * d.b * j);
      if (g.ravine && d.solid !== false) return false;
      if (g.h < y) y = g.h;
    }
    const gc = roadTerrain(road, cx, cz).h;
    if (gc < y) y = gc;
    if (y < -1e7) return false;
    if (!occ.box(cx + fx * front * 0.5, cz + fz * front * 0.5, fx, fz, d.a, d.b + front * 0.5, margin, true)) return false;
    placed.push({ o, x, y: y - 0.3, z, fx, fz, v });
    return true;
  };
  const pick = (list: string[], v: number) => list[Math.floor(v * list.length) % list.length];
  const stripAt = (s: number, side: number): Strip => {
    for (const [a, b, l, r] of dress.zones) if (s >= a && s < b) return side < 0 ? l : r;
    return "none";
  };
  const at = (p: Sample, lat: number, along: number) => [p.x - p.dz * lat + p.dx * along, p.z + p.dx * lat + p.dz * along];

  // ── Set pieces, by hand ──
  for (const [o, s, side, gap, shift] of dress.set ?? []) {
    let i = 0;
    while (i < main.length - 1 && main[i].s < s) i++;
    const p = main[i], d = kit[o];
    if (!d) continue;
    const off = p.hw + gap + d.b + (d.front ?? 0);
    const [x, z] = at(p, side * off, shift ?? 0);
    // Faces the road.
    put(o, x, z, p.dz * side, -p.dx * side, hash(i, side, 90), 1, 0);
  }

  // ── Chevron boards round the sharp bends, on the outside, turned to the cars coming ──
  if (kit.chevron_r) {
    let last = -1e9, n = 0;
    for (let i = 8; i < main.length - 8; i++) {
      const p = main[i];
      if (p.s - last < 14) continue;
      const a = main[i - 8], b = main[i + 8];
      const turn = a.dx * b.dz - a.dz * b.dx;
      if ((turn < 0.25 && turn > -0.25) || p.flags & (TUN | GAP)) continue;
      const side = turn > 0 ? -1 : 1; // the outside
      // Half towards the road, half back along it.
      let fx = p.dz * side - p.dx, fz = -p.dx * side - p.dz;
      const l = Math.sqrt(fx * fx + fz * fz);
      fx /= l; fz /= l;
      const [x, z] = at(p, side * (p.hw + 2.6), 0);
      n++;
      if (put(side < 0 ? "chevron_r" : "chevron_l", x, z, fx, fz, hash(n, side, 180), 1.2, 0)) {
        placed[placed.length - 1].y = roadTerrain(road, x, z).h;
        last = p.s;
      }
    }
  }

  // ── Side roads off the race, closed where they meet it ──
  // Every couple of hundred metres where buildings line a straight stretch,
  // a street leads off into the city; at its mouth a row of barriers with
  // blinking lamps and an arrow board pointing the way the race goes.
  const SPUR = 70;
  for (const side of [-1, 1]) {
    let s = 110 + hash(side + 5, 7, 170) * 90;
    let n = 0;
    while (s < total - 110) {
      n++;
      const strip = stripAt(s, side);
      let i = 0;
      while (i < main.length - 1 && main[i].s < s) i++;
      const p = main[i];
      const a = main[i < 8 ? 0 : i - 8], b = main[i + 8 < main.length ? i + 8 : main.length - 1];
      let ok = (strip === "boulevard" || strip === "downtown" || strip === "shops") && a.dx * b.dx + a.dz * b.dz > 0.985;
      for (const q of [a, p, b]) if (q.flags & (TUN | GAP | WL | WR)) ok = false;
      // Out, square to the road (its right is (-dz, dx)).
      const ox = -p.dz * side, oz = p.dx * side;
      for (let k = 0; ok && k <= 6; k++) {
        const lat = p.hw + 10 + (SPUR - 10) * k / 6;
        const [x, z] = at(p, side * lat, 0);
        if (roadDist(road, x, z, 9) < 8 || wetAt(x, z) || roadTerrain(road, x, z).ravine) ok = false;
      }
      const [mx, mz] = at(p, side * (p.hw + SPUR / 2), 0);
      if (ok) ok = occ.box(mx, mz, ox, oz, 6.5, SPUR / 2, 0, false);
      if (ok) {
        const [cx, cz] = at(p, side * (p.hw + 2.4), 0);
        const [bx, bz] = at(p, side * (p.hw + 5.6), 0);
        // Faces the road; the arrow points the way the race runs (its own +x is -side along the road).
        if (put("closure", cx, cz, -ox, -oz, hash(n, side, 171), 1.2, 0)) {
          // Standing on the street, not sunk like a building.
          placed[placed.length - 1].y = roadTerrain(road, cx, cz).h + 0.05;
          if (put(side > 0 ? "arrow_l" : "arrow_r", bx, bz, -ox, -oz, hash(n, side, 172), 1.2, 0)) placed[placed.length - 1].y = roadTerrain(road, bx, bz).h + 0.05;
          const [ax, az] = at(p, side * (p.hw + 1.2), 0), [ex, ez] = at(p, side * (p.hw + SPUR), 0);
          spurs.push({ ax, az, bx: ex, bz: ez });
          occ.box(mx, mz, ox, oz, 6.5, SPUR / 2, 0, true, true);
          s += 230 + hash(n, side, 173) * 180;
          continue;
        }
      }
      s += 30;
    }
  }

  // ── Frontage: buildings shoulder to shoulder along each side, facing the road ──
  for (const side of [-1, 1]) {
    let s = 20;
    let n = 0;
    while (s < total - 10) {
      n++;
      const strip = stripAt(s, side);
      const mix = mixes[strip];
      if (!mix) { s += 10; continue; }
      let i = 0;
      while (i < main.length - 1 && main[i].s < s) i++;
      const p = main[i];
      const v = hash(n, side + 3, 91);
      // Kerb-side fillers (palms, planters) in front of the frontage, every 12 m.
      const kerb = mix.kerb ?? mix.filler;
      if (kerb.length && hash(n, side, 92) < 0.8) {
        const f = pick(kerb, hash(n, side, 93));
        const fd = kit[f];
        const [x, z] = at(p, side * (p.hw + 2.4 + fd.a), 0);
        put(f, x, z, p.dz * side, -p.dx * side, hash(n, side, 94), 1.4, 0.2);
      }
      if (!mix.front.length) { s += 12; continue; }
      const o = pick(mix.front, v);
      const d = kit[o];
      const off = p.hw + mix.setback + d.b + (d.front ?? 0);
      const [x, z] = at(p, side * off, d.a);
      if (put(o, x, z, p.dz * side, -p.dx * side, hash(n, side, 95), mix.setback - 0.5, 0.5)) s += d.a * 2 + 2 + hash(n, side, 96) * 4;
      else s += 6;
    }
  }

  // ── Blocks behind, on a street grid square to the start, out to the horizon ──
  const s0 = main[0];
  const ux = s0.dx, uz = s0.dz, vx = s0.dz, vz = -s0.dx; // grid axes
  const BLOCK = 64, STREET = 12;
  // The main road, every ~10 m, for "which stretch is nearest".
  const marks: Sample[] = [];
  for (let i = 0; i < main.length; i += 4) marks.push(main[i]);
  const nearest = (x: number, z: number) => {
    let bd = 1e18, bp = marks[0];
    for (const p of marks) {
      const dx = p.x - x, dz = p.z - z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; bp = p; }
    }
    return { p: bp, d: Math.sqrt(bd) };
  };
  const R = 560;
  const cx0 = (road.x0 + road.x1) / 2, cz0 = (road.z0 + road.z1) / 2;
  const span = Math.sqrt((road.x1 - road.x0) * (road.x1 - road.x0) + (road.z1 - road.z0) * (road.z1 - road.z0)) / 2 + R;
  const nb = Math.floor(span / BLOCK) + 1;
  // Project the centre onto the grid axes so blocks line up the same way every time.
  const gu0 = Math.floor((cx0 * ux + cz0 * uz) / BLOCK), gv0 = Math.floor((cx0 * vx + cz0 * vz) / BLOCK);
  const G = (u: number, v: number) => [ux * u + vx * v, uz * u + vz * v];
  for (let bu = -nb; bu <= nb; bu++) {
    for (let bv = -nb; bv <= nb; bv++) {
      const U = (gu0 + bu) * BLOCK, V = (gv0 + bv) * BLOCK;
      const [mx, mz] = G(U + BLOCK / 2, V + BLOCK / 2);
      const nr = nearest(mx, mz);
      if (nr.d > R) continue;
      const lat = -(mx - nr.p.x) * nr.p.dz + (mz - nr.p.z) * nr.p.dx;
      const strip = stripAt(nr.p.s, lat < 0 ? -1 : 1);
      const sand = sandAt(mx, mz);
      const mix = sand ? mixes.beach : mixes[strip] ?? mixes.park;
      if (!mix) continue;
      // No ground here (open sky): clouds below, islets around, balloons and airships above.
      if (mix.air && roadTerrain(road, mx, mz).h < -1e7) {
        for (let k = 0; k < 2; k++) {
          const hv = hash(gu0 + bu, gv0 + bv, 200 + k);
          if (hv < 0.55) continue;
          const o = pick(mix.air, hash(gu0 + bu, gv0 + bv, 201 + k * 7));
          const [px, pz] = G(U + BLOCK / 2 + (hash(gu0 + bu, gv0 + bv, 202 + k * 7) - 0.5) * 48, V + BLOCK / 2 + (hash(gu0 + bu, gv0 + bv, 203 + k * 7) - 0.5) * 48);
          if (roadDist(road, px, pz, 30) < 28) continue;
          const t = hash(gu0 + bu, gv0 + bv, 204 + k * 7);
          const dy = o.startsWith("cloud") ? -14 - t * 70 : o.startsWith("islet") ? -30 + t * 45 : 14 + t * 55;
          placed.push({ o, x: px, y: nr.p.y + dy, z: pz, fx: ux, fz: uz, v: hash(gu0 + bu, gv0 + bv, 205 + k * 7) });
        }
        continue;
      }
      // Streets along two sides of every block (where they don't cross the race).
      if (!sand && strip !== "beach" && strip !== "park" && !mix.wild) {
        for (const [a, b] of [[G(U, V), G(U + BLOCK, V)], [G(U, V), G(U, V + BLOCK)]]) {
          let ok = true;
          for (let k = 0; k <= 4 && ok; k++) {
            const px = a[0] + (b[0] - a[0]) * k / 4, pz = a[1] + (b[1] - a[1]) * k / 4;
            if (roadDist(road, px, pz, 14) < 12 || wetAt(px, pz)) ok = false;
          }
          if (ok) {
            streets.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1] });
            const [qx, qz] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            const along = [b[0] - a[0], b[1] - a[1]];
            const L = Math.sqrt(along[0] * along[0] + along[1] * along[1]);
            occ.box(qx, qz, along[0] / L, along[1] / L, STREET / 2, L / 2, 0, true);
          }
        }
      }
      // Buildings round the block's edge, shoulder to shoulder, each facing its street.
      const far = nr.d > 260;
      const h0 = STREET / 2 + 2, h1 = BLOCK - STREET / 2 - 2;
      const sides: [number, number, number, number, number, number][] = [
        // start u, v; tangent (du, dv); outward normal (nu, nv)
        [h0, h0, 1, 0, 0, -1], [h1, h0, 0, 1, 1, 0], [h1, h1, -1, 0, 0, 1], [h0, h1, 0, -1, -1, 0],
      ];
      let n = 0;
      for (const [su, sv, tu, tv, nu, nv] of sides) {
        const [fx, fz] = G(nu, nv), [tx, tz] = G(tu, tv);
        let w = 0;
        while (w < h1 - h0 - 4) {
          n++;
          const h1x = hash(gu0 + bu, gv0 + bv, 100 + n);
          let o = pick(mix.back, h1x);
          if (far && mix.tall && hash(gu0 + bu, gv0 + bv, 110 + n) < 0.6) o = pick(mix.tall, h1x);
          const d = kit[o];
          const depth = d.b + (d.front ?? 0);
          const [ex, ez] = G(U + su + tu * w, V + sv + tv * w);
          const px = ex - fx * depth + tx * d.a, pz = ez - fz * depth + tz * d.a;
          if (w + d.a * 2 <= h1 - h0 && put(o, px, pz, fx, fz, hash(gu0 + bu, gv0 + bv, 120 + n), 6, 0.3)) w += d.a * 2 + 1;
          else {
            // Something smaller in the space.
            const f = pick(mix.filler, hash(gu0 + bu, gv0 + bv, 130 + n));
            const fd = kit[f];
            if (fd) put(f, ex - fx * (fd.b + 1.5) + tx * (fd.a + 1), ez - fz * (fd.b + 1.5) + tz * (fd.a + 1), fx, fz, hash(gu0 + bu, gv0 + bv, 140 + n), 2, 0.3);
            w += 7;
          }
        }
      }
      // The courtyard in the middle: palms (or, in the wild, the whole block full of trees and rocks).
      const nIn = mix.scatter ?? 3, spread = mix.wild ? BLOCK - 8 : 16;
      for (let k = 0; k < nIn; k++) {
        // (The first three keep their old seeds so existing maps don't move.)
        const sd = k < 3 ? 160 + k : 400 + k * 3;
        const f = pick(mix.filler, hash(gu0 + bu, gv0 + bv, sd));
        const [px, pz] = G(U + BLOCK / 2 + (hash(gu0 + bu, gv0 + bv, sd + 1) - 0.5) * spread, V + BLOCK / 2 + (hash(gu0 + bu, gv0 + bv, sd + 2) - 0.5) * spread);
        if (kit[f]) put(f, px, pz, ux, uz, hash(gu0 + bu, gv0 + bv, 163 + k), 2, 0.3);
      }
    }
  }

  // ── The sea: boats moored and moving, out of reach ──
  if (sea !== undefined && kit.yacht) {
    for (let k = 0; k < 40; k++) {
      const p = main[Math.floor(hash(k, 1, 150) * (main.length - 1))];
      const out = 60 + hash(k, 2, 151) * 420;
      for (const side of [-1, 1]) {
        const [x, z] = at(p, side * out, 0);
        if (landAt(road.land, x, z).h > sea - 2) continue;
        placed.push({ o: hash(k, 3, 152) < 0.45 ? "yacht" : "sailboat", x, y: sea, z, fx: p.dx, fz: p.dz, v: hash(k, 4, 153) });
        break;
      }
    }
  }
  const res = { placed, streets, spurs, kit };
  cache.set(road, res);
  return res;
}

/** True when an object is part of the physics. */
export const isSolid = (c: Composed, o: string) => c.kit[o]?.solid !== false;

