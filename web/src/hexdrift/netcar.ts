// Other players' cars. The sim is deterministic, so a car's full state plus
// the input its driver is holding says exactly where it goes next: each player
// sends that only when their input changes (or they bump into someone, or now
// and then to be safe), and everyone else runs the car forward themselves until
// the next one. That keeps the live messages few, which the budget needs (see
// room.ts).
import { step, type Car, type Phase, type Race } from "./sim/race.ts";
import type { Spot } from "./sim/track.ts";

export interface CarPacket {
  /** The sender's race step (steps since the countdown began). */
  t: number;
  /** The input byte they're holding (without respawn). */
  i: number;
  c: Car;
  /** Checkpoints passed this lap, and laps done. */
  k: number[];
  l: number;
  r: Spot;
  p: Phase;
  f: number;
}

export function encodeCar(r: Race): string {
  const held = r.inputs.length ? r.inputs[r.inputs.length - 1] & 127 : 0;
  const p: CarPacket = { t: r.tick, i: held, c: r.car, k: [...r.cps], l: r.lap, r: r.respawnAt, p: r.phase, f: r.finishTicks };
  // Full precision: the others then run exactly the same car (numbers survive JSON exactly).
  return JSON.stringify(p);
}

const num = (v: unknown, max = 1e7): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;
const PHASES: Phase[] = ["countdown", "running", "finished"];

/** A packet from another browser, checked field by field against a real car (anything odd: ignored). */
export function decodeCar(s: string, like: Car): CarPacket | null {
  let o: Record<string, unknown>;
  try { o = JSON.parse(s) as Record<string, unknown>; } catch { return null; }
  if (!o || typeof o !== "object") return null;
  if (!num(o.t) || o.t < 0 || !num(o.i, 127) || o.i < 0 || !num(o.l, 99) || !num(o.f) || !PHASES.includes(o.p as Phase)) return null;
  const k = o.k, r = o.r as Record<string, unknown> | null, c = o.c as Record<string, unknown> | null;
  if (!Array.isArray(k) || k.length > 64 || !k.every((x) => num(x, 999))) return null;
  if (!r || !num(r.x, 1e6) || !num(r.y, 1e6) || !num(r.z, 1e6) || !num(r.yaw, 100)) return null;
  if (!c || typeof c !== "object") return null;
  const car = {} as Record<string, unknown>;
  for (const [key, v] of Object.entries(like)) {
    const w = c[key];
    if (typeof v === "number" ? !num(w, 1e6) : typeof w !== typeof v || (typeof w === "string" && w.length > 12)) return null;
    car[key] = w;
  }
  return { t: Math.floor(o.t), i: Math.floor(o.i), c: car as unknown as Car, k: k as number[], l: Math.floor(o.l), r: { x: r.x as number, y: r.y as number, z: r.z as number, yaw: r.yaw as number }, p: o.p as Phase, f: o.f };
}

/** Puts a packet into a stand-in race for that player, then runs it on to `now` (your own race step). */
export function applyCar(race: Race, p: CarPacket, now: number) {
  Object.assign(race.car, p.c);
  race.tick = p.t;
  race.phase = p.p;
  race.cps = new Set(p.k);
  race.lap = p.l;
  race.laps = 99; // they say when they've finished
  race.respawnAt = p.r;
  race.finishTicks = p.f;
  race.inputs.length = 0;
  // Catch up (a packet is always a little old by the time it arrives).
  for (let n = 0; race.tick < now && n < 240; n++) step(race, p.i);
}

/** One step of a stand-in race with the input its driver was last holding. */
export function stepRemote(race: Race, held: number) {
  step(race, held);
  if (race.inputs.length > 600) race.inputs.splice(0, 300);
}
