// One race: the car, the clock, checkpoints and the finish. Runs at exactly
// 60 steps a second. Every step takes one input byte, so a whole run is just
// a list of bytes: replaying them gives the exact same drive (ghosts, and
// record checks on the server later).
import { clamp, dcos, dsin } from "./math.ts";
import { CELL, DIRV, groundAt, HALF_W, heightAlong, key, local, CURVE_IN, CURVE_OUT, LEVEL, THICK, WALL_H, WALL_T, yawOf, type Piece, type Track } from "./track.ts";
import { NO_GROUND, terrainAt } from "./terrain.ts";

/**
 * Bump whenever the handling or track physics change: runs from older
 * physics can't be replayed exactly, so their records and ghosts are dropped.
 */
export const PHYSICS_V = 4;

export const HZ = 60;
const DT = 1 / HZ;
export const COUNTDOWN = 3 * HZ;

// Handling (same for every car).
const ENGINE = 14;
const VMAX = 62;
const BOOST = 80;
const GRAVITY = 32;
const CAR_R = 1.1;
const CAR_H = 1.2; // the car's height, for hitting things above it
const STEP = 0.5; // curbs this high are driven over
const VMAX_OFF = 24; // top speed on the ground beside the road

// ── Inputs: one byte per step ───────────────────────────────────────────────
// bits 0-3 steering (0..14 → -7..7, + is right), 4 gas, 5 brake, 6 drift, 7 respawn
export interface Input { steer: number; gas: boolean; brake: boolean; drift: boolean; respawn: boolean }
export const NO_INPUT: Input = { steer: 0, gas: false, brake: false, drift: false, respawn: false };

export function pack(i: Input): number {
  const s = Math.round(clamp(i.steer, -1, 1) * 7) + 7;
  return s | (i.gas ? 16 : 0) | (i.brake ? 32 : 0) | (i.drift ? 64 : 0) | (i.respawn ? 128 : 0);
}

// ── The car ─────────────────────────────────────────────────────────────────
export interface Car {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; yawRate: number;
  grounded: boolean;
  nx: number; ny: number; nz: number; // ground normal (for tilting the model)
  speed: number; // forward speed, units/s
  slip: number; // sideways speed (drift smoke)
  boosting: number; // steps left of boost glow
  offroad: boolean; // driving on the ground, not the road
}

function place(car: Car, p: Piece) {
  car.x = p.x * CELL; car.z = p.z * CELL; car.y = p.y * LEVEL;
  car.vx = car.vy = car.vz = 0;
  car.yaw = yawOf(p.d); car.yawRate = 0;
  car.grounded = true; car.nx = 0; car.ny = 1; car.nz = 0;
  car.speed = 0; car.slip = 0; car.boosting = 0; car.offroad = false;
}

export type Phase = "countdown" | "running" | "finished";

export interface Race {
  track: Track;
  car: Car;
  phase: Phase;
  tick: number; // steps since the start (countdown included)
  cps: Set<number>;
  respawnAt: Piece;
  inputs: number[]; // one byte per running step
  /** Checkpoint split times, in steps since GO. */
  splits: number[];
  finishTicks: number;
}

export function newRace(track: Track): Race {
  const car = {} as Car;
  place(car, track.start);
  return { track, car, phase: "countdown", tick: 0, cps: new Set(), respawnAt: track.start, inputs: [], splits: [], finishTicks: 0 };
}

/** Steps since GO (the race time). */
export const raceTicks = (r: Race) => Math.max(0, (r.phase === "finished" ? r.finishTicks : r.tick - COUNTDOWN));

/** Advances one step (1/60 s). */
export function step(r: Race, byte: number) {
  r.tick++;
  if (r.phase === "countdown") {
    if (r.tick >= COUNTDOWN) r.phase = "running";
    return;
  }
  if (r.phase === "finished") return;
  r.inputs.push(byte);
  const steer = ((byte & 15) - 7) / 7;
  const gas = (byte & 16) !== 0, brake = (byte & 32) !== 0, drift = (byte & 64) !== 0;
  const car = r.car;

  if (byte & 128) { respawn(r); return; }

  const fx = dsin(car.yaw), fz = dcos(car.yaw);
  if (car.grounded) {
    const off = car.offroad;
    const g = off ? null : groundAt(r.track, car.x, car.y, car.z, 0.6);
    const ice = g?.piece.ice === true;
    const nx = car.nx, ny = car.ny, nz = car.nz;
    // Forward and right along the road's surface.
    let tx = fx - nx * (fx * nx + fz * nz), ty = -ny * (fx * nx + fz * nz), tz = fz - nz * (fx * nx + fz * nz);
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    tx /= tl; ty /= tl; tz /= tl;
    const rx = ty * nz - tz * ny, ry = tz * nx - tx * nz, rz = tx * ny - ty * nx;
    let vf = car.vx * tx + car.vy * ty + car.vz * tz;
    let vl = car.vx * rx + car.vy * ry + car.vz * rz;

    if (gas) vf += ENGINE * (1 - vf / (off ? VMAX_OFF : VMAX)) * DT * (vf < 0 ? 2.5 : 1);
    if (off) vf -= vf * 1.2 * DT; // grass and sand are slow
    if (brake) {
      if (vf > 0.5) vf -= 58 * DT;
      else vf = Math.max(vf - 20 * DT, -16);
    }
    if (!gas && !brake) vf -= vf * 0.35 * DT;
    vf -= vf * (vf < 0 ? -vf : vf) * 0.0006 * DT;
    if (drift) vf -= vf * 0.12 * DT;
    if (g && g.piece.t === "boost") { vf = Math.min(vf + BOOST * DT, VMAX * 1.45); car.boosting = 40; }
    if (car.boosting > 0) car.boosting--;

    const grip = (drift ? 1.5 : 10) * (ice ? 0.2 : 1) * (off ? 0.6 : 1);
    vl -= vl * Math.min(1, grip * DT);
    car.vx = tx * vf + rx * vl; car.vy = ty * vf + ry * vl; car.vz = tz * vf + rz * vl;
    // Gravity along the slope.
    car.vx -= GRAVITY * DT * (0 - nx * ny); car.vy -= GRAVITY * DT * (1 - ny * ny); car.vz -= GRAVITY * DT * (0 - nz * ny);

    const sp = vf < 0 ? -vf : vf;
    let target = -steer * 2.0 * Math.min(1, sp / 6) / (1 + sp / 50) * (vf < 0 ? -1 : 1);
    if (drift) target *= 1.45;
    car.yawRate += (target - car.yawRate) * Math.min(1, (ice ? 2.5 : 5) * DT);
    car.speed = vf; car.slip = vl;
  } else {
    car.vy -= GRAVITY * DT;
    car.yawRate += (-steer * 1.6 - car.yawRate) * Math.min(1, 6 * DT);
    car.speed = car.vx * fx + car.vz * fz;
    car.slip = 0;
    if (car.boosting > 0) car.boosting--;
  }
  car.yaw += car.yawRate * DT;

  const px = car.x, py = car.y, pz = car.z;
  car.x += car.vx * DT; car.y += car.vy * DT; car.z += car.vz * DT;

  // Stay on the road, drive on the ground beside it, or fly.
  const g = groundAt(r.track, car.x, car.y, car.z, car.grounded ? 0.9 : Math.max(0.3, py - car.y + 0.3));
  const ter = terrainAt(r.track, car.x, car.z);
  if (g && (car.grounded ? car.y - g.h < 0.9 : car.y <= g.h + 0.05) && g.h >= ter.h - 0.01) {
    if (!car.grounded) {
      // Landing: keep the speed along the road, lose a little.
      car.vx *= 0.97; car.vz *= 0.97;
    }
    car.y = g.h;
    settle(car, g.nx, g.ny, g.nz);
    car.offroad = false;
    reached(r, g.piece);
  } else if (ter.h > NO_GROUND && car.y <= ter.h + (car.grounded && car.offroad ? 0.9 : 0.05)) {
    if (ter.ravine) { respawn(r); return; }
    if (py < ter.h - 0.9) {
      // Ran into a steep bank: stop at it.
      car.x = px; car.z = pz;
      car.vx *= -0.2; car.vz *= -0.2;
      if (car.y < py) car.y = py;
    } else {
      if (!car.grounded) { car.vx *= 0.9; car.vz *= 0.9; }
      car.y = ter.h;
      const e = 0.6;
      const hx = terrainAt(r.track, car.x + e, car.z).h - terrainAt(r.track, car.x - e, car.z).h;
      const hz = terrainAt(r.track, car.x, car.z + e).h - terrainAt(r.track, car.x, car.z - e).h;
      const ax = -hx / (2 * e), az = -hz / (2 * e);
      const n = 1 / Math.sqrt(ax * ax + 1 + az * az);
      settle(car, ax * n, n, az * n);
      car.offroad = true;
    }
  } else {
    car.grounded = false;
    car.offroad = false;
    car.nx = 0; car.ny = 1; car.nz = 0;
  }
  solids(r, px, pz);
  if (car.y < r.track.minY - 30) respawn(r);
}

/** Stands the car on a surface with this normal. */
function settle(car: Car, nx: number, ny: number, nz: number) {
  const into = car.vx * nx + car.vy * ny + car.vz * nz;
  if (into < 0 || car.grounded) { car.vx -= nx * into; car.vy -= ny * into; car.vz -= nz * into; }
  car.grounded = true;
  car.nx = nx; car.ny = ny; car.nz = nz;
}

/**
 * Roads are solid: the slab's sides and underside, its end where the road
 * stops, and the walls all push the car out, on the road or in the air.
 */
function solids(r: Race, px: number, pz: number) {
  const car = r.car;
  const cx = Math.round(car.x / CELL), cz = Math.round(car.z / CELL);
  for (let ox = -1; ox <= 1; ox++) {
    for (let oz = -1; oz <= 1; oz++) {
      const list = r.track.cells.get(key(cx + ox, cz + oz));
      if (list) for (const p of list) hitPiece(car, p, px, pz);
    }
  }
}

function hitPiece(car: Car, p: Piece, px: number, pz: number) {
  const { u, w } = local(p, car.x, car.z);
  const curve = p.t === "curveL" || p.t === "curveR";
  if (curve) {
    if (u < -CELL / 2 || u > CELL / 2 || w < -CELL / 2 || w > CELL / 2) return;
  } else if (w < -CELL / 2 - (p.endIn ? CAR_R : 0) || w > CELL / 2 + (p.endOut ? CAR_R : 0)) return;
  const [fx, fz] = DIRV[p.d];
  const [rx, rz] = DIRV[(p.d + 1) % 4];
  // c runs across the road (or out from a curve's centre); [a, b] is the road.
  let c: number, pc: number, a: number, b: number, dx: number, dz: number;
  if (curve) {
    const cu = p.t === "curveR" ? CELL / 2 : -CELL / 2;
    const du = u - cu, dw = w + CELL / 2;
    c = Math.sqrt(du * du + dw * dw) || 1e-6;
    dx = (rx * du + fx * dw) / c; dz = (rz * du + fz * dw) / c;
    const q = local(p, px, pz);
    const qu = q.u - cu, qw = q.w + CELL / 2;
    pc = Math.sqrt(qu * qu + qw * qw);
    a = CURVE_IN; b = CURVE_OUT;
  } else {
    c = u; pc = local(p, px, pz).u; a = -HALF_W; b = HALF_W; dx = rx; dz = rz;
  }
  const h = heightAlong(p, w);
  const wt = p.wall ? WALL_T : 0;
  push(car, p, c, w, h - THICK, h, a - wt, b + wt, false, dx, dz, fx, fz, curve, pc);
  if (p.wall) {
    push(car, p, c, w, h, h + WALL_H, a - WALL_T, a, true, dx, dz, fx, fz, curve, pc);
    push(car, p, c, w, h, h + WALL_H, b, b + WALL_T, true, dx, dz, fx, fz, curve, pc);
  }
}

/** Pushes the car out of one solid block (lo..hi across, y0..y1 up) the shortest way. */
function push(car: Car, p: Piece, c: number, w: number, y0: number, y1: number, lo: number, hi: number,
  wall: boolean, dx: number, dz: number, fx: number, fz: number, curve: boolean, pc: number) {
  const eps = 1e-4;
  if (c + CAR_R <= lo || c - CAR_R >= hi || car.y + CAR_H <= y0 + eps || car.y >= y1 - eps) return;
  let best = Infinity, kind = 0;
  const take = (pen: number, k: number) => { if (pen < best) { best = pen; kind = k; } };
  if (wall) {
    // Walls are thin: push back to the side the car came from.
    if (pc < (lo + hi) / 2) take(c + CAR_R - lo, 1); else take(hi - (c - CAR_R), 2);
  } else {
    take(c + CAR_R - lo, 1);
    take(hi - (c - CAR_R), 2);
    take(car.y + CAR_H - y0, 3);
    if (y1 - car.y <= STEP) take(y1 - car.y, 4);
    if (!curve) {
      take(p.endIn ? w + CAR_R + CELL / 2 : Infinity, 5);
      take(p.endOut ? CELL / 2 - (w - CAR_R) : Infinity, 6);
    }
  }
  if (best === Infinity) return;
  let nx = 0, nz = 0;
  if (kind === 1) { nx = -dx; nz = -dz; }
  else if (kind === 2) { nx = dx; nz = dz; }
  else if (kind === 5) { nx = -fx; nz = -fz; }
  else if (kind === 6) { nx = fx; nz = fz; }
  if (kind === 3) { car.y -= best; if (car.vy > 0) car.vy = 0; return; }
  if (kind === 4) { car.y += best; if (car.vy < 0) car.vy = 0; return; }
  car.x += nx * best; car.z += nz * best;
  const vin = car.vx * nx + car.vz * nz;
  if (vin < 0) { car.vx -= nx * vin * 1.3; car.vz -= nz * vin * 1.3; car.vx *= 0.96; car.vz *= 0.96; }
}

function reached(r: Race, p: Piece) {
  if (p.t === "checkpoint" && p.cp !== undefined && !r.cps.has(p.cp)) {
    r.cps.add(p.cp);
    r.respawnAt = p;
    r.splits.push(raceTicks(r));
  }
  if (p.t === "finish" && r.cps.size === r.track.checkpoints) {
    r.phase = "finished";
    r.finishTicks = r.tick - COUNTDOWN;
  }
}

function respawn(r: Race) {
  place(r.car, r.respawnAt);
}

/** "1:02.350" from steps. */
export function formatTime(ticks: number) {
  const ms = Math.round((ticks * 1000) / HZ);
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), t = ms % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(t).padStart(3, "0")}`;
}
