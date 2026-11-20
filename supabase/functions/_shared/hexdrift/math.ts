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
