// Keeps the drawn terrain under the roads: the land mesh is a 4 m grid, and a
// grid triangle can bulge through a road edge (in dips, on banked bends, where
// two roads run side by side). Any terrain point within a cell of a road is
// pulled down to just under that road's surface there. (Drawing only.)
import { bkey, FLUSH, GAP, TB, TUN, type Road } from "../sim/road.ts";
import { compose, type Street } from "../sim/kit.ts";

const REACH = 6; // a grid cell's diagonal, and a little

export function clampUnder(road: Road, x: number, z: number, h: number): number {
  const list = road.tgrid.get(bkey(Math.floor(x / TB), Math.floor(z / TB)));
  if (!list) return h;
  for (const sg of list) {
    if (sg.flags & (TUN | GAP)) continue;
    const vx = x - sg.ax, vz = z - sg.az;
    const along = vx * sg.fx + vz * sg.fz;
    if (along < -REACH || along > sg.len + REACH) continue;
    const t = along < 0 ? 0 : along > sg.len ? 1 : along / sg.len;
    const hw = sg.hw0 + (sg.hw1 - sg.hw0) * t;
    // Right of the road is (-fz, fx).
    const lat = -vx * sg.fz + vz * sg.fx;
    const out = (lat < 0 ? -lat : lat) - hw;
    if (out > REACH) continue;
    const bk = sg.bk0 + (sg.bk1 - sg.bk0) * t;
    const l = lat < -hw ? -hw : lat > hw ? hw : lat;
    const y = sg.ay + (sg.by - sg.ay) * t + bk * l;
    // Under the road surface; beside it, sloping down to meet the land.
    const under = y - (sg.flags & FLUSH ? 0.06 : 0.2);
    if (h > under) h = under;
  }
  return h;
}

// The kit's side streets are drawn on the land a few centimetres up; the
// land's mesh is coarser than they are, so it is sunk a little under them.
const streetCells = new WeakMap<Road, Map<number, Street[]>>();
function cellsOf(road: Road): Map<number, Street[]> {
  let m = streetCells.get(road);
  if (m) return m;
  m = new Map();
  const c = compose(road);
  for (const s of c ? [...c.streets, ...c.spurs] : []) {
    const L = Math.hypot(s.bx - s.ax, s.bz - s.az), n = Math.ceil(L / 8) + 1;
    const seen = new Set<number>();
    for (let k = 0; k <= n; k++) {
      const x = s.ax + (s.bx - s.ax) * k / n, z = s.az + (s.bz - s.az) * k / n;
      for (const dx of [-8, 8]) for (const dz of [-8, 8]) {
        const key = bkey(Math.floor((x + dx) / TB), Math.floor((z + dz) / TB));
        if (seen.has(key)) continue;
        seen.add(key);
        const l = m.get(key);
        if (l) l.push(s); else m.set(key, [s]);
      }
    }
  }
  streetCells.set(road, m);
  return m;
}

/** h, sunk 0.35 m where a side street runs over it. */
export function sinkUnderStreets(road: Road, x: number, z: number, h: number): number {
  const list = cellsOf(road).get(bkey(Math.floor(x / TB), Math.floor(z / TB)));
  if (!list) return h;
  for (const s of list) {
    const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L, vx = x - s.ax, vz = z - s.az;
    const along = vx * ux + vz * uz, lat = Math.abs(-vx * uz + vz * ux);
    if (along > -7 && along < L + 7 && lat < 7.5) return h - 0.35;
  }
  return h;
}
