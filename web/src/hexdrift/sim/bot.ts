// A simple autopilot that follows the middle of the road. It proves a map can
// be finished and sets the medal times; the learning AI that checks
// community maps later starts from it. Deterministic like the rest.
import { dcos, dsin, clamp } from "./math.ts";
import { newRace, pack, step, COUNTDOWN, HZ, type Race } from "./race.ts";
import type { Track } from "./track.ts";

export interface BotTuning { look: number; corner: number; gain: number }
export const DEFAULT_BOT: BotTuning = { look: 4, corner: 15, gain: 2.4 };

export function botInput(r: Race, at: { i: number }, tune: BotTuning = DEFAULT_BOT) {
  const { car, track } = r;
  const line = track.line;
  // Loops: flat out, kept to the middle.
  if (car.loop >= 0) return pack({ steer: clamp(-car.ll * 0.3, -1, 1), gas: true, brake: false, drift: false, respawn: false });
  for (const L of track.road?.loops ?? []) {
    const along = (car.x - L.x) * L.fx + (car.z - L.z) * L.fz, lat = (car.x - L.x) * L.rx + (car.z - L.z) * L.rz;
    if (along > -90 && along < 0 && lat > -L.hw - 3 && lat < L.hw + 3 && car.grounded) {
      const fx = dsin(car.yaw), fz = dcos(car.yaw);
      // Aim at the loop's foot, straight on.
      const aim = clamp(-along * 0.5, 6, 40);
      const ax = L.x + L.fx * aim - car.x, az = L.z + L.fz * aim - car.z;
      const l = Math.sqrt(ax * ax + az * az) || 1;
      const cross = (fz * ax - fx * az) / l;
      return pack({ steer: clamp(-cross * 2.4, -1, 1), gas: true, brake: false, drift: false, respawn: false });
    }
  }
  // Follow progress along the line (search a little behind and ahead; circuits go round).
  const round = !!track.road?.lapLen, N = line.length;
  const pt = (i: number) => line[round ? ((i % N) + N) % N : i];
  let best = at.i, bd = Infinity;
  for (let i = round ? at.i - 4 : Math.max(0, at.i - 4); i < (round ? at.i + 24 : Math.min(N, at.i + 24)); i++) {
    const p = pt(i);
    const d = (p.x - car.x) ** 2 + (p.z - car.z) ** 2 + ((p.y - car.y) * 0.3) ** 2;
    if (d < bd) { bd = d; best = round ? ((i % N) + N) % N : i; }
  }
  // Lost (after a respawn): look along the whole line.
  if (bd > 400) {
    for (let i = 0; i < line.length; i++) {
      const p = line[i];
      const d = (p.x - car.x) ** 2 + (p.z - car.z) ** 2 + ((p.y - car.y) * 0.3) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
  }
  at.i = best;
  const sp = Math.abs(car.speed);
  const look = best + Math.round(tune.look + sp / 12);
  const t = round ? pt(look) : line[Math.min(N - 1, look)];
  const fx = dsin(car.yaw), fz = dcos(car.yaw);
  const dx = t.x - car.x, dz = t.z - car.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const cross = (fz * dx - fx * dz) / len; // > 0: target is to the left
  const ahead = (fx * dx + fz * dz) / len;
  const steer = ahead < 0 ? (cross > 0 ? -1 : 1) : clamp(-cross * tune.gain, -1, 1);
  // Slow for sharp turns further ahead.
  const far = round ? pt(best + 6 + Math.round(sp / 5)) : line[Math.min(N - 1, best + 6 + Math.round(sp / 5))];
  const ex = far.x - car.x, ez = far.z - car.z, el = Math.sqrt(ex * ex + ez * ez) || 1;
  const bend = 1 - Math.abs(fx * ex + fz * ez) / el;
  const limit = tune.corner + 34 * (1 - Math.min(1, bend * 3));
  const brake = car.grounded && sp > limit && bend > 0.08;
  return pack({ steer, gas: !brake, brake, drift: false, respawn: false });
}

/** Drives a whole map; the finish time in steps, or null if it can't. */
export function botRun(track: Track, tune: BotTuning = DEFAULT_BOT, maxSeconds = 300): { ticks: number; inputs: number[] } | null {
  const r = newRace(track);
  const at = { i: 0 };
  for (let t = 0; t < COUNTDOWN + maxSeconds * HZ; t++) {
    step(r, r.phase === "running" ? botInput(r, at, tune) : 0);
    if (r.phase === "finished") return { ticks: r.finishTicks, inputs: r.inputs };
  }
  return null;
}
