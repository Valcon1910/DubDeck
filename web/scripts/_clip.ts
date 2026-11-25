// Dev only: finds spots where the drawn terrain pokes through a road (same heights as render/roadworld.ts).
import { ALL_MAPS, trackOf } from "../src/hexdrift/maps.ts";
import { groundAt } from "../src/hexdrift/sim/track.ts";
import { terrainAt } from "../src/hexdrift/sim/terrain.ts";
import { TUN, GAP } from "../src/hexdrift/sim/road.ts";
const NONE = -1e8;
const fix = process.argv[3] === "fix";
for (const m of ALL_MAPS) {
  if (process.argv[2] && m.id !== process.argv[2]) continue;
  const track = trackOf(m);
  const road = track.road;
  if (!road || road.land.kind === "void") continue;
  const isles = road.land.kind === "isles";
  const axis = (a0: number, a1: number) => {
    const lo = a0 - 160, hi = a1 + 160;
    const out: number[] = [];
    for (let x = lo + 4; x < hi; x += 4) out.push(x);
    return [lo, ...out];
  };
  const xs = axis(road.x0, road.x1), zs = axis(road.z0, road.z1);
  const nx = xs.length, nz = zs.length;
  const hs = new Float64Array(nx * nz);
  const { clampUnder } = fix ? await import("../src/hexdrift/render/under.ts") : { clampUnder: null };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const t = terrainAt(track, xs[i], zs[j]);
    let h = t.h;
    if (h <= NONE) { hs[j * nx + i] = NONE; continue; }
    const g = groundAt(track, xs[i], h + 2.5, zs[j], 0);
    if (g && g.h - h < 1.2) h -= 0.45;
    if (clampUnder) h = clampUnder(road, xs[i], zs[j], h);
    hs[j * nx + i] = h;
  }
  const terrH = (x: number, z: number) => {
    const fi = (x - xs[0]) / 4, fj = (z - zs[0]) / 4;
    const i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return NONE;
    const u = fi - i, v = fj - j;
    const a = hs[j * nx + i], b = hs[j * nx + i + 1], d = hs[(j + 1) * nx + i], e = hs[(j + 1) * nx + i + 1];
    if (a <= NONE || b <= NONE || d <= NONE || e <= NONE) return NONE;
    // Triangles (a, d, b) and (b, d, e).
    return u + v <= 1 ? a + (b - a) * u + (d - a) * v : e + (d - e) * (1 - u) + (b - e) * (1 - v);
  };
  let bad = 0, worst = 0; const spots: string[] = [];
  for (const st of road.strands) {
    const P = st.pts;
    for (let k = 0; k < P.length - 1; k++) {
      const p = P[k], q = P[k + 1];
      if ((p.flags | q.flags) & (TUN | GAP)) continue;
      for (const t of [0, 0.25, 0.5, 0.75]) {
        const x0 = p.x + (q.x - p.x) * t, z0 = p.z + (q.z - p.z) * t, y0 = p.y + (q.y - p.y) * t;
        const hw = p.hw + (q.hw - p.hw) * t, bk = p.bank + (q.bank - p.bank) * t;
        const dx = p.dx, dz = p.dz;
        for (let lat = -hw; lat <= hw + 1e-6; lat += hw / 6) {
          const x = x0 - dz * lat, z = z0 + dx * lat, y = y0 + bk * lat;
          const th = terrH(x, z);
          if (th > y - 0.02) { bad++; const over = th - y; if (over > worst) worst = over; if (spots.length < 12 && over > 0.05) spots.push(`${x.toFixed(0)},${z.toFixed(0)} +${over.toFixed(2)} lat ${lat.toFixed(1)} s ${p.s.toFixed(0)}${st.alt ? " alt" : ""}`); }
        }
      }
    }
  }
  console.log(m.id, "poke points", bad, "worst", worst.toFixed(2));
  for (const s of spots) console.log("  ", s);
}
