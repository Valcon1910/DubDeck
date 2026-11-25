// Copied from web/src/hexdrift by scripts/hexdrift-share.mjs. Don't edit here.
// Solid things around the roads: the scenery (towers, buttes, icebergs,
// dunes) and the props beside the road (grandstands, parked cars, rocks,
// trees). They're part of the physics, so a car that leaves the road hits
// them the same way on every device and in the record checker.
//
// Their layout comes only from the track (a hash of grid cells and piece
// numbers), so it's the same every time. Shapes are kept simple to test:
// boxes square to the grid, or upright ellipses (circles mostly).
// Only + - * / and sqrt (and Math.imul in the hash).
import { CELL, CURVE_OUT, DIRV, HALF_W, key, local, type Track } from "./track.ts";
import { distTo, hash, NO_GROUND, terrainAt } from "./terrain.ts";
import { GAP, roadDist, WALL_T, WL, WR, type Sample } from "./road.ts";

export type SolidKind = "tower" | "butte" | "berg" | "dune" | "stand" | "parked" | "rock" | "pine" | "palm" | "hotel" | "chalet" | "pylon";

export interface Solid {
  kind: SolidKind;
  x: number; z: number;
  /** Bottom and top (a car above the top passes over it). */
  y: number; top: number;
  /** Half sizes along x and z (box), or the radii (ellipse). */
  a: number; b: number;
  box: boolean;
  /** Direction it faces (0..3, as road directions), for drawing. */
  d: number;
  /** 0..1, a random number for its looks (colour, shape). */
  v: number;
  /**
   * Road maps: the way a box faces (unit), when it isn't square to the grid.
   * a is then the half size across (local x), b along (local z).
   */
  fx?: number; fz?: number;
}

export interface Props {
  list: Solid[];
  /** The solids that reach into each grid cell (padded by a car's size). */
  cells: Map<number, Solid[]>;
}

const cache = new WeakMap<Track, Props>();

/** True when nothing of the road comes within r of (x, z), and it isn't over a ravine. */
export function roadClear(track: Track, x: number, z: number, r: number): boolean {
  if (track.road) return roadDist(track.road, x, z, r + 1) >= r && !terrainAt(track, x, z).ravine;
  const cx = Math.round(x / CELL), cz = Math.round(z / CELL);
  for (let ox = -2; ox <= 2; ox++) {
    for (let oz = -2; oz <= 2; oz++) {
      const list = track.cells.get(key(cx + ox, cz + oz));
      if (!list) continue;
      for (const p of list) {
        const { u, w } = local(p, x, z);
        if (distTo(p, u, w) < r) return false;
      }
    }
  }
  for (const g of track.gaps) {
    const dx = x - g.x * CELL, dz = z - g.z * CELL;
    const [fx, fz] = DIRV[g.d];
    const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
    const al = along < 0 ? -along : along, ac = across < 0 ? -across : across;
    if (al < CELL / 2 + r && ac < HALF_W + 14 + r) return false;
  }
  return true;
}

/** The track's solids (worked out once per track). */
export function propsOf(track: Track): Props {
  const have = cache.get(track);
  if (have) return have;
  if (track.road) {
    const res = roadProps(track);
    cache.set(track, res);
    return res;
  }
  const list: Solid[] = [];
  const theme = track.theme ?? "city";
  const add = (s: Solid) => {
    if (s.box && (s.kind === "stand" || s.kind === "parked")) {
      // Close to the road: check the whole box, a little at a time.
      const nx = Math.floor(s.a) + 1, nz = Math.floor(s.b) + 1;
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
        if (!roadClear(track, s.x - s.a + (2 * s.a * i) / nx, s.z - s.b + (2 * s.b * j) / nz, 1.6)) return;
      }
    } else {
      const reach = s.box ? Math.sqrt(s.a * s.a + s.b * s.b) : s.a > s.b ? s.a : s.b;
      if (!roadClear(track, s.x, s.z, reach + 1.2)) return;
    }
    const g = terrainAt(track, s.x, s.z).h;
    if (g <= NO_GROUND) return;
    const h = s.top;
    s.y = g - 0.5; s.top = g + h;
    list.push(s);
  };

  // ── Scenery, one or none per grid cell, never next to a road ──
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  const used = new Set<number>();
  for (const p of track.pieces) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.z < z0) z0 = p.z;
    if (p.z > z1) z1 = p.z;
    used.add(key(p.x, p.z));
  }
  const near = (x: number, z: number) => {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (used.has(key(x + dx, z + dz))) return true;
    return false;
  };
  const R = 9;
  if (theme !== "sky") {
    const dense = theme === "city" ? 0.55 : 0.3;
    for (let x = x0 - R; x <= x1 + R; x++) {
      for (let z = z0 - R; z <= z1 + R; z++) {
        if (near(x, z) || hash(x, z, 11) > dense) continue;
        const px = x * CELL + (hash(x, z, 12) - 0.5) * CELL * 0.6;
        const pz = z * CELL + (hash(x, z, 13) - 0.5) * CELL * 0.6;
        const r1 = hash(x, z, 14), r2 = hash(x, z, 15), v = hash(x, z, 16);
        if (theme === "city") {
          const w = 3 + r1 * 4.5;
          add({ kind: "tower", x: px, z: pz, y: 0, top: 30 + r2 * 70, a: w, b: w * (0.7 + v * 0.6), box: true, d: 0, v });
        } else if (theme === "canyon") {
          const w = 5 + r1 * 9;
          add({ kind: "butte", x: px, z: pz, y: 0, top: 25 + r2 * 45, a: w * 0.92, b: w * 0.92, box: false, d: 0, v });
        } else if (theme === "glacier") {
          const w = 3 + r1 * 6;
          add({ kind: "berg", x: px, z: pz, y: 0, top: 18 + r2 * 40, a: w * 0.85, b: w * 0.85, box: false, d: 0, v });
        } else {
          const w = 8 + r1 * 10;
          const long = v < 0.5;
          add({ kind: "dune", x: px, z: pz, y: 0, top: w * 0.35, a: long ? w * 1.5 : w, b: long ? w : w * 1.5, box: false, d: long ? 1 : 0, v });
        }
      }
    }
  }

  // ── Beside the road ──
  track.pieces.forEach((p, i) => {
    const [fx, fz] = DIRV[p.d];
    const [rx, rz] = DIRV[(p.d + 1) % 4];
    const cx = p.x * CELL, cz = p.z * CELL;
    const along = p.d === 0 || p.d === 2; // the road runs along z
    // Grandstands at the start and the finish.
    if ((p.t === "start" || p.t === "finish") && theme !== "sky") {
      for (const s of [-1, 1]) {
        const off = HALF_W + 2.5 + 3.2;
        const a = along ? 3.2 : 8.5, b = along ? 8.5 : 3.2;
        add({ kind: "stand", x: cx + rx * s * off, z: cz + rz * s * off, y: 0, top: 6.5, a, b, box: true, d: (p.d + (s > 0 ? 3 : 1)) % 4, v: hash(i, s, 20) });
      }
      return;
    }
    if (p.t === "curveL" || p.t === "curveR") {
      // Outside the bend, where a car runs wide.
      if (hash(i, 0, 21) > 0.55) return;
      const sgn = p.t === "curveR" ? 1 : -1;
      const ccu = sgn * (CELL / 2), ccw = -CELL / 2; // the bend's centre (u, w)
      const rr = CURVE_OUT + 3 + hash(i, 0, 22) * 3;
      const du = -sgn * 0.7071 * rr, dw = 0.7071 * rr;
      const u = ccu + du, w = ccw + dw;
      solidAt(theme, cx + rx * u + fx * w, cz + rz * u + fz * w, p.d, hash(i, 0, 23), add);
      return;
    }
    for (const s of [-1, 1]) {
      if (hash(i, s, 24) > 0.42) continue;
      const off = HALF_W + 3.5 + hash(i, s, 25) * 6;
      const w = (hash(i, s, 26) - 0.5) * 12;
      solidAt(theme, cx + rx * s * off + fx * w, cz + rz * s * off + fz * w, p.d, hash(i, s, 27), add);
    }
  });

  const res = { list, cells: cellsOf(list) };
  cache.set(track, res);
  return res;
}

function cellsOf(list: Solid[]): Map<number, Solid[]> {
  const cells = new Map<number, Solid[]>();
  const pad = 2;
  for (const s of list) {
    const turned = s.fx !== undefined ? Math.sqrt(s.a * s.a + s.b * s.b) : 0;
    const ax = (turned > 0 ? turned : s.a) + pad, bz = (turned > 0 ? turned : s.b) + pad;
    const i0 = Math.round((s.x - ax) / CELL), i1 = Math.round((s.x + ax) / CELL);
    const j0 = Math.round((s.z - bz) / CELL), j1 = Math.round((s.z + bz) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        const l = cells.get(k);
        if (l) l.push(s); else cells.set(k, [s]);
      }
    }
  }
  return cells;
}

// ── Road maps ───────────────────────────────────────────────────────────────

/** How each setting dresses its roads (kinds near the road, scenery further out). */
const ROAD_DRESS: Record<string, { near: SolidKind[]; nearP: number; far: SolidKind[]; farP: number; parked: number; stands: boolean }> = {
  miami: { near: ["palm", "palm", "palm"], nearP: 0.5, far: ["hotel", "hotel", "palm", "palm"], farP: 0.55, parked: 0.12, stands: true },
  storm: { near: ["palm", "parked", "parked"], nearP: 0.45, far: ["tower", "tower", "tower", "hotel"], farP: 0.75, parked: 0.3, stands: true },
  alpine: { near: ["pine", "pine", "rock"], nearP: 0.5, far: ["pine", "pine", "pine", "rock", "chalet"], farP: 0.6, parked: 0, stands: true },
  baja: { near: ["rock", "rock", "palm"], nearP: 0.22, far: ["butte", "rock", "rock", "dune"], farP: 0.32, parked: 0, stands: true },
  sky: { near: ["pine", "palm", "rock"], nearP: 0.35, far: ["pine", "pine", "rock"], farP: 0.5, parked: 0, stands: true },
  space: { near: ["pylon"], nearP: 0.0, far: [], farP: 0, parked: 0, stands: false },
};

/** One solid of a kind at (x, z), facing (fx, fz), with random v. */
function roadSolid(kind: SolidKind, x: number, z: number, fx: number, fz: number, v: number, w: number): Solid {
  switch (kind) {
    case "hotel": {
      const a = 7 + w * 7, b = 6 + v * 5;
      return { kind, x, z, y: 0, top: 22 + v * 46, a, b, box: true, d: 0, v, fx, fz };
    }
    case "tower": {
      const a = 5 + w * 6;
      return { kind, x, z, y: 0, top: 34 + v * 80, a, b: a * (0.7 + v * 0.5), box: true, d: 0, v, fx, fz };
    }
    case "chalet": return { kind, x, z, y: 0, top: 7.5, a: 4.5, b: 5.5, box: true, d: 0, v, fx, fz };
    case "parked": return { kind, x, z, y: 0, top: 1.5, a: 1.05, b: 2.25, box: true, d: 0, v, fx, fz };
    case "butte": { const r = 9 + w * 14; return { kind, x, z, y: 0, top: 22 + v * 40, a: r, b: r * (0.8 + v * 0.3), box: false, d: 0, v }; }
    case "dune": { const r = 10 + w * 10; return { kind, x, z, y: 0, top: r * 0.3, a: r * 1.4, b: r, box: false, d: 0, v }; }
    case "rock": { const r = 1.3 + w * 2.2; return { kind, x, z, y: 0, top: r * 1.2, a: r, b: r, box: false, d: 0, v }; }
    case "pine": return { kind, x, z, y: 0, top: 9 + v * 7, a: 0.6, b: 0.6, box: false, d: 0, v };
    case "palm": return { kind, x, z, y: 0, top: 8 + v * 4, a: 0.5, b: 0.5, box: false, d: 0, v };
    case "pylon": return { kind, x, z, y: 0, top: 6, a: 0.6, b: 0.6, box: false, d: 0, v };
    default: return { kind, x, z, y: 0, top: 6, a: 1, b: 1, box: false, d: 0, v };
  }
}

/** Solids of a road map: along every road and across the land round it. */
function roadProps(track: Track): Props {
  const road = track.road!;
  const list: Solid[] = [];
  const dress = ROAD_DRESS[track.theme ?? ""] ?? ROAD_DRESS.alpine;
  const sea = road.land.sea;
  const reachOf = (s: Solid) => (s.box ? Math.sqrt(s.a * s.a + s.b * s.b) : s.a > s.b ? s.a : s.b);
  const clearOf = (s: Solid, gap: number) => {
    if (s.box && s.fx !== undefined && s.fz !== undefined) {
      // Corners and edge midpoints of the box.
      const rx = s.fz, rz = -s.fx;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const px = s.x + rx * s.a * i + s.fx * s.b * j, pz = s.z + rz * s.a * i + s.fz * s.b * j;
        if (roadDist(road, px, pz, gap + 1) < gap) return false;
      }
      return roadDist(road, s.x, s.z, gap + 1) >= gap;
    }
    const r = reachOf(s);
    return roadDist(road, s.x, s.z, r + gap + 1) >= r + gap;
  };
  const add = (s: Solid, gap: number) => {
    if (!clearOf(s, gap)) return;
    const t = terrainAt(track, s.x, s.z);
    if (t.h <= NO_GROUND || t.ravine) return;
    if (sea !== undefined && t.h < sea + 0.4) return;
    for (const o of list) {
      const dx = o.x - s.x, dz = o.z - s.z, rr = reachOf(o) + reachOf(s) * 0.8;
      if (dx * dx + dz * dz < rr * rr) return;
    }
    const h = s.top;
    s.y = t.h - 0.5; s.top = t.h + h;
    list.push(s);
  };
  const pick = (k: SolidKind[], v: number) => k[Math.floor(v * k.length) % k.length];

  // Grandstands facing the start and the finish.
  if (dress.stands) {
    const main = road.strands[0].pts;
    const spots: Sample[] = [main[2]];
    let fi = 0, fd = 1e18;
    for (let i = 0; i < main.length; i++) {
      const dx = main[i].x - road.finish.x, dz = main[i].z - road.finish.z;
      if (dx * dx + dz * dz < fd) { fd = dx * dx + dz * dz; fi = i; }
    }
    spots.push(main[fi]);
    spots.forEach((p, n) => {
      for (const sd of [-1, 1]) {
        const walled = (p.flags & (sd < 0 ? WL : WR)) !== 0;
        for (const off of [-12, 12]) {
          const o = p.hw + (walled ? WALL_T : 0) + 2.6 + 3.2;
          const x = p.x - p.dz * sd * o + p.dx * off, z = p.z + p.dx * sd * o + p.dz * off;
          // Faces the road: local +z points back across it.
          add({ kind: "stand", x, z, y: 0, top: 6.5, a: 8.5, b: 3.2, box: true, d: 0, v: hash(n, sd, 20), fx: p.dz * sd, fz: -p.dx * sd }, 1.2);
        }
      }
    });
  }

  // Beside the roads, every 14 m or so on each side.
  road.strands.forEach((st, si) => {
    const pts = st.pts;
    for (let i = 4; i < pts.length - 4; i += 6) {
      const p = pts[i];
      if (p.flags & GAP) continue;
      for (const sd of [-1, 1]) {
        const r1 = hash(si * 4099 + i, sd, 31), r2 = hash(si * 4099 + i, sd, 32), r3 = hash(si * 4099 + i, sd, 33);
        const walled = (p.flags & (sd < 0 ? WL : WR)) !== 0;
        const edge = p.hw + (walled ? WALL_T : 0);
        if (r1 < dress.parked) {
          // A parked car along the kerb, lined up with the road.
          const o = edge + 2.4;
          add(roadSolid("parked", p.x - p.dz * sd * o, p.z + p.dx * sd * o, p.dx, p.dz, r2, r3), 1.0);
          continue;
        }
        if (r1 > dress.nearP || !dress.near.length) continue;
        const k = pick(dress.near, r2);
        const o = edge + 4 + r3 * 9;
        add(roadSolid(k, p.x - p.dz * sd * o + p.dx * (r2 - 0.5) * 8, p.z + p.dx * sd * o + p.dz * (r2 - 0.5) * 8, p.dx, p.dz, r3, r2), 2.2);
      }
    }
  });

  // Scenery across the land, never close to a road.
  if (dress.far.length) {
    const C = 26;
    const i0 = Math.floor((road.x0 - 240) / C), i1 = Math.floor((road.x1 + 240) / C);
    const j0 = Math.floor((road.z0 - 240) / C), j1 = Math.floor((road.z1 + 240) / C);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        if (hash(i, j, 41) > dress.farP) continue;
        const x = (i + 0.2 + hash(i, j, 42) * 0.6) * C, z = (j + 0.2 + hash(i, j, 43) * 0.6) * C;
        const v = hash(i, j, 44), w = hash(i, j, 45);
        const k = pick(dress.far, hash(i, j, 46));
        // Big buildings face the nearest road (they line the streets).
        let fx = 0, fz = 1;
        if (k === "hotel" || k === "tower" || k === "chalet") {
          const a = hash(i, j, 47);
          // Square to the main road's start heading, with some turned.
          const s0 = road.strands[0].pts[0];
          fx = a < 0.5 ? s0.dx : s0.dz; fz = a < 0.5 ? s0.dz : -s0.dx;
        }
        add(roadSolid(k, x, z, fx, fz, v, w), k === "hotel" || k === "tower" ? 7 : 4);
      }
    }
  }
  return { list, cells: cellsOf(list) };
}

/** One prop beside the road for this setting. */
function solidAt(theme: string, x: number, z: number, d: number, v: number, add: (s: Solid) => void) {
  const along = d === 0 || d === 2;
  if (theme === "city") {
    // A parked car, lined up with the road.
    add({ kind: "parked", x, z, y: 0, top: 1.5, a: along ? 1.05 : 2.25, b: along ? 2.25 : 1.05, box: true, d, v });
  } else if (theme === "canyon" || (theme === "desert" && v < 0.35)) {
    const r = 1.3 + v * 1.6;
    add({ kind: "rock", x, z, y: 0, top: r * 1.2, a: r, b: r, box: false, d, v });
  } else if (theme === "glacier") {
    add({ kind: "pine", x, z, y: 0, top: 8 + v * 5, a: 0.6, b: 0.6, box: false, d, v });
  } else if (theme === "desert") {
    add({ kind: "palm", x, z, y: 0, top: 8 + v * 3, a: 0.5, b: 0.5, box: false, d, v });
  }
}

/**
 * Pushes the car (a circle of radius cr, from y to y + ch) out of any solid
 * it's in. Returns how hard it hit (speed into the solid), or 0.
 */
export function hitSolids(track: Track, car: { x: number; y: number; z: number; vx: number; vz: number }, cr: number, ch: number): number {
  const list = propsOf(track).cells.get(key(Math.round(car.x / CELL), Math.round(car.z / CELL)));
  if (!list) return 0;
  let hard = 0;
  for (const s of list) {
    if (car.y >= s.top || car.y + ch <= s.y) continue;
    const dx = car.x - s.x, dz = car.z - s.z;
    let nx = 0, nz = 0;
    if (s.box && s.fx !== undefined && s.fz !== undefined) {
      // A box turned to face (fx, fz): work in its own frame.
      const ux = s.fz, uz = -s.fx;
      const lx = dx * ux + dz * uz, lz = dx * s.fx + dz * s.fz;
      const qx = lx < -s.a ? -s.a : lx > s.a ? s.a : lx;
      const qz = lz < -s.b ? -s.b : lz > s.b ? s.b : lz;
      const ex = lx - qx, ez = lz - qz;
      const dd = ex * ex + ez * ez;
      if (dd >= cr * cr) continue;
      let ox = 0, oz = 0, push = 0;
      if (dd > 1e-9) {
        const d = Math.sqrt(dd);
        ox = ex / d; oz = ez / d; push = cr - d;
      } else {
        const px = s.a - (lx < 0 ? -lx : lx), pz = s.b - (lz < 0 ? -lz : lz);
        if (px < pz) { ox = lx < 0 ? -1 : 1; push = px + cr; }
        else { oz = lz < 0 ? -1 : 1; push = pz + cr; }
      }
      nx = ox * ux + oz * s.fx; nz = ox * uz + oz * s.fz;
      car.x += nx * push; car.z += nz * push;
    } else if (s.box) {
      // Closest point of the box to the car's centre.
      const qx = dx < -s.a ? -s.a : dx > s.a ? s.a : dx;
      const qz = dz < -s.b ? -s.b : dz > s.b ? s.b : dz;
      const ex = dx - qx, ez = dz - qz;
      const dd = ex * ex + ez * ez;
      if (dd >= cr * cr) continue;
      if (dd > 1e-9) {
        const d = Math.sqrt(dd);
        nx = ex / d; nz = ez / d;
        car.x += nx * (cr - d); car.z += nz * (cr - d);
      } else {
        // Centre inside the box: out through the nearest side.
        const px = s.a - (dx < 0 ? -dx : dx), pz = s.b - (dz < 0 ? -dz : dz);
        if (px < pz) { nx = dx < 0 ? -1 : 1; car.x = s.x + nx * (s.a + cr); }
        else { nz = dz < 0 ? -1 : 1; car.z = s.z + nz * (s.b + cr); }
      }
    } else {
      const A = s.a + cr, B = s.b + cr;
      const ux = dx / A, uz = dz / B;
      const q2 = ux * ux + uz * uz;
      if (q2 >= 1) continue;
      const q = Math.sqrt(q2);
      if (q < 1e-6) { nx = 1; car.x = s.x + A; }
      else {
        // Out to the edge along the line from the centre; bounce off the surface's normal.
        car.x = s.x + dx / q; car.z = s.z + dz / q;
        const gx = dx / (A * A), gz = dz / (B * B);
        const gl = Math.sqrt(gx * gx + gz * gz);
        nx = gx / gl; nz = gz / gl;
      }
    }
    const vin = car.vx * nx + car.vz * nz;
    if (vin < 0) {
      car.vx -= nx * vin * 1.3; car.vz -= nz * vin * 1.3;
      car.vx *= 0.9; car.vz *= 0.9;
      if (-vin > hard) hard = -vin;
    }
  }
  return hard;
}
