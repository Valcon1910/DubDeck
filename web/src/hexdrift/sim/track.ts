// Tracks are made of pieces on a grid (one piece per cell and height level).
// The same format will be used by the map editor. Each piece answers "how
// high is the road here?" exactly (no triangle meshes), which keeps the
// physics fast and identical everywhere.

import { dcos, dsin } from "./math.ts";

export const CELL = 20; // size of a grid cell
export const HALF_W = 7; // half the road width
export const LEVEL = 4; // height of one slope
export const RAMP_RISE = 3; // how high a jump ramp lifts the car
export const CURVE_IN = 3; // inner and outer radius of a curve's road
export const CURVE_OUT = 17;

export type PieceType = "start" | "straight" | "checkpoint" | "finish" | "boost" | "curveL" | "curveR" | "up" | "down" | "ramp";
export type Dir = 0 | 1 | 2 | 3;

export interface Piece {
  t: PieceType;
  x: number; // cell
  z: number;
  y: number; // height level at the entry
  d: Dir; // direction the road runs: 0 +z, 1 -x (right of +z), 2 -z, 3 +x
  wall?: boolean;
  ice?: boolean;
  cp?: number; // checkpoint number
}

/** Unit vectors (x, z) of the four directions. Right of d is d + 1. */
export const DIRV: readonly (readonly [number, number])[] = [[0, 1], [-1, 0], [0, -1], [1, 0]];
export const yawOf = (d: Dir) => -d * (Math.PI / 2);

export interface Track {
  pieces: Piece[]; // in driving order (start first)
  cells: Map<number, Piece[]>;
  checkpoints: number;
  minY: number;
  start: Piece;
  /** Points along the middle of the road, in order, about 5 units apart. */
  line: { x: number; y: number; z: number }[];
}

const key = (x: number, z: number) => (x + 2048) * 4096 + (z + 2048);

/** Where a point sits in a piece's own frame: u to the right, w forward. */
export function local(p: Piece, px: number, pz: number) {
  const [fx, fz] = DIRV[p.d];
  const [rx, rz] = DIRV[(p.d + 1) % 4];
  const dx = px - p.x * CELL;
  const dz = pz - p.z * CELL;
  return { u: dx * rx + dz * rz, w: dx * fx + dz * fz };
}

/** Road height at (u, w) in the piece, or NaN when there's no road there. */
export function surface(p: Piece, u: number, w: number): number {
  if (w < -CELL / 2 || w > CELL / 2 || u < -CELL / 2 || u > CELL / 2) return NaN;
  const base = p.y * LEVEL;
  if (p.t === "curveL" || p.t === "curveR") {
    const cu = p.t === "curveR" ? CELL / 2 : -CELL / 2;
    const du = u - cu, dw = w + CELL / 2;
    const r2 = du * du + dw * dw;
    return r2 >= CURVE_IN * CURVE_IN && r2 <= CURVE_OUT * CURVE_OUT ? base : NaN;
  }
  if (u < -HALF_W || u > HALF_W) return NaN;
  const t = (w + CELL / 2) / CELL;
  if (p.t === "up") return base + t * LEVEL;
  if (p.t === "down") return base - t * LEVEL;
  if (p.t === "ramp") return base + t * RAMP_RISE;
  return base;
}

/** Rise per unit forward (0 on flat pieces). */
export function slope(p: Piece) {
  return p.t === "up" ? LEVEL / CELL : p.t === "down" ? -LEVEL / CELL : p.t === "ramp" ? RAMP_RISE / CELL : 0;
}

export interface Ground { h: number; piece: Piece; nx: number; ny: number; nz: number }

/** The highest road under (px, pz) that isn't more than `reach` above py. */
export function groundAt(track: Track, px: number, py: number, pz: number, reach = 1): Ground | null {
  const list = track.cells.get(key(Math.round(px / CELL), Math.round(pz / CELL)));
  if (!list) return null;
  let best: Ground | null = null;
  for (const p of list) {
    const { u, w } = local(p, px, pz);
    const h = surface(p, u, w);
    if (h !== h || h > py + reach || (best && h <= best.h)) continue;
    const k = slope(p);
    const [fx, fz] = DIRV[p.d];
    const n = 1 / Math.sqrt(1 + k * k);
    best = { h, piece: p, nx: -k * fx * n, ny: n, nz: -k * fz * n };
  }
  return best;
}

// ── Building a track from a short recipe ────────────────────────────────────
//
// Tokens, driven like a turtle from the start line:
//   S straight  B boost  C checkpoint  L / R curve  U / D slope up / down
//   J jump ramp  G gap (empty cell)  F finish
//   W+ / W- walls on / off   I+ / I- ice on / off
// A number repeats the token: "S3" = three straights.

export function buildTrack(recipe: string): Track {
  const pieces: Piece[] = [];
  let x = 0, z = 0, y = 0;
  let d: Dir = 0;
  let wall = false, ice = false, cp = 0;
  const line: Track["line"] = [];
  const add = (t: PieceType) => {
    const p: Piece = { t, x, z, y, d };
    if (wall) p.wall = true;
    if (ice) p.ice = true;
    if (t === "checkpoint") p.cp = cp++;
    pieces.push(p);
    return p;
  };
  const step = () => { x += DIRV[d][0]; z += DIRV[d][1]; };

  add("start");
  centre(pieces[0], line);
  step();
  for (const tok of recipe.trim().split(/\s+/)) {
    const m = tok.match(/^([A-Z])([+-]?)(\d*)$/);
    if (!m) throw new Error(`Bad track token ${tok}`);
    const [, c, sign, n] = m;
    if (c === "W") { wall = sign !== "-"; continue; }
    if (c === "I") { ice = sign !== "-"; continue; }
    for (let i = 0; i < (Number(n) || 1); i++) {
      const t = ({ S: "straight", B: "boost", C: "checkpoint", F: "finish", L: "curveL", R: "curveR", U: "up", D: "down", J: "ramp" } as Record<string, PieceType>)[c];
      if (c === "G") {
        line.push(...gapLine(x, z, y, d));
        step();
        continue;
      }
      if (!t) throw new Error(`Bad track token ${tok}`);
      const p = add(t);
      centre(p, line);
      if (t === "up") y++;
      if (t === "down") y--;
      if (t === "curveR") d = ((d + 1) % 4) as Dir;
      if (t === "curveL") d = ((d + 3) % 4) as Dir;
      step();
    }
  }
  const cells = new Map<number, Piece[]>();
  for (const p of pieces) {
    const k = key(p.x, p.z);
    cells.set(k, [...(cells.get(k) ?? []), p]);
  }
  return {
    pieces, cells, checkpoints: cp, start: pieces[0], line,
    minY: Math.min(...pieces.map((p) => p.y * LEVEL - (p.t === "down" ? LEVEL : 0))),
  };
}

/** Points along a piece's middle line, entry to exit. */
function centre(p: Piece, out: Track["line"]) {
  const [fx, fz] = DIRV[p.d];
  const [rx, rz] = DIRV[(p.d + 1) % 4];
  const cx = p.x * CELL, cz = p.z * CELL;
  const at = (u: number, w: number) => ({ x: cx + rx * u + fx * w, z: cz + rz * u + fz * w });
  if (p.t === "curveL" || p.t === "curveR") {
    const s = p.t === "curveR" ? 1 : -1;
    for (let i = 0; i < 4; i++) {
      const a = ((i + 0.5) / 4) * (Math.PI / 2);
      const q = at(s * (CELL / 2 - dcos(a) * (CELL / 2)), -CELL / 2 + dsin(a) * (CELL / 2));
      out.push({ ...q, y: p.y * LEVEL });
    }
    return;
  }
  for (let i = 0; i < 4; i++) {
    const w = -CELL / 2 + ((i + 0.5) / 4) * CELL;
    const q = at(0, w);
    out.push({ ...q, y: surface(p, 0, w) });
  }
}

function gapLine(x: number, z: number, y: number, d: Dir) {
  const [fx, fz] = DIRV[d];
  return [0, 1, 2, 3].map((i) => {
    const w = -CELL / 2 + ((i + 0.5) / 4) * CELL;
    return { x: x * CELL + fx * w, y: y * LEVEL, z: z * CELL + fz * w };
  });
}
