/** Pillars left to right: 1st in the middle, 2nd left of it, 3rd right, and so on. */
export function podiumOrder<T extends { place: number }>(places: T[]): T[] {
  const by = [...places].sort((a, b) => a.place - b.place);
  const out: T[] = [];
  by.forEach((p, i) => { if (i % 2) out.unshift(p); else out.push(p); });
  return out;
}
