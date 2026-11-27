// One race: the car, the clock, checkpoints and the finish. Runs at exactly
// 60 steps a second. Every step takes one input byte, so a whole run is just
// a list of bytes: replaying them gives the exact same drive (ghosts, and
// record checks on the server later).
import { clamp, dcos, dsin } from "./math.ts";
import { CELL, DIRV, groundAt, HALF_W, heightAlong, key, local, CURVE_IN, CURVE_OUT, LEVEL, THICK, WALL_H, WALL_T, yawOf, type Piece, type Spot, type Track } from "./track.ts";
import { roadSolids, type Loop } from "./road.ts";
import { hitParts, type Mat } from "./parts.ts";
import { NO_GROUND, terrainAt } from "./terrain.ts";
import { hitSolids } from "./props.ts";

/**
 * Bump whenever the handling or track physics change: runs from older
 * physics can't be replayed exactly, so their records and ghosts are dropped.
 * Version 8 is meant to be the final one: every leaderboard and all medal
 * points started fresh with it.
 */
export const PHYSICS_V = 8;

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
  drift: number; // 0..1: how far into a drift (eases in fast, out slowly)
  // Read-outs for effects and sounds (never read back by the physics):
  hit: number; // speed lost into a wall or a solid this step
  land: number; // speed downwards when it landed this step
  /** Top speed on the ground it's driving on (off the road). */
  rough: number;
  /** Going round a loop (its index; -1 when not): distance round it, and across it. */
  loop: number; ls: number; ll: number;
  /** Which way the car points in a loop (for drawing it). */
  tx: number; ty: number; tz: number;
  /** The material of the part it stands on ("" when not on a part). */
  part: Mat | "";
}

function place(car: Car, p: Spot) {
  car.x = p.x; car.z = p.z; car.y = p.y;
  car.vx = car.vy = car.vz = 0;
  car.yaw = p.yaw; car.yawRate = 0;
  car.rough = VMAX_OFF;
  car.grounded = true; car.nx = 0; car.ny = 1; car.nz = 0;
  car.speed = 0; car.slip = 0; car.boosting = 0; car.offroad = false; car.drift = 0; car.hit = 0; car.land = 0;
  car.loop = -1; car.ls = 0; car.ll = 0; car.tx = 0; car.ty = 0; car.tz = 0; car.part = "";
}

export type Phase = "countdown" | "running" | "finished";

export interface Race {
  track: Track;
  car: Car;
  phase: Phase;
  tick: number; // steps since the start (countdown included)
  cps: Set<number>;
  respawnAt: Spot;
  inputs: number[]; // one byte per running step
  /** Checkpoint split times, in steps since GO. */
  splits: number[];
  finishTicks: number;
  /** Laps done, and how many make the race (circuits; 1 everywhere else). */
  lap: number;
  laps: number;
}

export function newRace(track: Track): Race {
  const car = {} as Car;
  place(car, track.spawn);
  return { track, car, phase: "countdown", tick: 0, cps: new Set(track.passed ?? []), respawnAt: track.spawn, inputs: [], splits: [], finishTicks: 0, lap: 0, laps: 1 };
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
  car.hit = 0; car.land = 0;

  if (byte & 128) { respawn(r); return; }
  if (car.loop >= 0) { loopStep(r, steer, gas, brake); return; }

  const fx = dsin(car.yaw), fz = dcos(car.yaw);
  const grav = GRAVITY * r.track.grav;
  if (car.grounded) {
    const off = car.offroad;
    const g = off ? null : groundAt(r.track, car.x, car.y, car.z, 0.6);
    const ice = g?.ice === true || car.part === "ice";
    const nx = car.nx, ny = car.ny, nz = car.nz;
    // Forward and right along the road's surface.
    let tx = fx - nx * (fx * nx + fz * nz), ty = -ny * (fx * nx + fz * nz), tz = fz - nz * (fx * nx + fz * nz);
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    tx /= tl; ty /= tl; tz /= tl;
    const rx = ty * nz - tz * ny, ry = tz * nx - tx * nz, rz = tx * ny - ty * nx;
    let vf = car.vx * tx + car.vy * ty + car.vz * tz;
    let vl = car.vx * rx + car.vy * ry + car.vz * rz;

    if (gas) vf += ENGINE * (1 - vf / (off ? car.rough : VMAX)) * DT * (vf < 0 ? 2.5 : 1);
    if (off) vf -= vf * 1.2 * DT; // grass and sand are slow
    if (brake) {
      if (vf > 0.5) vf -= 58 * DT;
      else vf = Math.max(vf - 20 * DT, -16);
    }
    if (!gas && !brake) vf -= vf * 0.35 * DT;
    vf -= vf * (vf < 0 ? -vf : vf) * 0.0006 * DT;
    // The drift eases in quickly and out gently, so letting go slides the car
    // back into grip instead of snapping it straight.
    car.drift += ((drift ? 1 : 0) - car.drift) * Math.min(1, (drift ? 9 : 2.6) * DT);
    const dr = car.drift;
    vf -= vf * 0.12 * dr * DT;
    if (g && g.boost) { vf = Math.min(vf + BOOST * DT, VMAX * 1.45); car.boosting = 40; }
    if (car.boosting > 0) car.boosting--;

    const grip = (10 - 8.5 * dr) * (ice ? 0.2 : 1) * (off ? 0.6 : 1) * (g ? g.grip : 1);
    vl -= vl * Math.min(1, grip * DT);
    car.vx = tx * vf + rx * vl; car.vy = ty * vf + ry * vl; car.vz = tz * vf + rz * vl;
    // Gravity along the slope.
    car.vx -= grav * DT * (0 - nx * ny); car.vy -= grav * DT * (1 - ny * ny); car.vz -= grav * DT * (0 - nz * ny);

    const sp = vf < 0 ? -vf : vf;
    let target = -steer * 2.0 * Math.min(1, sp / 6) / (1 + sp / 50) * (vf < 0 ? -1 : 1);
    target *= 1 + 0.45 * dr;
    car.yawRate += (target - car.yawRate) * Math.min(1, (ice ? 2.5 : 5) * DT);
    car.speed = vf; car.slip = vl;
  } else {
    car.vy -= grav * DT;
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
      car.land = -car.vy;
      car.vx *= 0.97; car.vz *= 0.97;
    }
    car.y = g.h;
    settle(car, g.nx, g.ny, g.nz);
    car.offroad = false;
    if (g.piece) reached(r, g.piece);
  } else if (ter.h > NO_GROUND && car.y <= ter.h + (car.grounded && car.offroad ? 0.9 : 0.05)) {
    if (ter.ravine) { respawn(r); return; }
    if (py < ter.h - 0.9) {
      // Ran into a steep bank: stop at it.
      car.x = px; car.z = pz;
      car.vx *= -0.2; car.vz *= -0.2;
      if (car.y < py) car.y = py;
    } else {
      if (!car.grounded) { car.land = -car.vy; car.vx *= 0.9; car.vz *= 0.9; }
      car.y = ter.h;
      const e = 0.6;
      const hx = terrainAt(r.track, car.x + e, car.z).h - terrainAt(r.track, car.x - e, car.z).h;
      const hz = terrainAt(r.track, car.x, car.z + e).h - terrainAt(r.track, car.x, car.z - e).h;
      const ax = -hx / (2 * e), az = -hz / (2 * e);
      const n = 1 / Math.sqrt(ax * ax + 1 + az * az);
      settle(car, ax * n, n, az * n);
      car.offroad = true;
      car.rough = ter.rough ?? VMAX_OFF;
    }
  } else {
    car.grounded = false;
    car.offroad = false;
    car.nx = 0; car.ny = 1; car.nz = 0;
  }
  // Into a loop: the car crosses the line where one stands on the road.
  if (r.track.road?.loops.length && car.grounded && !car.offroad) {
    const loops = r.track.road.loops;
    for (let i = 0; i < loops.length; i++) {
      const L = loops[i];
      const a0 = (px - L.x) * L.fx + (pz - L.z) * L.fz, a1 = (car.x - L.x) * L.fx + (car.z - L.z) * L.fz;
      const lat = (car.x - L.x) * L.rx + (car.z - L.z) * L.rz;
      if (a0 < 0 && a1 >= 0 && lat > -L.hw && lat < L.hw && car.y - L.y < 2 && L.y - car.y < 2) {
        car.loop = i; car.ls = a1; car.ll = lat;
        car.speed = car.vx * L.fx + car.vz * L.fz;
        loopPose(car, L);
        return;
      }
    }
  }
  if (r.track.road) {
    const w = roadSolids(r.track.road, car, px, pz, CAR_R, CAR_H);
    if (w > car.hit) car.hit = w;
    gates(r, px, pz);
    if (r.phase !== "running") return;
  } else solids(r, px, pz);
  const hard = hitSolids(r.track, car, CAR_R, CAR_H);
  if (hard > car.hit) car.hit = hard;
  if (r.track.parts) {
    const h = hitParts(r.track.parts, car, car.part !== "");
    if (h.touch === "kill") { respawn(r); return; }
    car.part = h.ground;
    if (h.ground) {
      car.grounded = true; car.offroad = false;
      car.nx = h.nx; car.ny = h.ny; car.nz = h.nz;
    }
    if (h.land > car.land) car.land = h.land;
    if (h.hit > car.hit) car.hit = h.hit;
    if (h.touch === "boost" || h.ground === "boost") {
      const bx = dsin(car.yaw), bz = dcos(car.yaw);
      if (car.vx * bx + car.vz * bz < VMAX * 1.45) { car.vx += bx * BOOST * DT; car.vz += bz * BOOST * DT; }
      car.boosting = 40;
    }
  }
  if (car.y < r.track.minY - 30) respawn(r);
}

const TAU = 6.283185307179586;

/** Where the car is in its loop (from car.ls, car.ll), its heading, and its velocity. */
function loopPose(car: Car, L: Loop) {
  const th = car.ls / L.r, sn = dsin(th), cs = dcos(th);
  const side = L.off * th / TAU + car.ll;
  car.x = L.x + L.r * L.fx * sn + L.rx * side;
  car.y = L.y + L.r - L.r * cs;
  car.z = L.z + L.r * L.fz * sn + L.rz * side;
  car.tx = L.fx * cs; car.ty = sn; car.tz = L.fz * cs;
  car.nx = -L.fx * sn; car.ny = cs; car.nz = -L.fz * sn;
  car.vx = car.tx * car.speed; car.vy = car.ty * car.speed; car.vz = car.tz * car.speed;
  car.grounded = true; car.offroad = false; car.slip = 0; car.yawRate = 0; car.part = "";
}

/**
 * Going round a loop: speed along it (engine, brakes, drag and the slope of
 * gravity), steering slides across it. Too slow and it falls off; at the end
 * it drives on along the road beside the way in.
 */
function loopStep(r: Race, steer: number, gas: boolean, brake: boolean) {
  const car = r.car, L = r.track.road!.loops[car.loop];
  const g = GRAVITY * r.track.grav;
  let vf = car.speed;
  if (gas) vf += ENGINE * (1 - vf / VMAX) * DT;
  if (brake) vf -= 30 * DT;
  vf -= vf * (vf < 0 ? -vf : vf) * 0.0006 * DT;
  const th = car.ls / L.r;
  vf -= g * dsin(th) * DT;
  const lim = L.hw - 1.5;
  car.ll += steer * 9 * DT;
  if (car.ll > lim) car.ll = lim; else if (car.ll < -lim) car.ll = -lim;
  if (car.boosting > 0) car.boosting--;
  car.speed = vf;
  car.ls += vf * DT;
  const end = TAU * L.r;
  if (car.ls >= end || car.ls < 0) {
    // Out onto the road: beyond the way out, or back past the way in.
    const along = car.ls >= end ? car.ls - end : car.ls, side = (car.ls >= end ? L.off : 0) + car.ll;
    car.x = L.x + L.fx * along + L.rx * side;
    car.y = L.y;
    car.z = L.z + L.fz * along + L.rz * side;
    car.vx = L.fx * vf; car.vy = 0; car.vz = L.fz * vf;
    car.nx = 0; car.ny = 1; car.nz = 0;
    car.grounded = true; car.offroad = false;
    car.loop = -1; car.tx = car.ty = car.tz = 0;
    return;
  }
  loopPose(car, L);
  // The track has to push the car in to hold it: too slow at the top and it drops.
  if (vf * vf / L.r + g * dcos(car.ls / L.r) < 0 || (vf < 1 && car.ls > L.r)) {
    car.loop = -1; car.grounded = false; car.tx = car.ty = car.tz = 0;
    car.nx = 0; car.ny = 1; car.nz = 0;
  }
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
  if (vin < 0) {
    car.vx -= nx * vin * 1.3; car.vz -= nz * vin * 1.3; car.vx *= 0.96; car.vz *= 0.96;
    if (-vin > car.hit) car.hit = -vin;
  }
}

function reached(r: Race, p: Piece) {
  if (p.t === "checkpoint" && p.cp !== undefined && !r.cps.has(p.cp)) {
    r.cps.add(p.cp);
    r.respawnAt = { x: p.x * CELL, y: p.y * LEVEL, z: p.z * CELL, yaw: yawOf(p.d) };
    r.splits.push(raceTicks(r));
  }
  if (p.t === "finish" && r.cps.size === r.track.checkpoints) {
    r.phase = "finished";
    r.finishTicks = r.tick - COUNTDOWN;
  }
}

/** Road maps: checkpoints and the finish are lines across the road, crossed going forwards. */
function gates(r: Race, px: number, pz: number) {
  const road = r.track.road!, car = r.car;
  const cross = (g: { x: number; y: number; z: number; fx: number; fz: number; hw: number }) => {
    const a0 = (px - g.x) * g.fx + (pz - g.z) * g.fz, a1 = (car.x - g.x) * g.fx + (car.z - g.z) * g.fz;
    if (!(a0 < 0 && a1 >= 0)) return false;
    const lat = -(car.x - g.x) * g.fz + (car.z - g.z) * g.fx;
    const dy = car.y - g.y;
    return lat < g.hw + 3 && lat > -g.hw - 3 && dy < 14 && dy > -6;
  };
  for (const g of road.gates) {
    if (r.cps.has(g.cp) || !cross(g)) continue;
    r.cps.add(g.cp);
    r.respawnAt = { x: g.x, y: g.y, z: g.z, yaw: g.yaw };
    r.splits.push(raceTicks(r));
  }
  if (r.cps.size === r.track.checkpoints && cross(road.finish)) {
    // A lap done (sprints have one): the checkpoints count again on the next.
    r.lap++;
    if (r.lap < r.laps) { r.cps = new Set(); return; }
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
