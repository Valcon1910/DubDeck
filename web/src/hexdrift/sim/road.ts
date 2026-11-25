// Road maps: smooth roads of any width instead of grid tiles. Banked bends,
// wide boulevards and narrow lanes, shortcuts that leave the road and join
// it again, jumps over gaps, tunnels through mountains, and roads that are
// the ground itself (a dirt trail across the dunes).
//
// A road is described like the tile maps, as a short route driven from the
// start ("S120 R90/60 H12 U6 S80 ..."), and becomes a chain of short straight
// segments. The physics asks the segments near the car: where is the road,
// how high, which way does it tilt. The ground around is a height function
// that blends from the land of the map to the road's edges.
//
// Like the rest of the simulation this only uses + - * / sqrt (and
// Math.floor / Math.imul), so every device and the record checker agree.
import { dcos, dsin, hash, noise, smooth } from "./math.ts";

/** Spacing of the road's samples (and the length of its segments). */
export const SEG = 2.5;
const RB = 16; // bucket size of the road index
export const TB = 32; // bucket size of the ground index
export const bkey = (i: number, j: number) => (i + 8192) * 16384 + (j + 8192);
const NONE = -1e9;
const DEG = 3.141592653589793 / 180;

export type Surf = "asphalt" | "dirt" | "ice" | "metal" | "sand";
const GRIP: Record<Surf, number> = { asphalt: 1, dirt: 0.72, ice: 0.2, metal: 1, sand: 0.6 };

/** What the ground beside the road is made of (decides how fast you go on it). */
export const MAT = { grass: 0, sand: 1, rock: 2, snow: 3, dirt: 4, water: 5, pave: 6 } as const;
export const ROUGH = [28, 22, 26, 22, 34, 14, 42];

export interface LandDef {
  /** coast: beach and sea; alpine: mountains; dunes; isles: islands in the sky; void: nothing (space); plain: rolling ground. */
  kind: "coast" | "alpine" | "dunes" | "isles" | "void" | "plain";
  seed: number;
  /** Ground level, hill height and feature size (m). */
  base: number; amp: number; scale: number;
  /** Water below this height (deep water sends you back). */
  sea?: number;
  /** Coast: the sea lies where x*a + z*b > c (a, b a unit vector). */
  shore?: [number, number, number];
  /** How far beside the road the ground blends into the land. */
  fall: number;
  /** How far the road sits above the ground right beside it. */
  shoulder: number;
  /** Alpine: snow above this height. */
  snow?: number;
  /** What the ground right beside the road is (pavement in towns). */
  verge?: number;
  /** Main ground material (plain/dunes). */
  mat?: number;
}

export interface AltDef {
  /** Markers (@name in the route) where the shortcut leaves and rejoins. */
  from: string; to: string;
  /** Bends on the way: [fraction along the straight line from start to end, offset to the right (m), rise (m)]. */
  via?: [number, number, number?][];
  hw?: number;
  surf?: Surf;
  /** A jump: [fraction where the gap starts, gap length (m), ramp rise (m)]. */
  jump?: [number, number, number];
  /** It's the ground itself (no embankment). */
  flush?: boolean;
}

export interface RoadDef {
  land: LandDef;
  /** Start line: x, z, height, heading in degrees (0 drives toward +z, 90 toward +x). */
  start: [number, number, number, number];
  route: string;
  alts?: AltDef[];
  /** How much bends lean in (0: flat). */
  bank?: number;
  /** The road follows the land's own rise and fall. */
  hug?: boolean;
  /** Gravity as a share of normal. */
  grav?: number;
  /** How the land round the roads is dressed (scenery only; see kit.ts). */
  dress?: Dress;
}

/** Roadside strips: what lines a stretch of road (kit.ts knows what each holds). */
export type Strip = "beach" | "boulevard" | "downtown" | "shops" | "park" | "none";

export interface Dress {
  /** The scenery kit. */
  kit: string;
  /** Stretches of the main road: [from m, to m, left strip, right strip]. */
  zones: [number, number, Strip, Strip][];
  /** Hand-placed pieces: kit object, metres along the main road, side (-1 left, 1 right), gap from the road's edge, shift along. */
  set?: [string, number, number, number, number?][];
}

/** Flags of the segment that starts at a sample. */
export const WL = 1, WR = 2, TUN = 4, FLUSH = 8, GAP = 16, BOOST = 32;

export interface Sample {
  x: number; y: number; z: number;
  /** Direction of travel (unit). */
  dx: number; dz: number;
  /** Heading (main road only). */
  yaw: number;
  /** Distance from the strand's start. */
  s: number;
  hw: number;
  /** Height change per metre to the right (bends lean in). */
  bank: number;
  flags: number;
  surf: Surf;
  boost?: [number, number];
}

export interface Seg {
  ax: number; ay: number; az: number; bx: number; by: number; bz: number;
  fx: number; fz: number; len: number;
  hw0: number; hw1: number; bk0: number; bk1: number;
  flags: number; surf: Surf;
  strand: number;
  /** Index of the start sample in its strand. */
  i: number;
  /** The road stops at this end (start, finish, the edge of a gap). */
  capA: boolean; capB: boolean;
  /** Boost pad across [b0, b1] (lateral), when flags has BOOST. */
  b0: number; b1: number;
}

export interface Gate { x: number; y: number; z: number; yaw: number; fx: number; fz: number; hw: number; cp: number }

export interface Strand { pts: Sample[]; alt: boolean }

export interface Road {
  strands: Strand[];
  segs: Seg[];
  grid: Map<number, Seg[]>;
  tgrid: Map<number, Seg[]>;
  gates: Gate[];
  finish: Gate;
  land: LandDef;
  grav: number;
  /** Distance from the finish to the end of the road. */
  runout: number;
  x0: number; x1: number; z0: number; z1: number;
  minY: number;
  dress?: Dress;
}

// ── The land ────────────────────────────────────────────────────────────────

const fbm = (x: number, z: number, seed: number) =>
  noise(x, z, seed) * 0.6 + noise(x * 2.3, z * 2.3, seed + 1) * 0.28 + noise(x * 5.7, z * 5.7, seed + 2) * 0.12;
const ridge = (x: number, z: number, seed: number) => {
  const n = noise(x, z, seed) * 2 - 1;
  return 1 - (n < 0 ? -n : n);
};

/** The land of the map without any road: height and material. */
export function landAt(L: LandDef, x: number, z: number): { h: number; mat: number } {
  const sc = L.scale;
  switch (L.kind) {
    case "coast": {
      const [a, b, c] = L.shore ?? [1, 0, 0];
      const q = x * a + z * b - c;
      const land = L.base + L.amp * fbm(x / sc, z / sc, L.seed);
      const sea = L.sea ?? 0;
      const t = q < -60 ? 0 : q > 0 ? 1 : smooth((q + 60) / 60);
      const beach = sea + 1.4 - 0.05 * q;
      const h = land + (beach - land) * t;
      return { h, mat: h < sea ? MAT.water : t > 0.15 ? MAT.sand : MAT.grass };
    }
    case "alpine": {
      const r1 = ridge(x / sc, z / sc, L.seed), r2 = ridge(x / (sc * 0.4), z / (sc * 0.4), L.seed + 3);
      const m = r1 * r1 * 0.75 + r2 * 0.25;
      const h = L.base + L.amp * m * m + 6 * noise(x / 40, z / 40, L.seed + 5);
      return { h, mat: h > (L.snow ?? 1e9) ? MAT.snow : MAT.grass };
    }
    case "dunes": {
      // Long dunes across the wind, with small ripples.
      const d1 = ridge(x / sc + noise(z / 300, x / 300, L.seed + 7) * 1.5, z / (sc * 3), L.seed);
      const d2 = noise(x / (sc * 0.5), z / (sc * 0.5), L.seed + 2);
      const h = L.base + L.amp * (d1 * d1 * 0.8 + d2 * 0.2);
      return { h, mat: L.mat ?? MAT.sand };
    }
    case "isles": {
      const n = fbm(x / sc, z / sc, L.seed);
      if (n < 0.6) return { h: NONE, mat: MAT.grass };
      const k = (n - 0.6) / 0.4;
      return { h: L.base - 20 + L.amp * (k < 0.25 ? k * 4 : 1), mat: MAT.grass };
    }
    case "void": return { h: NONE, mat: MAT.rock };
    default: {
      const h = L.base + L.amp * fbm(x / sc, z / sc, L.seed);
      return { h, mat: L.mat ?? MAT.grass };
    }
  }
}

// ── Building a road ─────────────────────────────────────────────────────────

/**
 * Route tokens, driven from the start line:
 *   S80      straight, 80 m
 *   L90/60   bend left 90° on a 60 m radius (R for right)
 *   H12      the next piece eases the road to 12 m either side of the middle
 *   U6 D6    the next piece climbs or drops 6 m
 *   WB WL WR W0   walls on both sides, left only, right only, none
 *   B BL BR  a boost pad at the start of the next piece (whole width, left or right lane)
 *   J4       the next piece ends in a ramp 4 m high
 *   G40/-3   a gap of 40 m (then the road goes on 3 m lower than the ramp's top)
 *   C F      a checkpoint, the finish
 *   @name    a marker for shortcuts
 *   T+ T-    tunnel on / off
 *   X+ X-    the road is the ground itself on / off
 *   Mdirt    surface from here (asphalt, dirt, ice, metal, sand)
 */
export function buildRoad(def: RoadDef): Road {
  const L = def.land;
  const main: Sample[] = [];
  const gates: Gate[] = [];
  let finish: Gate | null = null;
  const marks: Record<string, number> = {};
  let [x, z, y, hd] = def.start;
  let yaw = hd * DEG;
  let s = 0, hw = 9, walls = 0, flags = 0, surf: Surf = "asphalt", cp = 0;
  let wantHw = -1, rise = 0, boost = "", ramp = 0;
  const push = () => {
    main.push({ x, y, z, dx: dsin(yaw), dz: dcos(yaw), yaw, s, hw, bank: 0, flags: walls | flags, surf });
  };
  push();
  const piece = (len: number, turn: number) => {
    const n = len / SEG < 1 ? 1 : Math.floor(len / SEG + 0.5);
    const h0 = hw, y0 = y, ds = len / n, da = turn / n;
    const hw1 = wantHw < 0 ? hw : wantHw;
    const r0 = rise, rp = ramp, bst = boost;
    const rampFrom = len - 20 < 0 ? 0 : len - 20;
    // The boost pad covers the first 18 m.
    if (bst) {
      const last = main[main.length - 1];
      last.flags |= BOOST;
      last.boost = bst === "L" ? [-h0 + 1, -0.5] : bst === "R" ? [0.5, h0 - 1] : [-h0 + 1, h0 - 1];
    }
    for (let j = 1; j <= n; j++) {
      const u = j / n;
      let step = ds;
      if (turn !== 0) {
        // The chord of a short arc, along the mean heading.
        const r = len / (turn < 0 ? -turn : turn);
        const half = da / 2;
        step = 2 * r * (dsin(half < 0 ? -half : half));
        yaw += half;
        x += dsin(yaw) * step; z += dcos(yaw) * step;
        yaw += half;
      } else {
        x += dsin(yaw) * step; z += dcos(yaw) * step;
      }
      s += ds;
      hw = h0 + (hw1 - h0) * smooth(u);
      y = y0 + r0 * smooth(u);
      const along = u * len;
      if (rp && along > rampFrom) {
        const k = (along - rampFrom) / (len - rampFrom);
        y += rp * k * k;
      }
      push();
      if (bst && along < 18) {
        const p = main[main.length - 1];
        p.flags |= BOOST;
        p.boost = bst === "L" ? [-hw + 1, -0.5] : bst === "R" ? [0.5, hw - 1] : [-hw + 1, hw - 1];
      }
    }
    if (rp) y = main[main.length - 1].y;
    wantHw = -1; rise = 0; boost = ""; ramp = 0;
  };
  for (const tok of def.route.trim().split(/\s+/)) {
    const c = tok[0], rest = tok.slice(1);
    const num = (t: string) => {
      const v = Number(t);
      if (t === "" || v !== v) throw new Error(`Bad road token ${tok}`);
      return v;
    };
    if (c === "S") piece(num(rest), 0);
    else if (c === "L" || c === "R") {
      const [a, r] = rest.split("/").map(num);
      piece(r * a * DEG, (c === "L" ? 1 : -1) * a * DEG);
    } else if (c === "H") wantHw = num(rest);
    else if (c === "U") rise = num(rest);
    else if (c === "D") rise = -num(rest);
    else if (c === "W") walls = rest === "B" ? WL | WR : rest === "L" ? WL : rest === "R" ? WR : 0;
    else if (c === "B") boost = rest === "L" ? "L" : rest === "R" ? "R" : "A";
    else if (c === "J") ramp = num(rest);
    else if (c === "G") {
      const [len, dy] = rest.split("/").map(num);
      main[main.length - 1].flags |= GAP;
      const n = Math.floor(len / SEG + 0.5);
      for (let j = 1; j <= n; j++) {
        x += dsin(yaw) * (len / n); z += dcos(yaw) * (len / n); s += len / n;
        if (j === n) y += dy || 0;
        push();
        if (j < n) main[main.length - 1].flags |= GAP;
      }
    } else if (c === "C" || c === "F") {
      const g: Gate = { x, y, z, yaw, fx: dsin(yaw), fz: dcos(yaw), hw: hw + 2, cp: c === "C" ? cp++ : -1 };
      if (c === "C") gates.push(g); else finish = g;
    } else if (c === "@") marks[rest] = main.length - 1;
    else if (c === "T") flags = rest === "+" ? flags | TUN : flags & ~TUN;
    else if (c === "X") flags = rest === "+" ? flags | FLUSH : flags & ~FLUSH;
    else if (c === "M") surf = rest as Surf;
    else throw new Error(`Bad road token ${tok}`);
  }
  if (!finish) throw new Error("A road needs a finish (F)");

  // Roads that follow the land: heights from the land, smoothed.
  if (def.hug) {
    const raw = main.map((p) => landAt(L, p.x, p.z).h);
    let cur = raw;
    for (let pass = 0; pass < 3; pass++) {
      const nxt: number[] = [];
      for (let i = 0; i < cur.length; i++) {
        let sum = 0, k = 0;
        for (let j = i - 8; j <= i + 8; j++) { if (j >= 0 && j < cur.length) { sum += cur[j]; k++; } }
        nxt.push(sum / k);
      }
      cur = nxt;
    }
    main.forEach((p, i) => { p.y = cur[i] + (p.y - def.start[2]); });
    for (const g of [...gates, finish]) {
      let bi = 0, bd = Infinity;
      main.forEach((p, i) => { const d = (p.x - g.x) * (p.x - g.x) + (p.z - g.z) * (p.z - g.z); if (d < bd) { bd = d; bi = i; } });
      g.y = main[bi].y;
    }
  }

  // Bends lean in: the bank follows the curvature, smoothed.
  const kb = def.bank ?? 0;
  if (kb) {
    const raw = main.map((_p, i) => {
      const a = main[i > 0 ? i - 1 : i], b = main[i < main.length - 1 ? i + 1 : i];
      const ds = b.s - a.s;
      const k = ds > 0 ? ((b.yaw - a.yaw) / ds) * kb : 0;
      return k < -0.14 ? -0.14 : k > 0.14 ? 0.14 : k;
    });
    const sm: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      let sum = 0, k = 0;
      for (let j = i - 6; j <= i + 6; j++) { if (j >= 0 && j < raw.length) { sum += raw[j]; k++; } }
      sm.push(sum / k);
    }
    // A left bend (yaw growing) leans left: the right side is higher.
    main.forEach((p, i) => { p.bank = sm[i]; });
  }

  const strands: Strand[] = [{ pts: main, alt: false }];
  for (const a of def.alts ?? []) strands.push({ pts: altStrand(a, main, marks), alt: true });

  // Segments and their indexes.
  const segs: Seg[] = [];
  const grid = new Map<number, Seg[]>(), tgrid = new Map<number, Seg[]>();
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, minY = Infinity;
  const index = (g: Map<number, Seg[]>, size: number, sg: Seg, r: number) => {
    const lx = sg.ax < sg.bx ? sg.ax : sg.bx, hx = sg.ax < sg.bx ? sg.bx : sg.ax;
    const lz = sg.az < sg.bz ? sg.az : sg.bz, hz = sg.az < sg.bz ? sg.bz : sg.az;
    for (let i = Math.floor((lx - r) / size); i <= Math.floor((hx + r) / size); i++) {
      for (let j = Math.floor((lz - r) / size); j <= Math.floor((hz + r) / size); j++) {
        const k = bkey(i, j);
        const l = g.get(k);
        if (l) l.push(sg); else g.set(k, [sg]);
      }
    }
  };
  strands.forEach((st, si) => {
    const pts = st.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const ex = b.x - a.x, ez = b.z - a.z;
      const len = Math.sqrt(ex * ex + ez * ez) || 1e-6;
      const sg: Seg = {
        ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, fx: ex / len, fz: ez / len, len,
        hw0: a.hw, hw1: b.hw, bk0: a.bank, bk1: b.bank, flags: a.flags, surf: a.surf, strand: si, i,
        capA: i === 0 || (pts[i - 1].flags & GAP) !== 0, capB: i === pts.length - 2 || (b.flags & GAP) !== 0,
        b0: a.boost ? a.boost[0] : 0, b1: a.boost ? a.boost[1] : 0,
      };
      segs.push(sg);
      const big = a.hw > b.hw ? a.hw : b.hw;
      if (!(sg.flags & GAP)) index(grid, RB, sg, big + 2.5);
      index(tgrid, TB, sg, big + L.fall + 18);
      if (a.x < x0) x0 = a.x;
      if (a.x > x1) x1 = a.x;
      if (a.z < z0) z0 = a.z;
      if (a.z > z1) z1 = a.z;
      if (a.y < minY) minY = a.y;
    }
  });
  const fi = main.reduce((bi, p, i) => ((p.x - finish!.x) * (p.x - finish!.x) + (p.z - finish!.z) * (p.z - finish!.z) < (main[bi].x - finish!.x) * (main[bi].x - finish!.x) + (main[bi].z - finish!.z) * (main[bi].z - finish!.z) ? i : bi), 0);
  if (L.sea !== undefined && L.sea < minY) minY = L.sea;
  return {
    strands, segs, grid, tgrid, gates, finish, land: L, grav: def.grav ?? 1, dress: def.dress,
    runout: main[main.length - 1].s - main[fi].s, x0, x1, z0, z1, minY,
  };
}

/** A shortcut: a smooth road from one marker of the main road to another. */
function altStrand(a: AltDef, main: Sample[], marks: Record<string, number>): Sample[] {
  const ia = marks[a.from], ib = marks[a.to];
  if (ia === undefined || ib === undefined) throw new Error(`Unknown marker in shortcut ${a.from} → ${a.to}`);
  const A = main[ia], B = main[ib];
  const cx = B.x - A.x, cz = B.z - A.z;
  const cl = Math.sqrt(cx * cx + cz * cz);
  const ux = cx / cl, uz = cz / cl, rx = -uz, rz = ux;
  // Control points and their heights.
  const P: { x: number; z: number; y: number }[] = [{ x: A.x, z: A.z, y: A.y }];
  for (const [t, off, dy] of a.via ?? []) P.push({ x: A.x + cx * t + rx * off, z: A.z + cz * t + rz * off, y: A.y + (B.y - A.y) * t + (dy ?? 0) });
  P.push({ x: B.x, z: B.z, y: B.y });
  const dist = (p: { x: number; z: number }, q: { x: number; z: number }) => Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.z - q.z) * (p.z - q.z));
  // Tangents: the main road's direction at the ends, Catmull-Rom between.
  const T = P.map((_p, i) => {
    if (i === 0) { const d = dist(P[0], P[1]); return { x: A.dx * d, z: A.dz * d }; }
    if (i === P.length - 1) { const d = dist(P[i - 1], P[i]); return { x: B.dx * d, z: B.dz * d }; }
    return { x: (P[i + 1].x - P[i - 1].x) / 2, z: (P[i + 1].z - P[i - 1].z) / 2 };
  });
  // A dense polyline, then even spacing.
  const dense: { x: number; z: number; y: number; s: number }[] = [];
  let acc = 0;
  for (let k = 0; k < P.length - 1; k++) {
    const p0 = P[k], p1 = P[k + 1], m0 = T[k], m1 = T[k + 1];
    const m = Math.floor(dist(p0, p1) / 0.5) + 2;
    for (let j = k === 0 ? 0 : 1; j <= m; j++) {
      const t = j / m, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      const q = { x: h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x, z: h00 * p0.z + h10 * m0.z + h01 * p1.z + h11 * m1.z, y: p0.y + (p1.y - p0.y) * smooth(t), s: 0 };
      if (dense.length) acc += dist(dense[dense.length - 1], q);
      q.s = acc;
      dense.push(q);
    }
  }
  const total = acc;
  const n = Math.floor(total / SEG + 0.5);
  const out: Sample[] = [];
  const hw = a.hw ?? 6;
  const flush = a.flush || (A.flags & 8) !== 0 ? 8 : 0;
  let k = 0;
  const [jt, jl, jr] = a.jump ?? [2, 0, 0];
  const gs = jt * total, ge = gs + jl;
  for (let i = 0; i <= n; i++) {
    const sv = (total * i) / n;
    while (k < dense.length - 2 && dense[k + 1].s < sv) k++;
    const d0 = dense[k], d1 = dense[k + 1];
    const f = d1.s > d0.s ? (sv - d0.s) / (d1.s - d0.s) : 0;
    const px = d0.x + (d1.x - d0.x) * f, pz = d0.z + (d1.z - d0.z) * f;
    let py = d0.y + (d1.y - d0.y) * f;
    // Ease the bank from the main road's to flat and back.
    const ea = sv < 30 ? 1 - sv / 30 : 0, eb = total - sv < 30 ? 1 - (total - sv) / 30 : 0;
    const bank = A.bank * ea + B.bank * eb;
    // The width eases in from the main road's.
    const w = sv < 25 ? A.hw + (hw - A.hw) * smooth(sv / 25) : total - sv < 25 ? B.hw + (hw - B.hw) * smooth((total - sv) / 25) : hw;
    let fl = flush;
    if (jl > 0) {
      if (sv > gs - 18 && sv <= gs) { const q = (sv - (gs - 18)) / 18; py += jr * q * q; }
      if (sv >= gs && sv < ge) fl |= GAP;
    }
    out.push({ x: px, y: py, z: pz, dx: 0, dz: 0, yaw: 0, s: sv, hw: w, bank, flags: fl, surf: a.surf ?? "asphalt" });
  }
  for (let i = 0; i < out.length; i++) {
    const p = out[i], q = out[i < out.length - 1 ? i + 1 : i], o = out[i > 0 ? i - 1 : i];
    const ex = q.x - o.x, ez = q.z - o.z, l = Math.sqrt(ex * ex + ez * ez) || 1;
    p.dx = ex / l; p.dz = ez / l;
  }
  return out;
}

// ── Asking the road ─────────────────────────────────────────────────────────

export interface RoadHit {
  h: number; nx: number; ny: number; nz: number;
  boost: boolean; ice: boolean; grip: number;
  seg: Seg;
}

/** Where (px, pz) falls on a segment: along, across, the clamped share and the distance. */
function near(sg: Seg, px: number, pz: number) {
  const ex = px - sg.ax, ez = pz - sg.az;
  const along = ex * sg.fx + ez * sg.fz;
  const lat = -ex * sg.fz + ez * sg.fx; // + is to the right of travel
  const t = along < 0 ? 0 : along > sg.len ? 1 : along / sg.len;
  const cx = sg.ax + sg.fx * sg.len * t, cz = sg.az + sg.fz * sg.len * t;
  const dx = px - cx, dz = pz - cz;
  return { along, lat, t, d: Math.sqrt(dx * dx + dz * dz) };
}

/** Is (px, pz) on this segment's road, and how high is it there? NaN when not. */
function heightOn(sg: Seg, q: { along: number; lat: number; t: number; d: number }) {
  if ((sg.capA && q.along < 0) || (sg.capB && q.along > sg.len)) return NaN;
  const hw = sg.hw0 + (sg.hw1 - sg.hw0) * q.t;
  if (q.d > hw) return NaN;
  const bk = sg.bk0 + (sg.bk1 - sg.bk0) * q.t;
  const lat = q.lat < -hw ? -hw : q.lat > hw ? hw : q.lat;
  return sg.ay + (sg.by - sg.ay) * q.t + bk * lat;
}

/** The highest road under (px, pz) that isn't more than `reach` above py. */
export function roadGround(road: Road, px: number, py: number, pz: number, reach: number): RoadHit | null {
  const list = road.grid.get(bkey(Math.floor(px / RB), Math.floor(pz / RB)));
  if (!list) return null;
  let best: Seg | null = null, bh = 0, bd = 0, blat = 0, bt = 0;
  for (const sg of list) {
    const q = near(sg, px, pz);
    const h = heightOn(sg, q);
    if (h !== h || h > py + reach) continue;
    if (!best || h > bh + 0.6 || (h > bh - 0.6 && q.d < bd)) { best = sg; bh = h; bd = q.d; blat = q.lat; bt = q.t; }
  }
  if (!best) return null;
  const k = (best.by - best.ay) / best.len;
  const bk = best.bk0 + (best.bk1 - best.bk0) * bt;
  // Slope along plus lean across; the right is (-fz, fx).
  const gx = k * best.fx - bk * best.fz, gz = k * best.fz + bk * best.fx;
  const n = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
  const boost = (best.flags & BOOST) !== 0 && blat >= best.b0 && blat <= best.b1;
  return { h: bh, nx: -gx * n, ny: n, nz: -gz * n, boost, ice: best.surf === "ice", grip: GRIP[best.surf], seg: best };
}

/** True when (x, z) is on a road of another strand near height y. */
function onOther(road: Road, strand: number, x: number, y: number, z: number) {
  const list = road.grid.get(bkey(Math.floor(x / RB), Math.floor(z / RB)));
  if (!list) return false;
  for (const sg of list) {
    if (sg.strand === strand) continue;
    const h = heightOn(sg, near(sg, x, z));
    if (h === h && h - y < 2 && y - h < 3) return true;
  }
  return false;
}

export const WALL_H = 1.3, WALL_T = 0.6, THICK = 1.2;

/**
 * Walls along the road's edges, and the underside of a road above. Pushes the
 * car (radius cr, height ch) out. Returns how hard it hit.
 */
export function roadSolids(road: Road, car: { x: number; y: number; z: number; vx: number; vy: number; vz: number }, px: number, pz: number, cr: number, ch: number): number {
  const list = road.grid.get(bkey(Math.floor(car.x / RB), Math.floor(car.z / RB)));
  if (!list) return 0;
  let hard = 0;
  for (const sg of list) {
    const q = near(sg, car.x, car.z);
    if (q.along < -0.6 || q.along > sg.len + 0.6) continue;
    const hw = sg.hw0 + (sg.hw1 - sg.hw0) * q.t;
    const bk = sg.bk0 + (sg.bk1 - sg.bk0) * q.t;
    const hc = sg.ay + (sg.by - sg.ay) * q.t;
    // The underside of a road passing over the car.
    if (q.lat > -hw && q.lat < hw && !(sg.flags & FLUSH)) {
      const top = hc + bk * q.lat;
      if (car.y + ch > top - THICK && car.y < top - 0.8) {
        car.y = top - THICK - ch;
        if (car.vy > 0) car.vy = 0;
      }
    }
    if (!(sg.flags & (WL | WR))) continue;
    const plat = -(px - sg.ax) * sg.fz + (pz - sg.az) * sg.fx;
    for (let side = -1; side <= 1; side += 2) {
      if (!(sg.flags & (side < 0 ? WL : WR))) continue;
      const e = side * hw;
      const he = hc + bk * e;
      if (car.y >= he + WALL_H || car.y + ch <= he - 3) continue;
      // How deep into the wall (0..: from the road side, or from outside).
      let pen = 0, dir = 0;
      const inside = side > 0 ? plat < e + WALL_T / 2 : plat > e - WALL_T / 2;
      if (inside) {
        pen = side > 0 ? q.lat + cr - e : e - (q.lat - cr);
        dir = -side;
      } else {
        const out = e + side * WALL_T;
        pen = side > 0 ? out - (q.lat - cr) : q.lat + cr - out;
        dir = side;
      }
      if (pen <= 0 || pen > cr + WALL_T + 1.5) continue;
      if (onOther(road, sg.strand, car.x, car.y, car.z)) continue;
      // The wall's normal (toward where the car should go).
      const nx = -sg.fz * dir, nz = sg.fx * dir;
      car.x += nx * pen; car.z += nz * pen;
      const vin = car.vx * nx + car.vz * nz;
      if (vin < 0) {
        car.vx -= nx * vin * 1.3; car.vz -= nz * vin * 1.3; car.vx *= 0.96; car.vz *= 0.96;
        if (-vin > hard) hard = -vin;
      }
    }
  }
  return hard;
}

export interface RoadGround { h: number; ravine: boolean; rough: number; mat: number }

/** The ground at (x, z): the land, blended to the roads near it. */
export function roadTerrain(road: Road, x: number, z: number): RoadGround {
  const L = road.land;
  const n = landAt(L, x, z);
  const list = road.tgrid.get(bkey(Math.floor(x / TB), Math.floor(z / TB)));
  let w = 0, tgt = 0, cut = 0, cutH = 0, isle = NONE, flushNear = false;
  if (list) {
    for (const sg of list) {
      const q = near(sg, x, z);
      const hw = sg.hw0 + (sg.hw1 - sg.hw0) * q.t;
      const hc = sg.ay + (sg.by - sg.ay) * q.t;
      if (sg.flags & GAP) {
        // A ravine under the gap.
        if (q.along < 0 || q.along > sg.len) continue;
        const k = q.d < hw + 4 ? 1 : q.d < hw + 14 ? 1 - (q.d - hw - 4) / 10 : 0;
        if (k > cut) { cut = k; cutH = hc - 16; }
        continue;
      }
      const bk = sg.bk0 + (sg.bk1 - sg.bk0) * q.t;
      const lat = q.lat < -hw ? -hw : q.lat > hw ? hw : q.lat;
      const flush = (sg.flags & FLUSH) !== 0;
      const e = hc + bk * lat - (flush ? 0.03 : L.shoulder);
      const fall = sg.flags & TUN ? 1.5 : L.fall;
      const dd = q.d - hw - 0.6;
      let ww = dd <= 0 ? 1 : 1 - dd / fall;
      if (ww <= 0) continue;
      ww = smooth(ww);
      if (ww > w + 1e-9 || (ww > w - 1e-9 && e < tgt)) { w = ww; tgt = e; flushNear = flush; }
      if (L.kind === "isles") {
        // Rock under the sky roads: a grassy shoulder, then cliffs.
        const o = dd < 0 ? 0 : dd;
        const em = e - (o < 6 ? 0.08 * o : 0.48 + 1.6 * (o - 6));
        if (em > isle) isle = em;
      }
    }
  }
  let h: number;
  let mat = n.mat;
  if (L.kind === "void") return { h: NONE, ravine: false, rough: ROUGH[MAT.rock], mat: MAT.rock };
  if (L.kind === "isles") {
    const roadIsle = isle >= road.minY - 14 ? isle : NONE;
    h = n.h > roadIsle ? n.h : roadIsle;
    if (w > 0 && n.h > NONE && n.h > roadIsle) h = n.h + (tgt - n.h) * w;
    if (h <= NONE) return { h: NONE, ravine: false, rough: ROUGH[mat], mat };
  } else {
    h = n.h + (tgt - n.h) * w;
    if (w > 0.6 && !flushNear && L.verge !== undefined) mat = L.verge;
  }
  let ravine = false;
  if (cut > 0) {
    const c = h + (cutH - h) * cut;
    if (c < h) h = c;
    if (cut > 0.6) ravine = true;
  }
  if (L.sea !== undefined && h < L.sea) {
    mat = MAT.water;
    if (h < L.sea - 1.2) ravine = true;
  }
  return { h, ravine, rough: ROUGH[mat], mat };
}

/** Shortest distance from (x, z) to any road (up to `max`). */
export function roadDist(road: Road, x: number, z: number, max: number): number {
  let best = max;
  const i0 = Math.floor((x - max) / RB), i1 = Math.floor((x + max) / RB);
  const j0 = Math.floor((z - max) / RB), j1 = Math.floor((z + max) / RB);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const list = road.grid.get(bkey(i, j));
      if (!list) continue;
      for (const sg of list) {
        const q = near(sg, x, z);
        const hw = sg.hw0 + (sg.hw1 - sg.hw0) * q.t;
        const d = q.d - hw;
        if (d < best) best = d < 0 ? 0 : d;
      }
    }
  }
  // Gaps count as road (the ravine beside them).
  return best;
}

/** The nearest road segment to (x, z) within max of its edge: the segment, distance beyond its edge, side (+ right) and the share along it. */
export function roadNear(road: Road, x: number, z: number, max: number): { seg: Seg; d: number; lat: number; t: number } | null {
  let best: { seg: Seg; d: number; lat: number; t: number } | null = null;
  let bd = max;
  const i0 = Math.floor((x - max) / RB), i1 = Math.floor((x + max) / RB);
  const j0 = Math.floor((z - max) / RB), j1 = Math.floor((z + max) / RB);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const list = road.grid.get(bkey(i, j));
      if (!list) continue;
      for (const sg of list) {
        const q = near(sg, x, z);
        const d = q.d - (sg.hw0 + (sg.hw1 - sg.hw0) * q.t);
        if (d < bd) { bd = d; best = { seg: sg, d, lat: q.lat, t: q.t }; }
      }
    }
  }
  return best;
}

/** A random number 0..1 from integers (for laying out scenery). */
export const rnd = (a: number, b: number, salt: number) => hash(a, b, salt);
