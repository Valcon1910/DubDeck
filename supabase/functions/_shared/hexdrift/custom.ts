// Copied from web/src/hexdrift by scripts/hexdrift-share.mjs. Don't edit here.
// Player-made maps. A map is a chain of pieces (straights, bends, jumps,
// checkpoints) on one of the road themes; it turns into the same road the
// built-in maps use (road.ts). Pure and deterministic, so the server can
// rebuild a map and replay a run on it.
import { buildRoad, LOOP_R, type RoadDef, type LandDef, type Strip, type Surf, type Road } from "./road.ts";
import { chainOf, cleanGrid, piecesOfGrid, starterGrid, type Tile } from "./grid.ts";

export type ThemeId = "miami" | "storm" | "alpine" | "baja" | "sky" | "space";

export interface Theme {
  name: string;
  biome: ThemeId;
  land: LandDef;
  /** Start height, how much bends lean in, gravity, road surface. */
  y: number; bank: number; grav?: number; surf?: Surf;
  kit: string;
  /** Roadside strips in turn along the road ([left, right], every `every` m). */
  strips: [Strip, Strip][]; every: number;
  /** What the strips can be (the studio lets you pick). */
  choice: Strip[];
}

export const THEMES: Record<ThemeId, Theme> = {
  miami: {
    name: "Miami Sunset", biome: "miami", y: 3.6, bank: 4, kit: "miami", every: 420,
    land: { kind: "coast", seed: 11, base: 3, amp: 4, scale: 260, sea: 0, shore: [-1, 0, 300], fall: 26, shoulder: 0.15, verge: 6 },
    strips: [["boulevard", "beach"], ["boulevard", "park"], ["downtown", "downtown"], ["shops", "boulevard"]],
    choice: ["boulevard", "beach", "park", "downtown", "shops", "none"],
  },
  storm: {
    name: "Miami Storm", biome: "storm", y: 4, bank: 3, kit: "miami", every: 500,
    land: { kind: "coast", seed: 23, base: 3, amp: 3, scale: 300, sea: 0, shore: [1, 0, 400], fall: 26, shoulder: 0.15, verge: 6 },
    strips: [["boulevard", "downtown"], ["downtown", "downtown"], ["shops", "downtown"]],
    choice: ["boulevard", "downtown", "shops", "park", "none"],
  },
  alpine: {
    name: "Alpine", biome: "alpine", y: 30, bank: 4, kit: "alpine", every: 450,
    land: { kind: "alpine", seed: 100, base: 20, amp: 110, scale: 520, fall: 30, shoulder: 0.2, snow: -1000 },
    strips: [["village", "village"], ["forest", "forest"], ["cliff", "forest"], ["forest", "cliff"]],
    choice: ["village", "forest", "cliff", "park", "none"],
  },
  baja: {
    name: "Baja", biome: "baja", y: 22.5, bank: 4, kit: "baja", every: 500,
    land: { kind: "plain", seed: 79, base: 10, amp: 40, scale: 380, fall: 30, shoulder: 0.2, mat: 1 },
    strips: [["camp", "camp"], ["desert", "desert"], ["cliff", "desert"], ["desert", "cliff"]],
    choice: ["camp", "desert", "cliff", "village", "park", "none"],
  },
  sky: {
    name: "Sky Kingdom", biome: "sky", y: 60, bank: 4, kit: "sky", every: 600,
    land: { kind: "isles", seed: 64, base: 60, amp: 20, scale: 260, fall: 24, shoulder: 0.2 },
    strips: [["village", "village"], ["park", "cliff"], ["cliff", "park"]],
    choice: ["village", "park", "cliff", "none"],
  },
  space: {
    name: "Interstellar", biome: "space", y: 100, bank: 6, grav: 0.55, surf: "metal", kit: "space", every: 700,
    land: { kind: "void", seed: 1, base: 0, amp: 0, scale: 100, fall: 20, shoulder: 0.2 },
    strips: [["village", "village"], ["park", "cliff"], ["cliff", "park"]],
    choice: ["village", "park", "cliff", "none"],
  },
};

/** One piece of road. Bends turn by `a` degrees on a radius of `r` m. */
export interface Piece {
  /** Straight, left, right, checkpoint, gap, loop. */
  k: "S" | "L" | "R" | "C" | "G" | "O";
  /** Straight length, or the gap's length (G). */
  len?: number;
  a?: number; r?: number;
  /** A loop's sideways step: the road goes on this far to the right of where it went in (m). */
  off?: number;
  /** Climb (+) or drop (−) over the piece (m); for a gap, how much higher the landing is. */
  rise?: number;
  /** Half the road's width from this piece on (m). */
  hw?: number;
  surf?: Surf;
  walls?: "B" | "L" | "R" | "";
  boost?: "A" | "L" | "R";
  /** A kicker at the end of the piece (m it lifts). */
  ramp?: number;
  tunnel?: boolean;
  /** Roadside from this piece on (studio). */
  scene?: [Strip, Strip];
}

export interface CustomMap {
  v: 1;
  id: string;
  name: string;
  theme: ThemeId;
  pieces: Piece[];
  /** Made on the phone grid: the tiles (the pieces are worked out from them). */
  grid?: Tile[];
  /** The maker's own finish on the current version: proves it can be done and sets the medals. */
  author?: { ticks: number; inputs: string; hash: string };
  updated: number;
}

export const LIMITS = { pieces: 240, length: 8000, minLength: 150, nameLen: 32 };
const START = 40, RUNOUT = 60;

export const newMap = (theme: ThemeId = "miami"): CustomMap => ({
  v: 1, id: "u" + Math.floor(Math.random() * 36 ** 8).toString(36).padStart(8, "0"), name: "My map", theme,
  pieces: [{ k: "S", len: 80 }, { k: "R", a: 90, r: 60 }, { k: "S", len: 100 }, { k: "C" }, { k: "L", a: 90, r: 60 }, { k: "S", len: 120 }],
  updated: Date.now(),
});

/** A new map for the phone grid editor. */
export const newGridMap = (theme: ThemeId = "miami"): CustomMap => {
  const grid = starterGrid();
  return { ...newMap(theme), grid, pieces: piecesOfGrid(grid).pieces };
};

/** The map with new tiles (and the pieces they make). */
export const withGrid = (m: CustomMap, grid: Tile[]): CustomMap => ({ ...m, grid, pieces: piecesOfGrid(grid).pieces, updated: Date.now() });

/** Metres a piece adds along the road. */
export function pieceLen(p: Piece): number {
  if (p.k === "S" || p.k === "G") return p.len ?? 0;
  if (p.k === "L" || p.k === "R") return ((p.a ?? 0) * Math.PI / 180) * (p.r ?? 0);
  return 0;
}

/** The pieces as a road route (see buildRoad for the tokens). */
export function routeOf(m: CustomMap): string {
  const th = THEMES[m.theme];
  const out: string[] = [];
  let surf: Surf = th.surf ?? "asphalt", walls = "", tun = false, hw = 9;
  out.push(`H${hw}`);
  if (surf !== "asphalt") out.push(`M${surf}`);
  out.push(`S${START}`);
  for (const p of m.pieces) {
    if (p.k === "C") { out.push("C"); continue; }
    if (p.hw !== undefined && p.hw !== hw) { hw = p.hw; out.push(`H${hw}`); }
    const s = p.surf ?? surf;
    if (p.surf !== undefined && s !== surf) { surf = s; out.push(`M${surf}`); }
    if (p.walls !== undefined && p.walls !== walls) { walls = p.walls; out.push(`W${walls || "0"}`); }
    if (p.tunnel !== undefined && p.tunnel !== tun) { tun = p.tunnel; out.push(tun ? "T+" : "T-"); }
    if (p.k === "G") { out.push(`G${num(p.len ?? 20)}/${num(p.rise ?? 0)}`); continue; }
    if (p.k === "O") { out.push(p.off ? `O${num(p.r ?? 14)}/${num(p.off)}` : `O${num(p.r ?? 14)}`); continue; }
    if (p.rise) out.push(p.rise > 0 ? `U${num(p.rise)}` : `D${num(-p.rise)}`);
    if (p.boost) out.push(p.boost === "A" ? "B" : `B${p.boost}`);
    if (p.ramp) out.push(`J${num(p.ramp)}`);
    out.push(p.k === "S" ? `S${num(p.len ?? 40)}` : `${p.k}${num(p.a ?? 90)}/${num(p.r ?? 60)}`);
  }
  if (tun) out.push("T-");
  out.push("F", `S${RUNOUT}`);
  return out.join(" ");
}
const num = (v: number) => String(Math.round(v * 10) / 10);

/** The map as a road definition. */
export function roadDefOf(m: CustomMap): RoadDef {
  const th = THEMES[m.theme];
  // Scenery strips: the studio's picks, otherwise the theme's own in turn.
  const zones: [number, number, Strip, Strip][] = [];
  let s = START, cur: [Strip, Strip] = th.strips[0], from = 0, auto = 0, autoAt = th.every;
  const total = START + m.pieces.reduce((a, p) => a + pieceLen(p), 0) + RUNOUT;
  for (const p of m.pieces) {
    if (p.scene && (p.scene[0] !== cur[0] || p.scene[1] !== cur[1])) { zones.push([from, s, cur[0], cur[1]]); cur = p.scene; from = s; autoAt = Infinity; }
    s += pieceLen(p);
    if (s > autoAt && total - s > 150) { zones.push([from, s, cur[0], cur[1]]); auto++; cur = th.strips[auto % th.strips.length]; from = s; autoAt = s + th.every; }
  }
  zones.push([from, total + 10, cur[0], cur[1]]);
  return {
    land: th.land, start: [0, 0, th.y, 0], bank: th.bank, grav: th.grav, route: routeOf(m),
    dress: { kit: th.kit, zones, set: [["stand", 25, -1, 3], ["stand", 25, 1, 3]].filter(() => th.kit !== "sky") as [string, number, number, number][] },
  };
}

/** Changes whenever anything that affects driving changes (times only compare on the same version). */
export function versionOf(m: CustomMap): string {
  const s = `${m.theme}|${routeOf(m)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

export interface Problem { piece: number; text: string }
export interface Check { road: Road | null; problems: Problem[]; length: number }

/** Builds the road and finds what's wrong with it (empty problems: it can be raced). */
export function checkMap(m: CustomMap): Check {
  const problems: Problem[] = [];
  const length = m.pieces.reduce((a, p) => a + pieceLen(p), 0);
  if (m.pieces.length > LIMITS.pieces) problems.push({ piece: -1, text: `At most ${LIMITS.pieces} pieces.` });
  if (length > LIMITS.length) problems.push({ piece: -1, text: `At most ${LIMITS.length / 1000} km of road.` });
  if (length < LIMITS.minLength) problems.push({ piece: -1, text: `At least ${LIMITS.minLength} m of road.` });
  for (const [i, p] of m.pieces.entries()) {
    if ((p.k === "L" || p.k === "R") && ((p.r ?? 0) < 15 || (p.a ?? 0) <= 0 || (p.a ?? 0) > 270)) problems.push({ piece: i, text: "Bends need a radius of 15 m or more and up to 270°." });
    if (p.k === "S" && ((p.len ?? 0) < 5 || (p.len ?? 0) > 800)) problems.push({ piece: i, text: "Straights are 5 to 800 m." });
    if (p.k === "G" && ((p.len ?? 0) < 5 || (p.len ?? 0) > 120)) problems.push({ piece: i, text: "Gaps are 5 to 120 m." });
    if (p.k === "O" && ((p.r ?? 0) < LOOP_R[0] || (p.r ?? 0) > LOOP_R[1])) problems.push({ piece: i, text: `Loops have a radius of ${LOOP_R[0]} to ${LOOP_R[1]} m.` });
    if (p.rise && Math.abs(p.rise) > Math.max(2, pieceLen(p) * 0.3)) problems.push({ piece: i, text: "Too steep: climb at most 3 m per 10 m." });
  }
  if (m.grid) {
    for (const t of chainOf(m.grid).problems) problems.push({ piece: -1, text: t });
    // Checkpoints and loops make three pieces each: the limit is on pieces.
    if (piecesOfGrid(m.grid).pieces.length > LIMITS.pieces) problems.push({ piece: -1, text: "This track is too long: take some tiles out." });
  }
  let road: Road | null = null;
  try { road = buildRoad(roadDefOf(m)); } catch (e) { problems.push({ piece: -1, text: e instanceof Error ? e.message : "This road can't be built." }); }
  if (road) problems.push(...overlaps(m, road));
  return { road, problems, length };
}

/** The piece each main-road sample belongs to. */
export function pieceAt(m: CustomMap, s: number): number {
  let at = START;
  for (const [i, p] of m.pieces.entries()) { at += pieceLen(p); if (s < at) return i; }
  return m.pieces.length - 1;
}

/** Where the road runs into itself (crossing over or under with room to spare is fine). */
function overlaps(m: CustomMap, road: Road): Problem[] {
  const pts = road.strands[0].pts;
  const cell = 24, grid = new Map<number, number[]>();
  const key = (x: number, z: number) => (Math.floor(x / cell) + 4096) * 8192 + Math.floor(z / cell) + 4096;
  pts.forEach((p, i) => { const k = key(p.x, p.z); const l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]); });
  const found = new Set<number>();
  const out: Problem[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const p = pts[i];
    const cx = Math.floor(p.x / cell), cz = Math.floor(p.z / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const j of grid.get((cx + a + 4096) * 8192 + cz + b + 4096) ?? []) {
        const q = pts[j];
        if (j <= i || q.s - p.s < 40 + p.hw + q.hw) continue;
        const dx = p.x - q.x, dz = p.z - q.z, dy = p.y - q.y;
        const room = p.hw + q.hw + 2;
        if (dx * dx + dz * dz < room * room && dy * dy < 7.5 * 7.5) {
          const pi = pieceAt(m, q.s);
          if (!found.has(pi)) { found.add(pi); out.push({ piece: pi, text: "The road runs into itself here. Cross over or under with 8 m between, or move it aside." }); }
        }
      }
    }
  }
  return out;
}

/** Medal times from the maker's time (the same spread as the built-in maps). */
export function medalsOf(author: number) {
  return { vortex: author, gold: Math.ceil(author * 1.093), silver: Math.ceil(author * 1.258), bronze: Math.ceil(author * 1.547) };
}

// ── Share codes: the map as text (for Community Maps and copy-paste) ──
export function encodeMap(m: CustomMap): string {
  const json = JSON.stringify(m.grid ? { v: 1, name: m.name, theme: m.theme, grid: m.grid } : { v: 1, name: m.name, theme: m.theme, pieces: m.pieces });
  return "HX1." + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Reads a share code (or a map from storage) and keeps only what's valid. */
export function decodeMap(code: string): CustomMap | null {
  try {
    const b = code.trim().replace(/^HX1\./, "").replace(/-/g, "+").replace(/_/g, "/");
    return cleanMap(JSON.parse(decodeURIComponent(escape(atob(b)))), newMap().id);
  } catch { return null; }
}

const SURFS: Surf[] = ["asphalt", "dirt", "ice", "metal", "sand"];
export function cleanMap(o: unknown, id: string): CustomMap | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const theme = (typeof r.theme === "string" && r.theme in THEMES ? r.theme : "miami") as ThemeId;
  // A grid map: its pieces always come from its tiles.
  const grid = cleanGrid(r.grid);
  if (grid) r.pieces = piecesOfGrid(grid).pieces;
  if (!Array.isArray(r.pieces)) return null;
  const n = (v: unknown, lo: number, hi: number) => typeof v === "number" && v === v ? Math.min(hi, Math.max(lo, v)) : undefined;
  const pieces: Piece[] = [];
  for (const raw of r.pieces.slice(0, LIMITS.pieces)) {
    if (!raw || typeof raw !== "object") continue;
    const q = raw as Record<string, unknown>;
    if (!["S", "L", "R", "C", "G", "O"].includes(q.k as string)) continue;
    const p: Piece = { k: q.k as Piece["k"] };
    const len = n(q.len, 0, 800), a = n(q.a, 0, 270), rr = n(q.r, 0, 2000), rise = n(q.rise, -80, 80), hw = n(q.hw, 3, 16), ramp = n(q.ramp, 0, 8);
    if (len !== undefined) p.len = len;
    if (a !== undefined) p.a = a;
    if (rr !== undefined) p.r = rr;
    if (rise) p.rise = rise;
    if (hw !== undefined) p.hw = hw;
    if (ramp) p.ramp = ramp;
    const off = n(q.off, 0, 80);
    if (p.k === "O" && off) p.off = off;
    if (SURFS.includes(q.surf as Surf)) p.surf = q.surf as Surf;
    if (q.walls === "B" || q.walls === "L" || q.walls === "R" || q.walls === "") p.walls = q.walls;
    if (q.boost === "A" || q.boost === "L" || q.boost === "R") p.boost = q.boost;
    if (typeof q.tunnel === "boolean") p.tunnel = q.tunnel;
    const ch = THEMES[theme].choice;
    if (Array.isArray(q.scene) && ch.includes(q.scene[0]) && ch.includes(q.scene[1])) p.scene = [q.scene[0], q.scene[1]];
    pieces.push(p);
  }
  const au = r.author as Record<string, unknown> | undefined;
  return {
    v: 1, id: typeof r.id === "string" && /^u[0-9a-z]{4,12}$/.test(r.id) ? r.id : id,
    name: (typeof r.name === "string" ? r.name : "My map").slice(0, LIMITS.nameLen) || "My map",
    theme, pieces, ...(grid ? { grid } : {}), updated: typeof r.updated === "number" ? r.updated : Date.now(),
    author: au && typeof au.ticks === "number" && typeof au.inputs === "string" && typeof au.hash === "string" ? { ticks: au.ticks, inputs: au.inputs, hash: au.hash } : undefined,
  };
}

