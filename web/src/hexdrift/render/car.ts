// The cars: detailed low-poly lookalikes (own names, no badges), built from
// the garage look. Every car drives the same (same hitbox); only looks differ.
//
// Bodies are "lofted": a list of cross-sections from tail to nose, skinned
// with flat facets (the low-poly look). Wheel arches are cut by lifting the
// sections over each wheel, which also gives the fender bulges.
// Cars with a model made in Blender (scripts/hexdrift-cars) load that body
// when first needed; until it arrives the lofted body stands in, and it is
// swapped in place on every car already built. The wheels work the same way
// (one Blender set shared by every car, scaled to each wheel).
// Fast to draw: everything fixed is merged into one mesh per material, and
// wheels share geometry (about 25 draw calls a car).
import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { DEFAULT_LOOK, itemOf, type BodyDef, type Item, type Look } from "../garage.ts";
import coupeUrl from "../cars/coupe.glb?url";
import furiaUrl from "../cars/furia.glb?url";
import zenithUrl from "../cars/zenith.glb?url";
import rigUrl from "../cars/rig.glb?url";
import formulaUrl from "../cars/formula.glb?url";
import wheelsUrl from "../cars/wheels.glb?url";

export interface CarModel {
  root: THREE.Group;
  /** Tilt/position is set on root; wheels spin and steer; brake lights glow. */
  update(speed: number, steer: number, dt: number, braking?: boolean): void;
  setBoost(on: boolean): void;
  dispose(): void;
}

export interface CarOptions {
  look?: Look;
  /** The map's colour, used when the accent is set to "Map colour". */
  mapAccent?: string;
  /** false: a normal car; "pb": the see-through ghost of your best; "wr": the world record's gold ghost. */
  ghost?: false | "pb" | "wr";
  /** Shown above the world-record ghost. */
  label?: string;
  /** What the paint reflects (the map); a studio if not given. */
  env?: CarEnv;
}

type Part = "paint" | "accent" | "trim" | "gloss" | "glass" | "lamp" | "tail" | "metal" | "chrome" | "white";
type V = [number, number, number];

/** Collects triangles and parts per material, then merges them. */
class Kit {
  raw: Record<Part, number[]> = { paint: [], accent: [], trim: [], gloss: [], glass: [], lamp: [], tail: [], metal: [], chrome: [], white: [] };
  geos: Record<Part, THREE.BufferGeometry[]> = { paint: [], accent: [], trim: [], gloss: [], glass: [], lamp: [], tail: [], metal: [], chrome: [], white: [] };
  tri(p: Part, a: V, b: V, c: V) { this.raw[p].push(...a, ...b, ...c); }
  quad(p: Part, a: V, b: V, c: V, d: V) { this.tri(p, a, b, c); this.tri(p, a, c, d); }
  add(p: Part, g: THREE.BufferGeometry) { this.geos[p].push(g); }
  box(p: Part, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rz) g.rotateZ(rz);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this.add(p, g);
  }
  /** Same part on both sides (x and -x). */
  both(fn: (s: number) => void) { fn(1); fn(-1); }
  /** A thin rod between two points. */
  rod(p: Part, a: V, b: V, r = 0.025) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const g = new THREE.CylinderGeometry(r, r, len, 5);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
    g.translate(...a);
    this.add(p, g);
  }
  /** A flat outline (z, y), extruded sideways by `t` and centred on x. */
  plate(p: Part, pts: [number, number][], t: number, x: number) {
    const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    g.translate(x + t / 2, 0, 0);
    this.add(p, g);
  }
  build(): Map<Part, THREE.BufferGeometry> {
    const out = new Map<Part, THREE.BufferGeometry>();
    for (const p of Object.keys(this.raw) as Part[]) {
      const list = this.geos[p].slice();
      if (this.raw[p].length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(this.raw[p], 3));
        g.computeVertexNormals(); // not indexed, so every facet is flat
        list.push(g);
      }
      if (list.length) out.set(p, merge(list));
    }
    return out;
  }
}

/** Merges parts into one geometry (positions and flat normals only). */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== "position") n.deleteAttribute(k);
    n.computeVertexNormals();
    if (n !== g) g.dispose();
    return n;
  });
  const merged = clean.length === 1 ? clean[0] : mergeGeometries(clean, false)!;
  if (clean.length > 1) for (const g of clean) g.dispose();
  // Smooth across gentle bends, sharp at real creases: clean highlights
  // instead of every facet catching the light.
  const out = toCreasedNormals(merged, 0.6);
  if (out !== merged) merged.dispose();
  return out;
}

// ── Lofted bodies ───────────────────────────────────────────────────────────
/**
 * One cross-section at z: bottom edge (y0), widest line (y1, w1), shoulder
 * (y2, w2) and roof edge (y3, w3). `side` and `roof` pick the material of the
 * window band and the top band from here to the next section.
 */
interface St { z: number; y0: number; y1: number; w1: number; y2: number; w2: number; y3: number; w3: number; side?: Part; roof?: Part }
const st = (z: number, y0: number, y1: number, w1: number, y2: number, w2: number, y3: number, w3: number, side?: Part, roof?: Part): St =>
  ({ z, y0, y1, w1, y2, w2, y3, w3, side, roof });

function lerpSt(list: St[], z: number): St {
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i], b = list[i + 1];
    if (z < a.z || z > b.z) continue;
    const t = (z - a.z) / (b.z - a.z || 1);
    const m = (k: "y0" | "y1" | "w1" | "y2" | "w2" | "y3" | "w3") => a[k] + (b[k] - a[k]) * t;
    return { z, y0: m("y0"), y1: m("y1"), w1: m("w1"), y2: m("y2"), w2: m("w2"), y3: m("y3"), w3: m("w3"), side: a.side, roof: a.roof };
  }
  return { ...list[z < list[0].z ? 0 : list.length - 1], z };
}

interface Wheel { x: number; z: number; r: number; w: number; front: boolean }

/** Cuts an arch over each wheel and bulges the fender above it. */
function arches(list: St[], wheels: Wheel[], shape: "round" | "trap" = "round", flare = 0.03): St[] {
  let out = list.slice();
  const seen = new Set<number>();
  for (const w of wheels) {
    if (seen.has(w.z)) continue;
    seen.add(w.z);
    const span = w.r * 1.2;
    out = out.filter((s) => Math.abs(s.z - w.z) > span);
    for (const f of [-1.2, -1, -0.8, -0.5, 0, 0.5, 0.8, 1, 1.2]) {
      const s = lerpSt(list, w.z + f * w.r);
      const a = Math.abs(f);
      if (a <= 1) {
        const top = shape === "round"
          ? w.r + (w.r + 0.05) * Math.sqrt(1 - f * f)
          : a <= 0.72 ? 2 * w.r + 0.12 : w.r + (w.r + 0.12) * (1 - (a - 0.72) / 0.28) * 0.8 + 0.05;
        s.y0 = Math.max(s.y0, top);
        s.y1 = Math.max(s.y1, s.y0 + 0.04);
        s.w1 += flare * (1 - a * 0.5);
        s.y2 = Math.max(s.y2, s.y1 + 0.05);
        s.y3 = Math.max(s.y3, s.y2 + 0.01);
      }
      out.push(s);
    }
  }
  return out.sort((a, b) => a.z - b.z);
}

/** Skins the sections. Bands: lower, upper, window, roof, and the underside. */
function loft(k: Kit, list: St[], o: { lower?: Part; upper?: Part; bottom?: Part; cap?: Part; inset?: number } = {}) {
  const lower = o.lower ?? "paint", upper = o.upper ?? "paint", bottom = o.bottom ?? "trim", inset = o.inset ?? 0.08;
  const ring = (s: St): [number, number][] => [
    [s.w1 - inset, s.y0], [s.w1, s.y1], [s.w2, s.y2], [s.w3, s.y3],
    [-s.w3, s.y3], [-s.w2, s.y2], [-s.w1, s.y1], [-(s.w1 - inset), s.y0],
  ];
  for (let i = 0; i < list.length - 1; i++) {
    const A = list[i], B = list[i + 1];
    const a = ring(A), b = ring(B);
    const side = A.side ?? upper, roof = A.roof ?? upper;
    const parts: Part[] = [lower, upper, side, roof, side, upper, lower, bottom];
    for (let j = 0; j < 8; j++) {
      const j2 = (j + 1) % 8;
      k.quad(parts[j], [a[j][0], a[j][1], A.z], [a[j2][0], a[j2][1], A.z], [b[j2][0], b[j2][1], B.z], [b[j][0], b[j][1], B.z]);
    }
  }
  // End caps.
  for (const s of [list[0], list[list.length - 1]]) {
    const r = ring(s);
    const cy = r.reduce((t, p) => t + p[1], 0) / r.length;
    for (let j = 0; j < 8; j++) {
      const j2 = (j + 1) % 8;
      k.tri(o.cap ?? upper, [0, cy, s.z], [r[j][0], r[j][1], s.z], [r[j2][0], r[j2][1], s.z]);
    }
  }
}

/** The body's half-width at height y in a section. */
function surfX(s: St, y: number) {
  if (y <= s.y1) return s.w1;
  if (y <= s.y2) return s.w1 + (s.w2 - s.w1) * ((y - s.y1) / (s.y2 - s.y1 || 1));
  return s.w2 + (s.w3 - s.w2) * Math.min(1, (y - s.y2) / (s.y3 - s.y2 || 1));
}

/** A flat shape (z, y outline, convex) laid on both sides of the body. */
function onBody(k: Kit, part: Part, list: St[], pts: [number, number][], lift = 0.012) {
  k.both((sd) => {
    const v = pts.map(([z, y]): V => [sd * (surfX(lerpSt(list, z), y) + lift), y, z]);
    for (let i = 1; i < v.length - 1; i++) k.tri(part, v[0], v[i], v[i + 1]);
  });
}

/** Door mirrors on stalks, placed on the body's shoulder at z. */
function mirrors(k: Kit, list: St[], z: number) {
  const s0 = lerpSt(list, z);
  k.both((sd) => {
    k.box("trim", 0.14, 0.035, 0.05, sd * (s0.w2 + 0.06), s0.y2 + 0.05, z);
    k.box("paint", 0.15, 0.1, 0.2, sd * (s0.w2 + 0.17), s0.y2 + 0.09, z - 0.03);
    k.box("glass", 0.02, 0.08, 0.16, sd * (s0.w2 + 0.25), s0.y2 + 0.09, z - 0.03);
  });
}

// ── Wheels ──────────────────────────────────────────────────────────────────
type RimStyle = "multi" | "y5" | "aero" | "covered";
type Tyre = "road" | "off" | "slick";
interface WheelGeo { tyre: THREE.BufferGeometry; rimR: THREE.BufferGeometry; rimL: THREE.BufferGeometry; disc: THREE.BufferGeometry; caliper: THREE.BufferGeometry; band: THREE.BufferGeometry | null }
const wheelCache = new Map<string, WheelGeo>();

function wheelGeo(r: number, w: number, style: RimStyle, tyre: Tyre): WheelGeo {
  const key = `${r}|${w}|${style}|${tyre}`;
  const hit = wheelCache.get(key);
  if (hit) return hit;
  const rr = r * (tyre === "off" ? 0.6 : tyre === "slick" ? 0.62 : 0.7); // rim radius
  // Tyre: a lathe of its cross-section (sidewall, rounded shoulder, tread).
  const prof: THREE.Vector2[] = [new THREE.Vector2(rr, -w / 2)];
  const sh = tyre === "slick" ? 0.06 : 0.09;
  for (let i = 0; i <= 6; i++) { const t = (i / 6) * Math.PI / 2; prof.push(new THREE.Vector2(r - sh + Math.sin(t) * sh, -w / 2 + sh - Math.cos(t) * sh)); }
  for (let i = 0; i <= 6; i++) prof.push(new THREE.Vector2(r - sh + Math.cos((i / 6) * Math.PI / 2) * sh, w / 2 - sh + Math.sin((i / 6) * Math.PI / 2) * sh));
  prof.push(new THREE.Vector2(rr, w / 2));
  const parts: THREE.BufferGeometry[] = [new THREE.LatheGeometry(prof, tyre === "off" ? 16 : 22)];
  if (tyre === "off") {
    // Chunky tread blocks.
    for (let i = 0; i < 24; i++) {
      for (const side of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.1, w * 0.4, 0.045);
        // x: along the tread, y: across it (the lathe axis), z: outwards.
        g.translate(0, side * w * 0.22 + (i % 2 ? 0.03 : -0.03), r + 0.01);
        g.rotateY(((i + (side > 0 ? 0.5 : 0)) / 24) * Math.PI * 2);
        parts.push(g);
      }
    }
  }
  const tyreG = merge(parts);
  tyreG.rotateZ(Math.PI / 2);

  // Rim, built for the right-hand side (outer face towards +x).
  const out = w / 2 - 0.04;
  const rp: THREE.BufferGeometry[] = [];
  const lip = new THREE.TorusGeometry(rr, 0.03, 5, 22); lip.rotateY(Math.PI / 2); lip.translate(out, 0, 0); rp.push(lip);
  const barrel = new THREE.CylinderGeometry(rr, rr, w - 0.08, 22, 1, true); barrel.rotateZ(Math.PI / 2); rp.push(barrel);
  const spoke = (n: number, len: number, thick: number, depth: number, twist = 0, xo = 0) => {
    for (let i = 0; i < n; i++) {
      const g = new THREE.BoxGeometry(depth, len, thick);
      g.translate(0, len / 2 + rr * 0.18, 0);
      g.rotateX((i / n) * Math.PI * 2 + twist);
      g.translate(out - 0.02 - xo, 0, 0);
      rp.push(g);
    }
  };
  if (style === "multi") spoke(10, rr * 0.8, 0.045, 0.05);
  else if (style === "y5") { spoke(5, rr * 0.8, 0.05, 0.06, 0.13); spoke(5, rr * 0.8, 0.05, 0.06, -0.13); }
  else if (style === "aero") {
    const d = new THREE.CylinderGeometry(rr * 0.97, rr * 0.97, 0.03, 18); d.rotateZ(Math.PI / 2); d.translate(out - 0.05, 0, 0); rp.push(d);
    spoke(6, rr * 0.75, 0.16, 0.05, 0, -0.03);
  } else {
    const d = new THREE.CylinderGeometry(rr * 0.98, rr * 0.98, 0.03, 20); d.rotateZ(Math.PI / 2); d.translate(out - 0.02, 0, 0); rp.push(d);
  }
  const hub = new THREE.CylinderGeometry(rr * 0.2, rr * 0.24, 0.07, 10); hub.rotateZ(Math.PI / 2); hub.translate(out + 0.01, 0, 0); rp.push(hub);
  const rimR = merge(rp);
  const rimL = rimR.clone(); rimL.scale(-1, 1, 1);
  const disc = new THREE.CylinderGeometry(rr * 0.82, rr * 0.82, 0.03, 18); disc.rotateZ(Math.PI / 2); disc.translate(-0.02, 0, 0);
  const caliper = new THREE.BoxGeometry(0.1, rr * 0.5, rr * 0.45); caliper.translate(0.02, rr * 0.55, -rr * 0.35);
  let band: THREE.BufferGeometry | null = null;
  if (tyre === "slick") { band = new THREE.TorusGeometry((r + rr) / 2, 0.018, 4, 24); band.rotateY(Math.PI / 2); band.translate(w / 2 + 0.005, 0, 0); }
  const res = { tyre: tyreG, rimR, rimL, disc, caliper, band };
  wheelCache.set(key, res);
  return res;
}

// ── The five cars ───────────────────────────────────────────────────────────
interface Spec {
  wheels: Wheel[];
  rim: RimStyle;
  tyre: Tyre;
  /** Where wings and roof extras sit. */
  wing: { z: number; y: number; w: number } | null;
  roof: { z: number; y: number } | null;
  exhausts: V[];
}

function coupe(k: Kit): Spec {
  const wheels: Wheel[] = [
    { x: 0.94, z: 1.5, r: 0.42, w: 0.3, front: true }, { x: -0.94, z: 1.5, r: 0.42, w: 0.3, front: true },
    { x: 0.95, z: -1.45, r: 0.43, w: 0.32, front: false }, { x: -0.95, z: -1.45, r: 0.43, w: 0.32, front: false },
  ];
  const body = arches([
    st(-2.38, 0.34, 0.46, 0.88, 0.76, 0.84, 0.78, 0.74),
    st(-2.15, 0.28, 0.42, 0.97, 0.86, 0.94, 0.88, 0.84),
    st(-1.6, 0.26, 0.42, 1.0, 0.9, 0.96, 0.92, 0.84, "paint", "glass"),
    st(-1.15, 0.26, 0.42, 1.0, 0.91, 0.96, 1.16, 0.74, "glass", "glass"),
    st(-0.7, 0.26, 0.42, 1.01, 0.92, 0.95, 1.33, 0.67, "glass", "paint"),
    st(0.0, 0.26, 0.42, 1.01, 0.92, 0.95, 1.36, 0.68, "glass", "paint"),
    st(0.3, 0.26, 0.42, 1.01, 0.92, 0.95, 1.3, 0.7, "paint", "glass"),
    st(0.72, 0.26, 0.42, 1.0, 0.9, 0.95, 0.93, 0.82),
    st(1.6, 0.27, 0.42, 0.99, 0.83, 0.94, 0.85, 0.82),
    st(2.22, 0.3, 0.42, 0.95, 0.74, 0.88, 0.76, 0.78),
    st(2.45, 0.34, 0.44, 0.86, 0.62, 0.78, 0.63, 0.7),
  ], wheels);
  loft(k, body, { cap: "paint" });
  // Big grille with vertical chrome slats, lower intakes, splitter.
  k.box("trim", 0.82, 0.32, 0.06, 0, 0.5, 2.44);
  for (let i = -4; i <= 4; i++) k.box("chrome", 0.025, 0.3, 0.08, i * 0.088, 0.5, 2.46);
  k.box("chrome", 0.86, 0.03, 0.08, 0, 0.67, 2.45);
  k.both((s) => k.box("trim", 0.32, 0.14, 0.06, s * 0.6, 0.36, 2.44, 0, s * 0.25));
  k.box("trim", 1.75, 0.05, 0.3, 0, 0.27, 2.36);
  // Swept headlights with an LED brow.
  k.both((s) => {
    k.box("trim", 0.46, 0.13, 0.12, s * 0.62, 0.66, 2.3, -0.3, s * 0.42);
    k.box("lamp", 0.4, 0.035, 0.13, s * 0.62, 0.7, 2.32, -0.3, s * 0.42);
  });
  // Tail lights, trunk lip, quad exhaust tips, mirrors, chrome window line.
  k.both((s) => k.box("tail", 0.42, 0.07, 0.05, s * 0.6, 0.7, -2.37, 0, s * -0.2));
  k.box("tail", 0.6, 0.025, 0.05, 0, 0.72, -2.37);
  k.box("paint", 1.5, 0.04, 0.16, 0, 0.9, -2.08, 0.2);
  k.box("trim", 1.4, 0.12, 0.2, 0, 0.32, -2.32);
  mirrors(k, body, 0.5);
  // Chrome line under the side windows.
  for (let z = -1.3; z < 0.3; z += 0.2) onBody(k, "chrome", body, [[z, 0.88], [z + 0.2, 0.88], [z + 0.2, 0.91], [z, 0.91]]);
  return { wheels, rim: "multi", tyre: "road", wing: { z: -2.05, y: 0.92, w: 0.95 }, roof: { z: -0.3, y: 1.36 }, exhausts: [[-0.55, 0.32, -2.4], [-0.38, 0.32, -2.4], [0.38, 0.32, -2.4], [0.55, 0.32, -2.4]] };
}

function furia(k: Kit): Spec {
  const wheels: Wheel[] = [
    { x: 0.94, z: 1.5, r: 0.39, w: 0.3, front: true }, { x: -0.94, z: 1.5, r: 0.39, w: 0.3, front: true },
    { x: 0.96, z: -1.4, r: 0.44, w: 0.36, front: false }, { x: -0.96, z: -1.4, r: 0.44, w: 0.36, front: false },
  ];
  const body = arches([
    st(-2.3, 0.3, 0.44, 0.9, 0.76, 0.86, 0.78, 0.78),
    st(-1.95, 0.26, 0.4, 1.04, 0.9, 1.0, 0.93, 0.88),
    st(-1.0, 0.25, 0.4, 1.06, 0.88, 1.0, 0.92, 0.66, "paint", "gloss"),
    st(-0.3, 0.25, 0.4, 1.02, 0.8, 0.9, 1.16, 0.58, "glass", "gloss"),
    st(0.5, 0.25, 0.4, 1.0, 0.78, 0.9, 1.14, 0.6, "paint", "glass"),
    st(1.2, 0.25, 0.4, 1.0, 0.76, 0.92, 0.78, 0.84),
    st(1.95, 0.25, 0.38, 0.98, 0.68, 0.9, 0.7, 0.8),
    st(2.5, 0.28, 0.36, 0.9, 0.52, 0.82, 0.54, 0.72),
  ], wheels, "round", 0.06);
  loft(k, body, { cap: "paint" });
  // Big side intakes ahead of the rear wheels.
  onBody(k, "trim", body, [[-0.8, 0.44], [-0.2, 0.46], [-0.32, 0.76], [-0.8, 0.8]]);
  // Front: wide black intake, splitter, slim LED headlights, hood vents.
  k.box("trim", 1.4, 0.16, 0.06, 0, 0.36, 2.48);
  k.box("trim", 1.8, 0.04, 0.35, 0, 0.26, 2.4);
  k.both((s) => {
    k.box("lamp", 0.42, 0.045, 0.2, s * 0.62, 0.61, 2.2, -0.15, s * 0.32);
    k.box("trim", 0.45, 0.09, 0.2, s * 0.62, 0.58, 2.19, -0.15, s * 0.32);
    k.box("trim", 0.06, 0.03, 0.4, s * 0.22, 0.735, 1.5, -0.12);
  });
  // Rear: thin tail lights, diffuser fins, high exhausts, mirrors on stalks.
  k.both((s) => k.box("tail", 0.38, 0.04, 0.05, s * 0.55, 0.74, -2.31));
  k.box("trim", 1.5, 0.22, 0.32, 0, 0.36, -2.18);
  for (let i = -3; i <= 3; i++) k.box("trim", 0.03, 0.26, 0.4, i * 0.2, 0.34, -2.25);
  mirrors(k, body, 0.6);
  k.box("gloss", 1.2, 0.03, 0.28, 0, 0.86, -2.15, 0.25); // ducktail
  return { wheels, rim: "multi", tyre: "road", wing: { z: -2.05, y: 0.88, w: 0.95 }, roof: { z: 0.1, y: 1.16 }, exhausts: [[-0.3, 0.62, -2.32], [0.3, 0.62, -2.32]] };
}

function rig(k: Kit): Spec {
  const R = 0.48;
  const wheels: Wheel[] = [
    { x: 0.98, z: 1.72, r: R, w: 0.38, front: true }, { x: -0.98, z: 1.72, r: R, w: 0.38, front: true },
    { x: 0.98, z: -1.68, r: R, w: 0.38, front: false }, { x: -0.98, z: -1.68, r: R, w: 0.38, front: false },
  ];
  // Flat steel planes: one straight line from the nose up over the windscreen
  // to the roof peak, and one straight line down to the tail. Vertical sides.
  loft(k, arches([
    st(-2.6, 0.55, 0.62, 1.08, 1.25, 1.08, 1.3, 1.04),
    st(-1.0, 0.55, 0.62, 1.08, 1.25, 1.08, 1.69, 0.9, "glass"),
    st(-0.15, 0.55, 0.62, 1.08, 1.25, 1.08, 1.9, 0.8, "glass", "glass"),
    st(1.0, 0.55, 0.62, 1.08, 1.25, 1.08, 1.6, 0.95),
    st(2.62, 0.6, 0.66, 1.06, 1.06, 1.06, 1.08, 1.0),
  ], wheels, "trap", 0), { lower: "trim", cap: "paint", inset: 0.03 });
  // Angular black arch cladding.
  for (const w of wheels) {
    const z = w.z, r = w.r, top = 2 * r;
    k.plate("trim", [
      [z - r * 1.45, 0.58], [z - r * 0.95, top + 0.2], [z + r * 0.95, top + 0.2], [z + r * 1.45, 0.58],
      [z + r * 1.22, 0.58], [z + r * 0.8, top + 0.1], [z - r * 0.8, top + 0.1], [z - r * 1.22, 0.58],
    ], 0.04, Math.sign(w.x) * 1.09);
  }
  // Rocker cladding, black bumpers, the full-width light bars.
  k.both((s) => k.box("trim", 0.05, 0.16, 2.0, s * 1.09, 0.66, 0.02));
  k.box("trim", 2.06, 0.4, 0.18, 0, 0.6, 2.6);
  k.box("trim", 2.06, 0.32, 0.16, 0, 0.66, -2.62);
  for (let i = 0; i < 5; i++) k.box("gloss", 1.2, 0.02, 0.04, 0, 0.48 + i * 0.06, 2.7);
  k.box("lamp", 2.02, 0.04, 0.04, 0, 1.03, 2.63);
  k.box("tail", 2.0, 0.045, 0.04, 0, 1.2, -2.62);
  // One big wiper, small mirrors.
  k.box("trim", 1.2, 0.02, 0.05, 0, 1.63, 0.97, 0, 0.25);
  k.both((s) => {
    k.box("trim", 0.12, 0.04, 0.05, s * 1.13, 1.3, 0.9);
    k.box("trim", 0.12, 0.13, 0.2, s * 1.22, 1.36, 0.88);
  });
  return { wheels, rim: "aero", tyre: "off", wing: { z: -2.42, y: 1.3, w: 0.95 }, roof: { z: -0.45, y: 1.86 }, exhausts: [] };
}

function zenith(k: Kit): Spec {
  const wheels: Wheel[] = [
    { x: 0.94, z: 1.45, r: 0.39, w: 0.32, front: true }, { x: -0.94, z: 1.45, r: 0.39, w: 0.32, front: true },
    { x: 0.96, z: -1.4, r: 0.44, w: 0.38, front: false }, { x: -0.96, z: -1.4, r: 0.44, w: 0.38, front: false },
  ];
  const body = arches([
    st(-2.25, 0.32, 0.46, 0.95, 0.84, 0.9, 0.86, 0.84),
    st(-1.85, 0.27, 0.42, 1.05, 0.95, 1.0, 0.97, 0.9),
    st(-0.95, 0.26, 0.42, 1.05, 0.92, 0.98, 1.0, 0.72, "paint", "glass"),
    st(-0.35, 0.26, 0.42, 1.03, 0.86, 0.94, 1.18, 0.6, "glass", "gloss"),
    st(0.42, 0.26, 0.42, 1.0, 0.84, 0.94, 1.16, 0.62, "paint", "glass"),
    st(1.12, 0.26, 0.42, 1.0, 0.8, 0.95, 0.82, 0.86),
    st(1.95, 0.26, 0.4, 0.98, 0.68, 0.92, 0.7, 0.82),
    st(2.42, 0.3, 0.38, 0.9, 0.5, 0.82, 0.52, 0.74),
  ], wheels, "round", 0.05);
  loft(k, body, { cap: "paint" });
  onBody(k, "trim", body, [[-0.82, 0.44], [-0.3, 0.47], [-0.36, 0.8], [-0.82, 0.84]]);
  onBody(k, "accent", body, [[-0.3, 0.47], [-0.2, 0.48], [-0.27, 0.8], [-0.36, 0.8]], 0.016);
  // Big side scoops, hood vent, angular headlights, wide grille, dive planes.
  k.both((s) => {
    k.box("trim", 0.42, 0.1, 0.2, s * 0.6, 0.58, 2.22, -0.2, s * 0.45);
    k.box("lamp", 0.36, 0.035, 0.2, s * 0.6, 0.62, 2.23, -0.2, s * 0.45);
    k.box("trim", 0.3, 0.03, 0.22, s * 0.92, 0.42, 2.3, 0, s * 0.4, s * 0.25);
  });
  k.box("trim", 0.55, 0.03, 0.42, 0, 0.775, 1.55, -0.14);
  k.box("trim", 1.5, 0.2, 0.06, 0, 0.36, 2.44);
  k.box("trim", 1.9, 0.05, 0.4, 0, 0.25, 2.38);
  // Rear: angular tail lights, diffuser, centre quad exhaust.
  k.both((s) => k.box("tail", 0.42, 0.06, 0.05, s * 0.58, 0.78, -2.26, 0, 0, s * 0.18));
  k.box("trim", 1.55, 0.24, 0.3, 0, 0.36, -2.15);
  for (let i = -2; i <= 2; i++) k.box("trim", 0.03, 0.28, 0.36, i * 0.25, 0.34, -2.2);
  mirrors(k, body, 0.5);
  return { wheels, rim: "y5", tyre: "road", wing: { z: -2.0, y: 0.95, w: 1.0 }, roof: { z: 0.0, y: 1.18 }, exhausts: [[-0.16, 0.5, -2.3], [0.16, 0.5, -2.3], [-0.16, 0.36, -2.3], [0.16, 0.36, -2.3]] };
}

function formula(k: Kit, look: Look): Spec {
  const wheels: Wheel[] = [
    { x: 1.02, z: 1.95, r: 0.4, w: 0.36, front: true }, { x: -1.02, z: 1.95, r: 0.4, w: 0.36, front: true },
    { x: 0.98, z: -1.5, r: 0.44, w: 0.5, front: false }, { x: -0.98, z: -1.5, r: 0.44, w: 0.5, front: false },
  ];
  // Monocoque and nose.
  loft(k, [
    st(-0.25, 0.18, 0.24, 0.36, 0.62, 0.34, 0.66, 0.26),
    st(0.9, 0.18, 0.24, 0.36, 0.62, 0.34, 0.7, 0.24),
    st(1.65, 0.2, 0.25, 0.24, 0.52, 0.22, 0.56, 0.16),
    st(2.45, 0.2, 0.24, 0.13, 0.4, 0.11, 0.42, 0.07),
    st(2.78, 0.22, 0.25, 0.06, 0.32, 0.05, 0.33, 0.03),
  ], { lower: "accent", cap: "paint" });
  // Sidepods (black lower, livery on top) and the engine cover with its airbox.
  loft(k, [
    st(-1.5, 0.18, 0.22, 0.3, 0.4, 0.28, 0.42, 0.22),
    st(-0.6, 0.18, 0.22, 0.78, 0.5, 0.74, 0.56, 0.6),
    st(0.25, 0.18, 0.22, 0.8, 0.54, 0.78, 0.6, 0.62),
  ], { lower: "accent", cap: "trim" });
  loft(k, [
    st(-2.25, 0.3, 0.34, 0.13, 0.5, 0.11, 0.52, 0.07),
    st(-1.2, 0.3, 0.34, 0.28, 0.62, 0.26, 0.76, 0.14),
    st(-0.2, 0.3, 0.34, 0.32, 0.66, 0.3, 1.05, 0.16),
    st(0.02, 0.3, 0.34, 0.3, 0.66, 0.28, 1.02, 0.14),
  ], { lower: "accent", cap: "trim" });
  k.plate("paint", [[-1.9, 0.5], [-0.25, 1.0], [-0.25, 1.06], [-1.95, 0.62]], 0.02, 0); // shark fin
  // Cockpit, driver's helmet, halo.
  k.box("trim", 0.44, 0.03, 0.85, 0, 0.7, 0.45);
  const helmet = new THREE.SphereGeometry(0.16, 10, 8); helmet.translate(0, 0.8, 0.22); k.add("white", helmet);
  k.box("trim", 0.22, 0.06, 0.06, 0, 0.82, 0.37);
  const halo = new THREE.TorusGeometry(0.34, 0.03, 5, 14, Math.PI); halo.rotateX(-Math.PI / 2); halo.rotateY(Math.PI); halo.scale(1, 1, 1.3); halo.translate(0, 0.93, 0.25);
  k.add("trim", halo);
  k.rod("trim", [0, 0.68, 0.78], [0, 0.93, 0.68], 0.03);
  // Front wing: three elements and end plates.
  k.box("accent", 2.3, 0.035, 0.36, 0, 0.16, 2.62);
  k.box("paint", 2.15, 0.03, 0.2, 0, 0.23, 2.5, -0.35);
  k.box("paint", 1.95, 0.03, 0.16, 0, 0.3, 2.42, -0.55);
  k.both((s) => k.box("accent", 0.03, 0.26, 0.55, s * 1.16, 0.24, 2.58));
  // Rear wing with flap, beam wing, end plates (the garage can swap it).
  if (look.wing === "stock") {
    k.box("accent", 1.5, 0.05, 0.38, 0, 0.98, -2.35, 0.1);
    k.box("paint", 1.5, 0.04, 0.24, 0, 1.1, -2.45, 0.4);
    k.both((s) => k.plate("paint", [[-2.75, 0.55], [-1.95, 0.6], [-2.0, 1.2], [-2.7, 1.25]], 0.04, s * 0.77));
    k.box("accent", 0.06, 0.45, 0.18, 0, 0.72, -2.2);
  }
  k.box("accent", 1.0, 0.04, 0.25, 0, 0.46, -2.35);
  k.box("tail", 0.14, 0.08, 0.04, 0, 0.55, -2.5);
  // Suspension arms out to the wheels.
  for (const w of wheels) {
    const s = Math.sign(w.x), inner = w.front ? 0.2 : 0.3;
    k.rod("trim", [s * inner, 0.48, w.z + 0.15], [s * (Math.abs(w.x) - 0.2), w.r + 0.08, w.z], 0.022);
    k.rod("trim", [s * inner, 0.3, w.z - 0.15], [s * (Math.abs(w.x) - 0.2), w.r - 0.12, w.z], 0.022);
    k.rod("trim", [s * inner, 0.42, w.z - 0.2], [s * (Math.abs(w.x) - 0.2), w.r + 0.08, w.z], 0.018);
  }
  return { wheels, rim: "covered", tyre: "slick", wing: { z: -2.3, y: 0.55, w: 0.68 }, roof: { z: -0.45, y: 1.04 }, exhausts: [[0, 0.56, -2.28]] };
}

const BUILDERS: Record<string, (k: Kit, look: Look) => Spec> = { coupe, furia, rig, zenith, formula };

/** Wing options from the garage (cars with their own wings keep them). */
function addWing(k: Kit, kind: string, wing: { z: number; y: number; w: number }) {
  const { z, y, w } = wing;
  const plane = (yy: number, d: number, tilt: number) => {
    k.box("accent", w * 2.3, 0.05, d, 0, yy, z, tilt);
    k.both((s) => k.box("trim", 0.03, 0.22, d + 0.05, s * w * 1.16, yy + 0.04, z));
  };
  if (kind === "high" || kind === "twin") {
    plane(y + 0.45, 0.5, 0.08);
    if (kind === "twin") plane(y + 0.72, 0.36, 0.14);
    k.both((s) => k.box("trim", 0.05, 0.46, 0.14, s * 0.6, y + 0.22, z + 0.1));
  } else if (kind === "swan") {
    plane(y + 0.7, 0.55, 0.06);
    k.both((s) => k.box("trim", 0.05, 0.8, 0.12, s * 0.5, y + 0.4, z + 0.25, -0.45));
  } else if (kind === "low") {
    k.box("accent", w * 2, 0.06, 0.28, 0, y + 0.03, z, 0.3);
  }
}

function addExtra(k: Kit, kind: string, roof: { z: number; y: number }) {
  const { z, y } = roof;
  if (kind === "antenna") {
    k.rod("trim", [0.35, y - 0.02, z - 0.5], [0.35, y + 0.9, z - 0.75], 0.018);
    const tip = new THREE.SphereGeometry(0.06, 8, 6); tip.translate(0.35, y + 0.92, z - 0.76); k.add("accent", tip);
  } else if (kind === "lights") {
    k.box("trim", 1.4, 0.12, 0.2, 0, y + 0.06, z + 0.2);
    for (let i = -2; i <= 2; i++) k.box("lamp", 0.2, 0.08, 0.04, i * 0.27, y + 0.06, z + 0.31);
  } else if (kind === "fin") {
    k.plate("accent", [[z - 0.9, y - 0.05], [z + 0.1, y - 0.05], [z - 0.6, y + 0.42], [z - 0.9, y + 0.38]], 0.06, 0);
  } else if (kind === "scoop") {
    k.plate("paint", [[z - 0.4, y - 0.04], [z + 0.45, y - 0.04], [z + 0.3, y + 0.24], [z - 0.2, y + 0.26]], 0.6, 0);
    k.box("trim", 0.5, 0.18, 0.03, 0, y + 0.11, z + 0.36);
  }
}

let roundelTex: THREE.CanvasTexture | null = null;
function roundel() {
  if (roundelTex) return roundelTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  x.fillStyle = "#ffffff"; x.beginPath(); x.arc(32, 32, 30, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#14161f"; x.font = "900 34px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText("7", 32, 34);
  roundelTex = new THREE.CanvasTexture(c);
  roundelTex.colorSpace = THREE.SRGBColorSpace;
  return roundelTex;
}

const colorOf = (slot: "paint" | "accent" | "rims" | "trail", id: string) => (itemOf(slot, id) as Item).color;


/** The world a car's paint reflects (a map's colours). Without it: a photo studio. */
export interface CarEnv { sky: string; fog: string; ground: string; edge: string; wall: string }

/**
 * What the car reflects, painted once on a small canvas (no file to load):
 * a studio with soft boxes for the garage, or the map's sky, horizon and
 * ground with strips of its edge colours (neon in the city). three.js blurs
 * it into the right sharpness for each material.
 */
const envs = new Map<string, THREE.Texture>();
function studioEnv(e?: CarEnv): THREE.Texture {
  const key = e ? `${e.sky}${e.fog}${e.ground}${e.edge}${e.wall}` : "studio";
  const have = envs.get(key);
  if (have) return have;
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, 0, 256);
  const shade = (hex: string, k: number) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;
  if (e) {
    // A little darker than the real sky, so bright maps don't wash the paint out.
    g.addColorStop(0, shade(e.sky, 0.7)); g.addColorStop(0.44, shade(e.fog, 0.75)); g.addColorStop(0.5, shade(e.fog, 0.95));
    g.addColorStop(0.53, shade(e.ground, 0.7)); g.addColorStop(1, shade(e.ground, 0.25));
  } else {
    g.addColorStop(0, "#6f7c99"); g.addColorStop(0.42, "#b9c3d8"); g.addColorStop(0.5, "#f2f5fb");
    g.addColorStop(0.53, "#5a5d6e"); g.addColorStop(0.7, "#24252e"); g.addColorStop(1, "#101015");
  }
  x.fillStyle = g; x.fillRect(0, 0, 512, 256);
  x.shadowBlur = 10;
  if (e) {
    // The sun overhead, and the map's colours as long strips along the horizon.
    x.fillStyle = x.shadowColor = "#ffffff";
    x.beginPath(); x.arc(300, 40, 16, 0, Math.PI * 2); x.fill();
    x.fillStyle = x.shadowColor = e.edge;
    for (const bx of [20, 150, 280, 410]) x.fillRect(bx, 112, 80, 7);
    x.fillStyle = x.shadowColor = e.wall;
    for (const bx of [85, 215, 345, 475]) x.fillRect(bx, 120, 50, 5);
  } else {
    // Soft boxes overhead and long strip lights at the sides.
    x.fillStyle = x.shadowColor = "#ffffff";
    for (const [bx, by, bw, bh] of [[200, 18, 112, 46], [40, 70, 30, 40], [442, 70, 30, 40], [120, 96, 70, 10], [322, 96, 70, 10]]) x.fillRect(bx, by, bw, bh);
  }
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  envs.set(key, t);
  return t;
}

// ── Bodies made in Blender ──────────────────────────────────────────────────
const BODY_URLS: Partial<Record<string, string>> = { coupe: coupeUrl, furia: furiaUrl, zenith: zenithUrl, rig: rigUrl, formula: formulaUrl };
const PARTS = new Set<string>(["paint", "accent", "trim", "gloss", "glass", "lamp", "tail", "metal", "chrome", "white"]);
/** A Blender body: one geometry per part, plus the stock rear wing for cars
 * whose wing the garage can swap (shown only with the "stock" choice). */
interface Body { main: Map<Part, THREE.BufferGeometry>; wing: Map<Part, THREE.BufferGeometry> }
const bodies = new Map<string, Body>();
const loading = new Map<string, Promise<Body | null>>();

/** Reads a packed glb into plain float geometries (world space), one per
 * mesh, with the name of the top-level node each belongs to. */
function readGlb(url: string): Promise<{ name: string; part: string; geo: THREE.BufferGeometry }[]> {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url).then((gltf) => {
    const out: { name: string; part: string; geo: THREE.BufferGeometry }[] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // Stored as small integers (scaled by the node): back to floats first.
      const g = new THREE.BufferGeometry();
      for (const k of ["position", "normal"]) {
        const a = m.geometry.getAttribute(k);
        const f = new Float32Array(a.count * 3);
        for (let i = 0; i < a.count; i++) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); }
        g.setAttribute(k, new THREE.BufferAttribute(f, 3));
      }
      g.setIndex(m.geometry.getIndex());
      g.applyMatrix4(m.matrixWorld);
      g.normalizeNormals();
      m.geometry.dispose();
      let top: THREE.Object3D = m;
      while (top.parent && top.parent !== gltf.scene) top = top.parent;
      out.push({ name: top.name, part: (m.material as THREE.Material).name, geo: g });
    });
    return out;
  });
}

/** Loads (once) the Blender body for this car; null if it has none or it failed. */
export function loadBody(id: string): Promise<Body | null> {
  const have = bodies.get(id);
  if (have) return Promise.resolve(have);
  const url = BODY_URLS[id];
  if (!url) return Promise.resolve(null);
  let p = loading.get(id);
  if (!p) {
    p = readGlb(url).then((meshes) => {
      const merged = (node: (name: string) => boolean) => {
        const lists = new Map<Part, THREE.BufferGeometry[]>();
        for (const { name, part, geo } of meshes) {
          if (!PARTS.has(part) || !node(name)) continue;
          const l = lists.get(part as Part);
          if (l) l.push(geo); else lists.set(part as Part, [geo]);
        }
        const out = new Map<Part, THREE.BufferGeometry>();
        for (const [part, l] of lists) out.set(part, l.length === 1 ? l[0] : mergeGeometries(l, false)!);
        return out;
      };
      const out = { main: merged((n) => n !== "wing"), wing: merged((n) => n === "wing") };
      bodies.set(id, out);
      return out;
    }).catch(() => null);
    loading.set(id, p);
  }
  return p;
}
// ── Wheels made in Blender ──────────────────────────────────────────────────
// Built for radius 1 and width 0.72, outer face towards +x.
const WHEEL_W = 0.72;
let wheelSet: Map<string, THREE.BufferGeometry> | null = null;
let wheelLoading: Promise<Map<string, THREE.BufferGeometry> | null> | null = null;
const realWheelCache = new Map<string, WheelGeo>();

/** Loads (once) the shared Blender wheels; null if they failed. */
export function loadWheels(): Promise<Map<string, THREE.BufferGeometry> | null> {
  if (wheelSet) return Promise.resolve(wheelSet);
  wheelLoading ??= readGlb(wheelsUrl).then((meshes) => {
    wheelSet = new Map(meshes.map((m) => [m.name, m.geo]));
    return wheelSet;
  }).catch(() => null);
  return wheelLoading;
}

/** The Blender wheel for this size and style (null until they've loaded). */
function realWheelGeo(r: number, w: number, style: RimStyle, tyre: Tyre): WheelGeo | null {
  if (!wheelSet) return null;
  const key = `${r}|${w}|${style}|${tyre}`;
  const hit = realWheelCache.get(key);
  if (hit) return hit;
  const set = wheelSet;
  const size = tyre === "off" ? "60" : "70";
  const sized = (name: string) => {
    const g = set.get(name);
    return g ? g.clone().scale(w / WHEEL_W, r, r) : null;
  };
  const tyreG = sized(`tyre_${tyre}`), rim = sized(`rim_${style}`), disc = sized(`disc_${size}`), caliper = sized(`caliper_${size}`);
  if (!tyreG || !rim || !disc || !caliper) return null;
  // One geometry for both sides: left-hand wheels are mirrored by their mesh.
  const res: WheelGeo = { tyre: tyreG, rimR: rim, rimL: rim, disc, caliper, band: tyre === "slick" ? sized("band_slick") : null };
  realWheelCache.set(key, res);
  return res;
}

/** Tail lights with the car's lights on (they brighten when braking). */
const TAIL_ON = "#c0142c";

/** Metallic flake: tiny mirror chips in the paint that glint as the car
 * turns. Worked out from the surface position (the bodies have no texture
 * coordinates) and faded out once a chip is smaller than a pixel, so it shows
 * up close (garage, podium) and never shimmers on a phone screen in a race. */
function flake<T extends THREE.MeshPhysicalMaterial>(m: T, on: boolean): T {
  if (!on) return m;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFlakePos;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvFlakePos = transformed;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFlakePos;")
      .replace("#include <opaque_fragment>", `
        {
          vec3 cell = floor(vFlakePos * 200.0);
          float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          vec3 tilt = vec3(fract(h * 13.7), fract(h * 71.3), fract(h * 29.1)) - 0.5;
          vec3 fn = normalize(normal + tilt * 0.9);
          vec3 key = normalize((viewMatrix * vec4(0.35, 1.0, 0.45, 0.0)).xyz);
          vec3 v = normalize(vViewPosition);
          float glint = pow(max(dot(reflect(v, fn), key), 0.0), 60.0) * step(0.5, h);
          // Only where a chip covers a pixel or more (no sub-pixel shimmer).
          float fine = clamp(1.6 - 1.4 * length(fwidth(vFlakePos * 200.0)), 0.0, 1.0);
          outgoingLight += mix(diffuseColor.rgb, vec3(1.0), 0.6) * glint * fine * 1.2;
        }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => "flake";
  return m;
}

export function buildCar(opts: CarOptions = {}): CarModel {
  const look = opts.look ?? DEFAULT_LOOK;
  const ghost = opts.ghost ?? false;
  const def = itemOf("body", look.body) as BodyDef;
  const build = BUILDERS[def.id] ?? coupe;
  const color = colorOf("paint", look.paint) ?? def.paint;
  const accent = look.accent === "factory" ? def.accent : look.accent === "map" ? opts.mapAccent ?? def.accent : colorOf("accent", look.accent) ?? def.accent;
  const trail = look.trail === "rainbow" ? null : colorOf("trail", look.trail) ?? "#7af7ff";

  // The body (lofted, or Blender's once loaded) and the add-ons, kept apart
  // so the body can be swapped when its model arrives.
  const kb = new Kit();
  const spec = build(kb, look);
  const k = new Kit();
  if (spec.wing && look.wing !== "none") addWing(k, look.wing === "stock" ? (def.id === "zenith" ? "high" : "none") : look.wing, spec.wing);
  if (spec.roof && look.extra !== "none") addExtra(k, look.extra, spec.roof);
  for (const [x, y, z] of spec.exhausts) {
    const p = new THREE.CylinderGeometry(0.065, 0.075, 0.25, 10); p.rotateX(Math.PI / 2); p.translate(x, y, z + 0.06); k.add("chrome", p);
  }

  const root = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const disposers: (() => void)[] = [];
  const keep = <M extends THREE.Material>(m: M) => { mats.push(m); return m; };

  // Materials. Ghosts are one see-through material (cheap and readable).
  const ghostM = ghost === "pb"
    ? keep(new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#8a93a8", transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }))
    : ghost === "wr"
      ? keep(new THREE.MeshPhongMaterial({ color: "#ffd34d", emissive: "#7a4d00", specular: "#fff2b0", shininess: 60, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide }))
      : null;
  const steel = def.id === "rig" && look.paint === "factory";
  const chromePaint = look.paint === "chrome", obsidian = look.paint === "obsidian";
  const D = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 };
  // Real materials that reflect a studio around them: clear-coated paint,
  // mirror chrome, glass that shows the sky.
  const env = studioEnv(opts.env);
  const pbr = (c: string, metalness: number, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    keep(new THREE.MeshStandardMaterial({ color: c, metalness, roughness, envMap: env, side: THREE.DoubleSide, ...extra }));
  const M: Record<Part, THREE.Material> = ghostM
    ? { paint: ghostM, accent: ghostM, trim: ghostM, gloss: ghostM, glass: ghostM, lamp: ghostM, tail: ghostM, metal: ghostM, chrome: ghostM, white: ghostM }
    : {
      paint: keep(flake(new THREE.MeshPhysicalMaterial({
        color: chromePaint ? "#c9d0da" : color, envMap: env, side: THREE.DoubleSide,
        metalness: chromePaint ? 1 : steel ? 0.85 : 0.45, roughness: chromePaint ? 0.06 : steel ? 0.38 : 0.34,
        clearcoat: steel || chromePaint ? 0 : 1, clearcoatRoughness: 0.05, envMapIntensity: 0.85, emissive: obsidian ? "#0b0820" : "#000000",
      }), !steel && !chromePaint)),
      // Details sit on the paint: drawn a hair in front so they never flicker.
      accent: pbr(accent, 0.3, 0.35, D),
      trim: pbr("#16171b", 0.1, 0.75, { envMapIntensity: 0.6, ...D }),
      gloss: pbr("#0b0c0f", 0.3, 0.12, D),
      glass: pbr("#0a101d", 0.2, 0.03, { envMapIntensity: 1.3, emissive: "#03050a", ...D }),
      lamp: keep(new THREE.MeshBasicMaterial({ color: "#f4f8ff", side: THREE.DoubleSide, ...D })),
      tail: keep(new THREE.MeshBasicMaterial({ color: TAIL_ON, side: THREE.DoubleSide, ...D })),
      metal: pbr("#9aa1ad", 0.9, 0.32, D),
      chrome: pbr("#eef1f6", 1, 0.07, D),
      white: pbr("#f2f4f8", 0.1, 0.3, D),
    };
  for (const [p, g] of k.build()) {
    geos.push(g);
    root.add(new THREE.Mesh(g, M[p]));
  }
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);
  let dead = false;
  const lofted: THREE.BufferGeometry[] = [];
  const useBody = (body: Body) => {
    bodyGroup.clear();
    for (const g of lofted.splice(0)) g.dispose();
    // Shared by every car with this body: never disposed here.
    for (const [p, g] of body.main) bodyGroup.add(new THREE.Mesh(g, M[p]));
    if (look.wing === "stock") for (const [p, g] of body.wing) bodyGroup.add(new THREE.Mesh(g, M[p]));
  };
  const ready = bodies.get(def.id);
  if (ready) useBody(ready);
  else {
    for (const [p, g] of kb.build()) { lofted.push(g); bodyGroup.add(new THREE.Mesh(g, M[p])); }
    void loadBody(def.id).then((body) => { if (body && !dead) useBody(body); });
  }
  const tailM = M.tail as THREE.MeshBasicMaterial;

  // Race numbers on the open-wheeler.
  if (!ghost && def.id === "formula") {
    const rm = keep(new THREE.MeshBasicMaterial({ map: roundel(), transparent: true }));
    const rg = new THREE.PlaneGeometry(0.34, 0.34); geos.push(rg);
    for (const s of [1, -1]) {
      const m = new THREE.Mesh(rg, rm);
      m.position.set(s * 0.792, 0.42, -0.35);
      m.rotation.y = s * Math.PI / 2;
      root.add(m);
    }
  }

  // Glowing pipe ends and the boost flames.
  const glowM = keep(new THREE.MeshBasicMaterial({ color: "#3a2418", transparent: !!ghost, opacity: ghost ? 0.3 : 1 }));
  const flameM = keep(new THREE.MeshBasicMaterial({ color: trail ?? "#ff5fd2", transparent: true, opacity: ghost ? 0.3 : 0.85, depthWrite: false }));
  const endG = new THREE.CircleGeometry(0.05, 10); endG.rotateY(Math.PI); geos.push(endG);
  const flameG = new THREE.ConeGeometry(0.13, 1.2, 8); flameG.rotateX(-Math.PI / 2); geos.push(flameG);
  const flames: THREE.Mesh[] = [];
  // Electric truck: the boost glows from under the rear bumper instead.
  const jets: V[] = spec.exhausts.length ? spec.exhausts : [[-0.6, 0.5, -2.62], [0.6, 0.5, -2.62]];
  for (const [x, y, z] of jets) {
    if (spec.exhausts.length) { const e = new THREE.Mesh(endG, glowM); e.position.set(x, y, z - 0.07); root.add(e); }
    const f = new THREE.Mesh(flameG, flameM); f.position.set(x, y, z - 0.68); f.visible = false; root.add(f);
    flames.push(f);
  }
  let hue = 0;

  // ── Wheels: tyre, rim and brake disc spin; the caliper doesn't ──
  const rimColor = look.rims === "stock" ? (def.id === "rig" ? "#2a2c31" : def.id === "formula" ? "#15161a" : "#1d1f24")
    : look.rims === "accent" ? accent : colorOf("rims", look.rims) ?? accent;
  const tyreM = ghostM ?? pbr("#141418", 0, 0.88, { envMapIntensity: 0.5 });
  const rimM = ghostM ?? (look.rims === "neon"
    ? keep(new THREE.MeshBasicMaterial({ color: rimColor, side: THREE.DoubleSide }))
    : pbr(rimColor, 0.85, 0.22));
  const bandM = ghostM ?? keep(new THREE.MeshBasicMaterial({ color: "#ffd21a" }));
  const caliperM = ghostM ?? (def.id === "rig" ? M.trim : pbr(def.id === "coupe" && look.accent === "factory" ? "#c8102e" : accent, 0.3, 0.4));
  const wheelList: { pivot: THREE.Group; spin: THREE.Group; front: boolean; r: number }[] = [];
  // Ghosts keep the simple wheels (cheaper, and they're see-through anyway).
  const fitWheels = () => {
    for (let i = 0; i < spec.wheels.length; i++) {
      const w = spec.wheels[i], { pivot, spin } = wheelList[i];
      const real = ghost ? null : realWheelGeo(w.r, w.w, spec.rim, spec.tyre);
      const geo = real ?? wheelGeo(w.r, w.w, spec.rim, spec.tyre);
      const s = w.x < 0 ? -1 : 1;
      const mesh = (parent: THREE.Group, g: THREE.BufferGeometry, m: THREE.Material, mirror: boolean) => {
        const o = new THREE.Mesh(g, m);
        if (mirror) o.scale.x = s;
        parent.add(o);
      };
      pivot.clear(); spin.clear();
      mesh(spin, geo.tyre, tyreM, true);
      if (real) mesh(spin, geo.rimR, rimM, true);
      else mesh(spin, s > 0 ? geo.rimR : geo.rimL, rimM, false);
      if (geo.band) mesh(spin, geo.band, bandM, true);
      if (!ghost && spec.rim !== "covered") {
        mesh(spin, geo.disc, M.metal, true);
        mesh(pivot, geo.caliper, caliperM, true);
      }
      pivot.add(spin);
    }
  };
  for (const w of spec.wheels) {
    const pivot = new THREE.Group(); pivot.position.set(w.x, w.r, w.z);
    const spin = new THREE.Group();
    root.add(pivot);
    wheelList.push({ pivot, spin, front: w.front, r: w.r });
  }
  fitWheels();
  // Shared by every car: never disposed here.
  if (!ghost && !wheelSet) void loadWheels().then((set) => { if (set && !dead) fitWheels(); });

  if (ghost === "wr") {
    // A crown floating over the car: a band with five points.
    const crownM = keep(new THREE.MeshBasicMaterial({ color: "#ffcf3a" }));
    const band = new THREE.CylinderGeometry(0.5, 0.45, 0.28, 10, 1, true); band.translate(0, 2.35, -0.3); geos.push(band);
    root.add(new THREE.Mesh(band, crownM));
    const tip = new THREE.ConeGeometry(0.13, 0.38, 4); geos.push(tip);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const m = new THREE.Mesh(tip, crownM);
      m.position.set(Math.sin(a) * 0.46, 2.66, -0.3 + Math.cos(a) * 0.46);
      root.add(m);
    }
    if (opts.label) {
      const sprite = nameTag(opts.label);
      sprite.position.set(0, 3.4, -0.3);
      root.add(sprite);
      disposers.push(() => { (sprite.material as THREE.SpriteMaterial).map?.dispose(); sprite.material.dispose(); });
    }
  }

  let steerAngle = 0, braking = false;
  return {
    root,
    update(speed, steer, dt, brake = false) {
      steerAngle += (-steer * 0.45 - steerAngle) * Math.min(1, dt * 12);
      for (const w of wheelList) {
        w.spin.rotation.x += (speed / w.r) * dt;
        if (w.front) w.pivot.rotation.y = steerAngle;
      }
      if (!ghost && brake !== braking) { braking = brake; tailM.color.set(brake ? "#ff2a3d" : TAIL_ON); }
    },
    setBoost(on) {
      for (const f of flames) { f.visible = on; f.scale.z = on ? 0.8 + Math.random() * 0.5 : 1; }
      if (on && !trail && !ghost) { hue = (hue + 0.02) % 1; flameM.color.setHSL(hue, 1, 0.6); }
      glowM.color.set(on ? (trail ?? flameM.color.getStyle()) : "#3a2418");
    },
    dispose() {
      dead = true;
      for (const g of lofted) g.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const d of disposers) d();
    },
  };
}

/** A crown and "Name · 1:02.345" on a gold pill, always facing the camera. */
function nameTag(text: string): THREE.Sprite {
  const c = document.createElement("canvas");
  const x = c.getContext("2d")!;
  const font = "600 30px system-ui, sans-serif";
  x.font = font;
  const w = Math.min(512, Math.ceil(x.measureText(text).width) + 74);
  c.width = w; c.height = 48;
  x.font = font;
  x.fillStyle = "rgba(40,28,0,0.78)";
  x.beginPath(); x.roundRect(0, 0, w, 48, 24); x.fill();
  x.fillStyle = "#ffd34d";
  // A small crown (drawn, not an emoji).
  x.beginPath();
  x.moveTo(16, 33); x.lineTo(14, 16); x.lineTo(21, 23); x.lineTo(27, 13); x.lineTo(33, 23); x.lineTo(40, 16); x.lineTo(38, 33);
  x.closePath(); x.fill();
  x.textBaseline = "middle"; x.textAlign = "center";
  x.fillText(text, (w + 38) / 2, 25, w - 62);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set((w / 48) * 0.9, 0.9, 1);
  return s;
}

/** A soft round shadow under the car (a canvas texture, no shadow maps). */
export function blobShadow() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const geo = new THREE.PlaneGeometry(3.4, 5.4);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, dispose() { tex.dispose(); geo.dispose(); mat.dispose(); } };
}
