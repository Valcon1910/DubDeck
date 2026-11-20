// One race: the car, the clock, checkpoints and the finish. Runs at exactly
// 60 steps a second. Every step takes one input byte, so a whole run is just
// a list of bytes: replaying them gives the exact same drive (ghosts, and
// record checks on the server later).
import { clamp, dcos, dsin } from "./math.ts";
import { CELL, DIRV, groundAt, HALF_W, local, CURVE_IN, CURVE_OUT, LEVEL, yawOf, type Piece, type Track } from "./track.ts";

export const HZ = 60;
const DT = 1 / HZ;
export const COUNTDOWN = 3 * HZ;

// Handling (same for every car).
const ENGINE = 14;
const VMAX = 62;
const BOOST = 80;
const GRAVITY = 32;
const CAR_R = 1.1;

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
}

function place(car: Car, p: Piece) {
  car.x = p.x * CELL; car.z = p.z * CELL; car.y = p.y * LEVEL;
  car.vx = car.vy = car.vz = 0;
  car.yaw = yawOf(p.d); car.yawRate = 0;
  car.grounded = true; car.nx = 0; car.ny = 1; car.nz = 0;
  car.speed = 0; car.slip = 0; car.boosting = 0;
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
    const g = groundAt(r.track, car.x, car.y, car.z, 0.6);
    const ice = g?.piece.ice === true;
    const nx = car.nx, ny = car.ny, nz = car.nz;
    // Forward and right along the road's surface.
    let tx = fx - nx * (fx * nx + fz * nz), ty = -ny * (fx * nx + fz * nz), tz = fz - nz * (fx * nx + fz * nz);
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    tx /= tl; ty /= tl; tz /= tl;
    const rx = ty * nz - tz * ny, ry = tz * nx - tx * nz, rz = tx * ny - ty * nx;
    let vf = car.vx * tx + car.vy * ty + car.vz * tz;
    let vl = car.vx * rx + car.vy * ry + car.vz * rz;

    if (gas) vf += ENGINE * (1 - vf / VMAX) * DT * (vf < 0 ? 2.5 : 1);
    if (brake) {
      if (vf > 0.5) vf -= 58 * DT;
      else vf = Math.max(vf - 20 * DT, -16);
    }
    if (!gas && !brake) vf -= vf * 0.35 * DT;
    vf -= vf * (vf < 0 ? -vf : vf) * 0.0006 * DT;
    if (drift) vf -= vf * 0.12 * DT;
    if (g && g.piece.t === "boost") { vf = Math.min(vf + BOOST * DT, VMAX * 1.45); car.boosting = 40; }
    if (car.boosting > 0) car.boosting--;

    const grip = (drift ? 1.5 : 10) * (ice ? 0.2 : 1);
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

  const py = car.y;
  car.x += car.vx * DT; car.y += car.vy * DT; car.z += car.vz * DT;

  // Stay on the road, or take off / land.
  const g = groundAt(r.track, car.x, car.y, car.z, car.grounded ? 0.9 : Math.max(0.3, py - car.y + 0.3));
  if (g && (car.grounded ? car.y - g.h < 0.9 : car.y <= g.h + 0.05)) {
    if (!car.grounded) {
      // Landing: keep the speed along the road, lose a little.
      car.vx *= 0.97; car.vz *= 0.97;
    }
    car.y = g.h;
    const into = car.vx * g.nx + car.vy * g.ny + car.vz * g.nz;
    if (into < 0 || car.grounded) { car.vx -= g.nx * into; car.vy -= g.ny * into; car.vz -= g.nz * into; }
    car.grounded = true;
    car.nx = g.nx; car.ny = g.ny; car.nz = g.nz;
    walls(car, g.piece);
    reached(r, g.piece);
  } else {
    car.grounded = false;
    car.nx = 0; car.ny = 1; car.nz = 0;
  }
  if (car.y < r.track.minY - 30) respawn(r);
}

/** Low walls on the road edges push the car back and take some speed. */
function walls(car: Car, p: Piece) {
  if (!p.wall) return;
  const { u, w } = local(p, car.x, car.z);
  const [fx, fz] = DIRV[p.d];
  const [rx, rz] = DIRV[(p.d + 1) % 4];
  let ox = 0, oz = 0, push = 0;
  if (p.t === "curveL" || p.t === "curveR") {
    const cu = p.t === "curveR" ? CELL / 2 : -CELL / 2;
    const du = u - cu, dw = w + CELL / 2;
    const rr = Math.sqrt(du * du + dw * dw) || 1;
    const outx = (rx * du + fx * dw) / rr, outz = (rz * du + fz * dw) / rr;
    if (rr > CURVE_OUT - CAR_R) { push = rr - (CURVE_OUT - CAR_R); ox = -outx; oz = -outz; }
    else if (rr < CURVE_IN + CAR_R) { push = CURVE_IN + CAR_R - rr; ox = outx; oz = outz; }
  } else if (u > HALF_W - CAR_R) { push = u - (HALF_W - CAR_R); ox = -rx; oz = -rz; }
  else if (u < -(HALF_W - CAR_R)) { push = -(HALF_W - CAR_R) - u; ox = rx; oz = rz; }
  if (!push) return;
  car.x += ox * push; car.z += oz * push;
  const vin = car.vx * ox + car.vz * oz;
  if (vin < 0) { car.vx -= ox * vin * 1.3; car.vz -= oz * vin * 1.3; car.vx *= 0.96; car.vz *= 0.96; }
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
