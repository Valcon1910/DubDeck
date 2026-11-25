// Copied from web/src/hexdrift by scripts/hexdrift-share.mjs. Don't edit here.
// The phone editor's grid: track tiles on 32 m cells, 4 m height levels, each
// facing one of four ways (the way you drive through it). A tile's exit is the
// next tile's entry, so the track is the chain of tiles from the start tile.
// The chain becomes ordinary road pieces (custom.ts), so a grid map drives,
// checks and publishes exactly like any other.
import type { Piece } from "./custom.ts";

export const CELL = 32, LEVEL = 4;

export type TileKind = "start" | "straight" | "left" | "right" | "bigleft" | "bigright" | "up" | "down" | "jump" | "loop" | "boost" | "cp" | "finish";
export const TILE_KINDS: TileKind[] = ["start", "straight", "left", "right", "bigleft", "bigright", "up", "down", "jump", "loop", "boost", "cp", "finish"];

/** A tile: kind, entry cell (x, z), entry level y, and the way you drive into it (0 +z, 1 +x, 2 −z, 3 −x). */
export interface Tile { k: TileKind; x: number; z: number; y: number; d: 0 | 1 | 2 | 3 }

/** Forward per direction (yaw 0 is +z, 90° is +x). */
export const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const turn = (d: number, by: number) => (((d + by) % 4) + 4) % 4 as 0 | 1 | 2 | 3;
// Turning left raises the heading (+90°), right lowers it.
const LEFT = 1, RIGHT = 3;

export interface TileShape {
  /** Cells it covers: forward and left steps from its entry cell, and how many levels up. */
  cells: [number, number, number][];
  /** Where you leave: forward, left (cells), levels up, and the turn (0, 1 left, 3 right). */
  exit: [number, number, number, number];
  pieces: Piece[];
}

export const LOOP_R = 14;

export const SHAPES: Record<TileKind, TileShape> = {
  start: { cells: [[0, 0, 0]], exit: [1, 0, 0, 0], pieces: [{ k: "S", len: 32 }] },
  straight: { cells: [[0, 0, 0]], exit: [1, 0, 0, 0], pieces: [{ k: "S", len: 32 }] },
  boost: { cells: [[0, 0, 0]], exit: [1, 0, 0, 0], pieces: [{ k: "S", len: 32, boost: "A" }] },
  cp: { cells: [[0, 0, 0]], exit: [1, 0, 0, 0], pieces: [{ k: "S", len: 16 }, { k: "C" }, { k: "S", len: 16 }] },
  left: { cells: [[0, 0, 0]], exit: [0, 1, 0, LEFT], pieces: [{ k: "L", a: 90, r: 16 }] },
  right: { cells: [[0, 0, 0]], exit: [0, -1, 0, RIGHT], pieces: [{ k: "R", a: 90, r: 16 }] },
  bigleft: { cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], exit: [1, 2, 0, LEFT], pieces: [{ k: "L", a: 90, r: 48 }] },
  bigright: { cells: [[0, 0, 0], [1, 0, 0], [0, -1, 0], [1, -1, 0]], exit: [1, -2, 0, RIGHT], pieces: [{ k: "R", a: 90, r: 48 }] },
  up: { cells: [[0, 0, 0], [0, 0, 1]], exit: [1, 0, 1, 0], pieces: [{ k: "S", len: 32, rise: LEVEL }] },
  down: { cells: [[0, 0, 0], [0, 0, -1]], exit: [1, 0, -1, 0], pieces: [{ k: "S", len: 32, rise: -LEVEL }] },
  // A kicker, then a gap the length of a cell (land on the next tile).
  jump: { cells: [[0, 0, 0], [1, 0, 0]], exit: [2, 0, 0, 0], pieces: [{ k: "S", len: 32, ramp: 3 }, { k: "G", len: 32, rise: -3 }] },
  // A corkscrew loop: in on this lane, out on the lane to its right.
  loop: { cells: [[0, 0, 0], [0, -1, 0], [0, 0, 1], [0, -1, 1], [0, 0, 2], [0, -1, 2], [0, 0, 3], [0, -1, 3], [0, 0, 4], [0, -1, 4], [0, 0, 5], [0, -1, 5], [0, 0, 6], [0, -1, 6], [0, 0, 7], [0, -1, 7]],
    exit: [1, -1, 0, 0], pieces: [{ k: "S", len: 16 }, { k: "O", r: LOOP_R, off: CELL }, { k: "S", len: 16 }] },
  // The finish line, then room to stop.
  finish: { cells: [[0, 0, 0], [1, 0, 0]], exit: [2, 0, 0, 0], pieces: [{ k: "S", len: 16 }] },
};

export const TILE_NAMES: Record<TileKind, string> = {
  start: "Start", straight: "Straight", left: "Curve left", right: "Curve right", bigleft: "Wide left", bigright: "Wide right",
  up: "Slope up", down: "Slope down", jump: "Jump", loop: "Loop", boost: "Boost", cp: "Checkpoint", finish: "Finish",
};

/** A step `f` forward and `l` left of (x, z) facing d. */
export function stepFrom(x: number, z: number, d: number, f: number, l: number): [number, number] {
  const [fx, fz] = DIRS[d], [lx, lz] = DIRS[turn(d, LEFT)];
  return [x + fx * f + lx * l, z + fz * f + lz * l];
}

/** The cells (x, z, level) a tile covers. */
export function cellsOf(t: Tile): [number, number, number][] {
  return SHAPES[t.k].cells.map(([f, l, up]) => [...stepFrom(t.x, t.z, t.d, f, l), t.y + up]);
}

/** Where the next tile starts: its cell, level and heading. */
export function exitOf(t: Tile): Tile {
  const [f, l, up, tn] = SHAPES[t.k].exit;
  const [x, z] = stepFrom(t.x, t.z, t.d, f, l);
  return { k: "straight", x, z, y: t.y + up, d: turn(t.d, tn) };
}

export interface Chain {
  /** Indices of the tiles from the start, in driving order (ends at the finish, or where it breaks). */
  order: number[];
  /** Tiles not on the way from start to finish. */
  loose: number[];
  /** Tiles that share a cell with another. */
  clash: number[];
  done: boolean;
  problems: string[];
}

const cellKey = (x: number, z: number, y: number) => `${x},${z},${y}`;

/** Follows the track from the start tile. */
export function chainOf(tiles: Tile[]): Chain {
  const problems: string[] = [];
  const starts = tiles.flatMap((t, i) => (t.k === "start" ? [i] : []));
  // Who covers each cell (a tile needs two levels of headroom over the one below).
  const cover = new Map<string, number[]>();
  tiles.forEach((t, i) => {
    for (const [x, z, y] of cellsOf(t)) {
      for (const yy of [y, y + 1]) {
        const k = cellKey(x, z, yy), l = cover.get(k);
        if (l) { if (!l.includes(i)) l.push(i); } else cover.set(k, [i]);
      }
    }
  });
  const clash = new Set<number>();
  for (const l of cover.values()) if (l.length > 1) for (const i of l) clash.add(i);
  const order: number[] = [];
  let done = false;
  if (starts.length !== 1) problems.push(starts.length ? "Only one start tile." : "Place a start tile.");
  else {
    const at = new Map<string, number>();
    tiles.forEach((t, i) => at.set(`${t.x},${t.z},${t.y},${t.d}`, i));
    let i = starts[0];
    const seen = new Set<number>();
    while (!seen.has(i)) {
      seen.add(i);
      order.push(i);
      if (tiles[i].k === "finish") { done = true; break; }
      const e = exitOf(tiles[i]);
      const next = at.get(`${e.x},${e.z},${e.y},${e.d}`);
      if (next === undefined || tiles[next].k === "start") break;
      i = next;
    }
    if (!done) problems.push("The track doesn't reach a finish tile yet.");
  }
  if (clash.size) problems.push("Some tiles sit in the same place.");
  const on = new Set(order);
  const loose = tiles.map((_t, i) => i).filter((i) => !on.has(i));
  return { order, loose, clash: [...clash], done, problems };
}

/** The chain as road pieces (and which tile each piece came from). */
export function piecesOfGrid(tiles: Tile[], chain = chainOf(tiles)): { pieces: Piece[]; from: number[] } {
  const pieces: Piece[] = [], from: number[] = [];
  for (const i of chain.order) for (const p of SHAPES[tiles[i].k].pieces) { pieces.push({ ...p }); from.push(i); }
  return { pieces, from };
}

/** The road's start: x, z, height above the theme's base, heading (degrees). */
export function gridStart(tiles: Tile[]): [number, number, number, number] | null {
  const s = tiles.find((t) => t.k === "start");
  if (!s) return null;
  const [fx, fz] = DIRS[s.d];
  return [s.x * CELL - fx * CELL / 2, s.z * CELL - fz * CELL / 2, s.y * LEVEL, s.d * 90];
}

/** A short track to start from: start, a few straights, a curve, a checkpoint and the finish. */
export function starterGrid(): Tile[] {
  const t: Tile[] = [{ k: "start", x: 0, z: 0, y: 0, d: 0 }];
  const add = (k: TileKind) => { const e = exitOf(t[t.length - 1]); t.push({ k, x: e.x, z: e.z, y: e.y, d: e.d }); };
  add("straight"); add("straight"); add("bigright"); add("cp"); add("straight"); add("finish");
  return t;
}

/** Keeps only valid tiles (from storage, a share code or the network). */
export function cleanGrid(raw: unknown): Tile[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Tile[] = [];
  for (const q of raw.slice(0, 400)) {
    if (!q || typeof q !== "object") continue;
    const r = q as Record<string, unknown>;
    const int = (v: unknown, lim: number) => typeof v === "number" && Number.isInteger(v) && v >= -lim && v <= lim;
    if (!TILE_KINDS.includes(r.k as TileKind) || !int(r.x, 200) || !int(r.z, 200) || !int(r.y, 40) || !(r.d === 0 || r.d === 1 || r.d === 2 || r.d === 3)) continue;
    out.push({ k: r.k as TileKind, x: r.x as number, z: r.z as number, y: r.y as number, d: r.d as Tile["d"] });
  }
  return out;
}

/** Metres of run-up a loop needs (from a standing start, as at the start line). */
const RUNUP = 120;
const LEN: Partial<Record<TileKind, number>> = { start: 72, straight: 32, cp: 32, up: 32, down: 32, jump: 64, bigleft: 75, bigright: 75, finish: 64 };

/** Loops on the track that the car may not get round: too little straight road before them and no boost. */
export function slowLoops(tiles: Tile[], chain = chainOf(tiles)): number[] {
  const out: number[] = [];
  chain.order.forEach((ti, n) => {
    if (tiles[ti].k !== "loop") return;
    let run = 0;
    for (let j = n - 1; j >= 0; j--) {
      const k = tiles[chain.order[j]].k;
      if (k === "boost") { run = RUNUP; break; }
      const l = LEN[k];
      if (l === undefined) break; // a tight curve or another loop
      run += l;
      if (run >= RUNUP) break;
    }
    if (run < RUNUP) out.push(ti);
  });
  return out;
}
