// Copied from web/src/hexdrift by scripts/hexdrift-share.mjs. Don't edit here.
// Free parts: blocks, wedges, ramps, cylinders and balls that players place in
// the studio editor, each turned any way and made of a material. The car
// drives on any face flat enough to stand on and bumps off the rest.
//
// Contact uses each shape's signed distance (how far a point is outside it):
// the car is a ball resting on its lowest point, so a part pushes it out
// along the distance's slope. Deterministic: only +, -, *, /, sqrt and the
// sim's own sine (math.ts).
import { dcos, dsin } from "./math.ts";

export type Shape = "box" | "wedge" | "ramp" | "cyl" | "ball";
export type Mat = "solid" | "bouncy" | "ice" | "boost" | "kill";
export const SHAPES: Shape[] = ["box", "wedge", "ramp", "cyl", "ball"];
export const MATS: Mat[] = ["solid", "bouncy", "ice", "boost", "kill"];

/** A part as saved: centre, size (metres), turn (degrees: yaw, pitch, roll), material, colour. */
export interface PartDef {
  s: Shape;
  p: [number, number, number];
  z: [number, number, number];
  r?: [number, number, number];
  m?: Mat;
  c?: string;
}

export interface Part {
  def: PartDef;
  shape: Shape; mat: Mat;
  x: number; y: number; z: number;
  hx: number; hy: number; hz: number;
  /** Rotation, local → world, by rows: world = M · local. */
  m: number[];
  /** Bounding radius (for the grid). */
  rad: number;
}

export interface Parts { list: Part[]; grid: Map<number, Part[]> }

const PB = 16; // grid bucket, metres
const pkey = (i: number, j: number) => (i + 8192) * 16384 + (j + 8192);
const DEG = 3.141592653589793 / 180;

/** Limits on what a part may be (the editor and the server both clamp to these). */
export const PART_LIMITS = { count: 400, size: 120, minSize: 0.5, reach: 6000 };

export function buildParts(defs: PartDef[] | undefined): Parts {
  const list: Part[] = [];
  const grid = new Map<number, Part[]>();
  for (const d of defs ?? []) {
    const [yaw, pitch, roll] = (d.r ?? [0, 0, 0]).map((a) => a * DEG);
    const cy = dcos(yaw), sy = dsin(yaw), cp = dcos(pitch), sp = dsin(pitch), cr = dcos(roll), sr = dsin(roll);
    // M = Ry(yaw) · Rx(pitch) · Rz(roll)
    const m = [
      cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp,
      cp * sr, cp * cr, -sp,
      -sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp,
    ];
    let [hx, hy, hz] = d.z.map((v) => v / 2);
    if (d.s === "ball") hx = hy = hz = Math.max(hx, hy, hz);
    if (d.s === "cyl") hz = hx = Math.max(hx, hz);
    const part: Part = { def: d, shape: d.s, mat: d.m ?? "solid", x: d.p[0], y: d.p[1], z: d.p[2], hx, hy, hz, m, rad: Math.sqrt(hx * hx + hy * hy + hz * hz) };
    list.push(part);
    const r = part.rad + 2;
    for (let i = Math.floor((part.x - r) / PB); i <= Math.floor((part.x + r) / PB); i++) {
      for (let j = Math.floor((part.z - r) / PB); j <= Math.floor((part.z + r) / PB); j++) {
        const k = pkey(i, j);
        const b = grid.get(k);
        if (b) b.push(part); else grid.set(k, [part]);
      }
    }
  }
  return { list, grid };
}

const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

/** Signed distance from a point in the part's own frame to its surface (negative inside). */
export function sdf(p: Part, qx: number, qy: number, qz: number): number {
  const { hx, hy, hz } = p;
  if (p.shape === "ball") return len3(qx, qy, qz) - hx;
  if (p.shape === "cyl") {
    const dr = Math.sqrt(qx * qx + qz * qz) - hx, dy = (qy < 0 ? -qy : qy) - hy;
    const ox = dr > 0 ? dr : 0, oy = dy > 0 ? dy : 0;
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dr, dy), 0);
  }
  const dx = (qx < 0 ? -qx : qx) - hx, dy = (qy < 0 ? -qy : qy) - hy, dz = (qz < 0 ? -qz : qz) - hz;
  const box = len3(dx > 0 ? dx : 0, dy > 0 ? dy : 0, dz > 0 ? dz : 0) + Math.min(Math.max(dx, dy, dz), 0);
  if (p.shape === "box") return box;
  // Wedge and ramp: the box below a slope rising toward +z (from the bottom back edge to the top front edge).
  const k = hy / hz, n = Math.sqrt(1 + k * k);
  const plane = (qy - k * qz) / n;
  return box > plane ? box : plane;
}

/** World point → the part's frame. */
function toLocal(p: Part, x: number, y: number, z: number): [number, number, number] {
  const dx = x - p.x, dy = y - p.y, dz = z - p.z, m = p.m;
  // Mᵀ · d
  return [m[0] * dx + m[3] * dy + m[6] * dz, m[1] * dx + m[4] * dy + m[7] * dz, m[2] * dx + m[5] * dy + m[8] * dz];
}

/** Outward surface direction at a world point (from the distance's slope), in world space. */
function normalAt(p: Part, q: [number, number, number]): [number, number, number] {
  const e = 0.02;
  const gx = sdf(p, q[0] + e, q[1], q[2]) - sdf(p, q[0] - e, q[1], q[2]);
  const gy = sdf(p, q[0], q[1] + e, q[2]) - sdf(p, q[0], q[1] - e, q[2]);
  const gz = sdf(p, q[0], q[1], q[2] + e) - sdf(p, q[0], q[1], q[2] - e);
  const m = p.m;
  let wx = m[0] * gx + m[1] * gy + m[2] * gz, wy = m[3] * gx + m[4] * gy + m[5] * gz, wz = m[6] * gx + m[7] * gy + m[8] * gz;
  const l = len3(wx, wy, wz) || 1;
  wx /= l; wy /= l; wz /= l;
  return [wx, wy, wz];
}

export interface PartCar {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  grounded: boolean; nx: number; ny: number; nz: number;
}
export interface PartHit {
  /** Standing on a part (its material), or "" when not. */
  ground: Mat | "";
  /** Touching a part of this material (boost and kill work on any face). */
  touch: Mat | "";
  /** Speed lost into a part this step. */
  hit: number;
  land: number;
  /** The ground's normal, when standing on a part. */
  nx: number; ny: number; nz: number;
}

/** The car's ball: radius, its centre this far above the car's point. */
export const BALL = 1.1;
/** Faces this flat (normal's up part) can be driven on. */
const FLAT = 0.55;

/**
 * Pushes the car out of the parts it touches. `sticky`: it stood on a part last
 * step, so a face just below it still holds it (like the road's reach).
 */
export function hitParts(parts: Parts, car: PartCar, sticky: boolean): PartHit {
  const out: PartHit = { ground: "", touch: "", hit: 0, land: 0, nx: 0, ny: 1, nz: 0 };
  const list = parts.grid.get(pkey(Math.floor(car.x / PB), Math.floor(car.z / PB)));
  if (!list) return out;
  for (let pass = 0; pass < 2; pass++) {
    for (const p of list) {
      const cy = car.y + BALL;
      const dx = car.x - p.x, dy = cy - p.y, dz = car.z - p.z;
      if (dx * dx + dy * dy + dz * dz > (p.rad + BALL + 0.5) * (p.rad + BALL + 0.5)) continue;
      const q = toLocal(p, car.x, cy, car.z);
      const d = sdf(p, q[0], q[1], q[2]);
      const reach = sticky && pass === 0 ? 0.45 : 0;
      if (d >= BALL + reach) continue;
      const [nx, ny, nz] = normalAt(p, q);
      const pen = BALL - d;
      if (p.mat === "kill") { out.touch = "kill"; return out; }
      if (p.mat === "boost") out.touch = "boost";
      if (ny > FLAT) {
        // Stand on it: lift straight up so the car doesn't slide down slopes.
        const into = car.vx * nx + car.vy * ny + car.vz * nz;
        if (p.mat === "bouncy" && into < -6) {
          car.y += pen / ny;
          car.vx -= nx * into * 1.85; car.vy -= ny * into * 1.85; car.vz -= nz * into * 1.85;
          out.land = -into;
          continue;
        }
        if (pen < 0 && car.vy > 2) continue; // flying up off it
        car.y += pen / ny;
        if (!car.grounded && !out.ground) out.land = -into > 0 ? -into : 0;
        if (into < 0 || car.grounded) { car.vx -= nx * into; car.vy -= ny * into; car.vz -= nz * into; }
        out.ground = p.mat; out.nx = nx; out.ny = ny; out.nz = nz;
      } else if (pen > 0) {
        car.x += nx * pen; car.y += ny * pen; car.z += nz * pen;
        const into = car.vx * nx + car.vy * ny + car.vz * nz;
        if (into < 0) {
          const e = p.mat === "bouncy" ? 1.9 : 1.15;
          car.vx -= nx * into * e; car.vy -= ny * into * e; car.vz -= nz * into * e;
          if (p.mat !== "bouncy") { car.vx *= 0.96; car.vz *= 0.96; }
          if (-into > out.hit) out.hit = -into;
        }
      }
    }
  }
  return out;
}
