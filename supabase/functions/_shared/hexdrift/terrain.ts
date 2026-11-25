// Copied from web/src/hexdrift by scripts/hexdrift-share.mjs. Don't edit here.
// The ground under and around the roads. One height function, used by both
// the physics (you can drive on it, slowly) and the renderer (what you see is
// what you hit). Roads sit on embankments that blend into rolling biome
// ground; gaps cut ravines whose bottom sends you back to the last checkpoint.
// Only + - * / and sqrt, so every device and the record checker agree exactly.
import { hash, noise } from "./math.ts";
export { hash };
import { roadTerrain } from "./road.ts";
import { CELL, CURVE_IN, CURVE_OUT, DIRV, HALF_W, heightAlong, local, type Piece, type Track } from "./track.ts";

/** How far the road surface sits above the ground right beside it. */
export const SHOULDER = 0.3;
/** Depth of the ground below the lowest road. */
export const FLOOR_DROP = 8;
/** Ravine bottoms are this far below the floor; touching one respawns you. */
export const RAVINE = 7;
/** Sky maps: islands under the road go this deep, then there's only sky. */
const ISLAND = 12;

const NONE = -1e9;

/** Distance from a point to a piece's road area (0 on the road). */
export function distTo(p: Piece, u: number, w: number) {
  if (p.t === "curveL" || p.t === "curveR") {
    const cu = p.t === "curveR" ? CELL / 2 : -CELL / 2;
    const du = u - cu, dw = w + CELL / 2;
    const rr = Math.sqrt(du * du + dw * dw);
    const dr = rr < CURVE_IN ? CURVE_IN - rr : rr > CURVE_OUT ? rr - CURVE_OUT : 0;
    const ou = Math.max(0, Math.abs(u) - CELL / 2), ow = Math.max(0, Math.abs(w) - CELL / 2);
    return Math.max(dr, Math.sqrt(ou * ou + ow * ow));
  }
  const du = Math.max(0, Math.abs(u) - HALF_W), dw = Math.max(0, Math.abs(w) - CELL / 2);
  return Math.sqrt(du * du + dw * dw);
}

export interface TerrainInfo {
  h: number; ravine: boolean;
  /** Road maps: top speed on this ground, and what it is (MAT in road.ts). */
  rough?: number; mat?: number;
}

/** Ground height at (x, z); h is very low where there's nothing (sky maps). */
export function terrainAt(track: Track, x: number, z: number): TerrainInfo {
  if (track.road) return roadTerrain(track.road, x, z);
  const cx = Math.round(x / CELL), cz = Math.round(z / CELL);
  const sky = track.sky === true;
  const bank = 0.4;
  let emb = NONE, ceil = 1e9, near = 1e9;
  for (let ox = -2; ox <= 2; ox++) {
    for (let oz = -2; oz <= 2; oz++) {
      const list = track.cells.get((cx + ox + 2048) * 4096 + (cz + oz + 2048));
      if (!list) continue;
      for (const p of list) {
        const { u, w } = local(p, x, z);
        const d = distTo(p, u, w);
        const top = heightAlong(p, w) - SHOULDER;
        // Sky islands: a grassy shoulder, then cliffs.
        const e = sky ? top - (d < 6 ? 0.08 * d : 0.48 + 1.6 * (d - 6)) : top - bank * d;
        if (e > emb) emb = e;
        if (d < near) near = d;
        if (d < 4 && top < ceil) ceil = top; // where roads cross, the lower one wins
      }
    }
  }
  let h: number;
  if (sky) {
    // Rocky islands under the road, with sky below.
    h = emb >= track.minY - ISLAND ? emb : NONE;
  } else {
    const floor = track.minY - FLOOR_DROP;
    const far = Math.max(0, Math.min(1, (near - 18) / 70));
    const hills = floor + (noise(x / 70, z / 70, 7) * 14 + noise(x / 23, z / 23, 3) * 3) * far;
    h = emb > hills ? emb : hills;
  }
  if (h > ceil) h = ceil;
  // Ravines under gaps.
  let ravine = false;
  if (!sky) {
    for (const g of track.gaps) {
      const dx = x - g.x * CELL, dz = z - g.z * CELL;
      const [fx, fz] = DIRV[g.d];
      const along = Math.abs(dx * fx + dz * fz), across = Math.abs(dx * fz - dz * fx);
      if (along < CELL / 2 - 1 && across < HALF_W + 14) {
        const edge = Math.max(0, Math.min(1, (CELL / 2 - 1 - along) / 4)) * Math.max(0, Math.min(1, (HALF_W + 14 - across) / 6));
        const bottom = track.minY - FLOOR_DROP - RAVINE;
        const cut = h + (bottom - h) * edge;
        if (cut < h) h = cut;
        if (edge > 0.6) ravine = true;
      }
    }
  }
  return { h, ravine };
}

export const NO_GROUND = NONE;
