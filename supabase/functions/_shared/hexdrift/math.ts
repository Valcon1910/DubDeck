// Copied from web/src/hexdrift by scripts/hexdrift-share.mjs. Don't edit here.
// Deterministic maths for the simulation. +, -, *, / and Math.sqrt give the
// same result on every device, but Math.sin/cos may differ between browsers,
// which would make replays (ghosts, record checks) drift apart. So the
// simulation only uses these.

const TAU = 6.283185307179586;
const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;

export function dsin(x: number): number {
  x -= TAU * Math.round(x / TAU);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 / 6227020800))))));
}

export const dcos = (x: number): number => dsin(x + HALF_PI);

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// Hashing and smooth value noise (Math.imul and Math.floor are exact everywhere).
export function hash(ix: number, iz: number, seed: number) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export const smooth = (t: number) => t * t * (3 - 2 * t);
/** Smooth value noise, 0..1. */
export function noise(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

