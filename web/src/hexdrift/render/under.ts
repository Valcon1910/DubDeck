// Keeps the drawn terrain under the roads: the land mesh is a 4 m grid, and a
// grid triangle can bulge through a road edge (in dips, on banked bends, where
// two roads run side by side). Any terrain point within a cell of a road is
// pulled down to just under that road's surface there. (Drawing only.)
import { bkey, FLUSH, GAP, TB, TUN, type Road } from "../sim/road.ts";

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
