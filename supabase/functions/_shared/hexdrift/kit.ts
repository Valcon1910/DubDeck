// Copied from web/src/hexdrift by scripts/hexdrift-share.mjs. Don't edit here.
// Composing a road map's scenery from a kit of ready-made objects (made in
// Blender: scripts/hexdrift-kit). The map gives its roads, its set pieces and
// what lines each stretch of road (beach, boulevard, downtown...); this fills
// everything else: buildings shoulder to shoulder along the roads facing
// them, then blocks behind on a grid of side streets, out to the horizon.
//
// The solid objects are part of the physics (a car that leaves the road
// hits them the same way on every device and in the record checker), so
// the layout comes only from the track: hashes and road geometry, with
// only + - * / sqrt and Math.floor / Math.imul.
import { hash } from "./math.ts";
import { landAt, MAT, roadDist, roadTerrain, type Road, type Sample, type Strip } from "./road.ts";

/** An object of a kit: its solid footprint (half sizes across a and deep b, centre shift cx/cz in its own frame), height, and room kept clear in front. */
export interface KitDef { a: number; b: number; h: number; cx?: number; cz?: number; front?: number; round?: boolean; solid?: boolean }

export const KITS: Record<string, Record<string, KitDef>> = {
  miami: {
    deco_a: { a: 8.6, b: 6.6, h: 22, front: 5 },
    deco_b: { a: 7.1, b: 5.6, h: 18.7, front: 5 },
    deco_c: { a: 9.6, b: 6.6, h: 25, front: 5 },
    deco_d: { a: 7.6, b: 6.1, h: 18.7, front: 5 },
    condo_a: { a: 12, b: 9.1, h: 70, front: 6 },
    condo_b: { a: 11, b: 8.1, h: 90, front: 6 },
    office_a: { a: 11, b: 11, h: 94 },
    shops_a: { a: 14, b: 5.2, h: 9.6, front: 2 },
    shops_b: { a: 12, b: 5.2, h: 9.6, front: 2 },
    garage: { a: 19, b: 12, h: 12.3, cx: 2 },
    guard_a: { a: 1.9, b: 1.9, h: 7.8, front: 4 },
    guard_b: { a: 1.9, b: 1.9, h: 7.8, front: 4 },
    beachbar: { a: 5.6, b: 5.1, h: 5.9 },
    palm_tall: { a: 0.4, b: 0.4, h: 12.5, round: true },
    palm_mid: { a: 0.4, b: 0.4, h: 8.9, round: true },
    palm_pair: { a: 0.9, b: 0.9, h: 10.5, round: true },
    busstop: { a: 2.6, b: 1.0, h: 2.8 },
    billboard: { a: 6.3, b: 0.5, h: 15.3 },
    foodtruck: { a: 1.2, b: 2.8, h: 3.5 },
    stand: { a: 19, b: 5.5, h: 16.7 },
    planter: { a: 2.0, b: 0.6, h: 1.5 },
    lamp2: { a: 0.3, b: 0.3, h: 9.2, round: true },
    sedan_r: { a: 0.93, b: 2.25, h: 1.7 }, sedan_b: { a: 0.93, b: 2.25, h: 1.7 }, sedan_w: { a: 0.93, b: 2.25, h: 1.7 },
    taxi: { a: 0.93, b: 2.25, h: 1.9 }, police: { a: 0.93, b: 2.25, h: 1.9 }, van: { a: 1.0, b: 2.7, h: 2.4 }, bus: { a: 1.3, b: 6, h: 3.3 },
    // Scenery out of reach (on the water, in the air): drawn only.
    yacht: { a: 2.6, b: 12, h: 8, solid: false }, sailboat: { a: 1.6, b: 5, h: 14, solid: false },
    pier: { a: 3.9, b: 31, h: 7, cz: 30, solid: false }, heli: { a: 5, b: 6, h: 2, solid: false },
  },
};

/** What lines each kind of strip: the frontage along the road, the blocks behind, and fillers between. */
interface Mix { front: string[]; back: string[]; filler: string[]; setback: number; tall?: string[] }
const MIXES: Record<string, Partial<Record<Strip, Mix>>> = {
  miami: {
    boulevard: { front: ["deco_a", "deco_b", "deco_c", "deco_d", "deco_a", "deco_c"], back: ["condo_a", "condo_b", "shops_a", "deco_b", "condo_a"], filler: ["palm_tall", "palm_mid", "palm_pair"], setback: 5 },
    downtown: { front: ["office_a", "condo_b", "shops_a", "shops_b", "garage", "condo_a"], back: ["office_a", "condo_b", "condo_a", "garage", "shops_b"], filler: ["palm_mid", "planter", "palm_mid", "busstop", "billboard", "planter", "lamp2"], setback: 4, tall: ["office_a", "condo_b"] },
    shops: { front: ["shops_a", "shops_b", "deco_b", "foodtruck"], back: ["deco_d", "condo_a", "shops_a"], filler: ["palm_mid", "planter", "lamp2", "busstop", "palm_mid"], setback: 3 },
    beach: { front: [], back: ["guard_a", "guard_b", "beachbar"], filler: ["palm_tall", "palm_pair", "palm_mid"], setback: 3 },
    park: { front: [], back: ["palm_pair", "palm_tall"], filler: ["palm_mid", "planter"], setback: 4 },
  },
};

/** A placed kit object. (fx, fz) is the way its front faces. */
export interface Placed { o: string; x: number; y: number; z: number; fx: number; fz: number; v: number }
/** A side street: a straight run between two points (traffic drives it). */
export interface Street { ax: number; az: number; bx: number; bz: number }

export interface Composed { placed: Placed[]; streets: Street[]; kit: Record<string, KitDef> }

/** Occupied ground, on a 2 m grid. */
class Occupancy {
  private cells = new Set<number>();
  private key(i: number, j: number) { return Math.imul(i, 73856093) ^ Math.imul(j, 19349663); }
  /** Is a turned box (half sizes a, b, plus margin m) free? Mark it if so (and mark is true). */
  box(x: number, z: number, fx: number, fz: number, a: number, b: number, m: number, mark: boolean): boolean {
    const A = a + m, B = b + m;
    const R = Math.sqrt(A * A + B * B) + 2;
    const i0 = Math.floor((x - R) / 2), i1 = Math.floor((x + R) / 2);
    const j0 = Math.floor((z - R) / 2), j1 = Math.floor((z + R) / 2);
    const hit: number[] = [];
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const px = i * 2 + 1 - x, pz = j * 2 + 1 - z;
        const lx = px * fz - pz * fx, lz = px * fx + pz * fz;
        const ax = lx < 0 ? -lx : lx, az = lz < 0 ? -lz : lz;
        if (ax > A || az > B) continue;
        const k = this.key(i, j);
        if (this.cells.has(k)) return false;
        hit.push(k);
      }
    }
    if (mark) for (const k of hit) this.cells.add(k);
    return true;
  }
}

const cache = new WeakMap<Road, Composed>();

/** Lays out every kit object of a road map (worked out once per road). */
export function compose(road: Road): Composed | null {
  const dress = road.dress;
  if (!dress) return null;
  const have = cache.get(road);
  if (have) return have;
  const kit = KITS[dress.kit] ?? {};
  const mixes = MIXES[dress.kit] ?? {};
  const placed: Placed[] = [];
  const streets: Street[] = [];
  const occ = new Occupancy();
  const sea = road.land.sea;
  const main = road.strands[0].pts;
  const total = main[main.length - 1].s;

  const sandAt = (x: number, z: number) => sea !== undefined && landAt(road.land, x, z).mat === MAT.sand;
  const wetAt = (x: number, z: number) => sea !== undefined && landAt(road.land, x, z).h < sea + 0.3;
  /** Places an object if it fits: clear of every road by gap, on dry land, not on anything else. */
  const put = (o: string, x: number, z: number, fx: number, fz: number, v: number, gap: number, margin: number): boolean => {
    const d = kit[o];
    if (!d) return false;
    const rx = fz, rz = -fx; // its own x axis
    const cx = x + rx * (d.cx ?? 0) + fx * (d.cz ?? 0), cz = z + rz * (d.cx ?? 0) + fz * (d.cz ?? 0);
    const front = d.front ?? 0;
    // Clear of the roads: corners, edge middles and the centre (with the room in front).
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const lz = j > 0 ? d.b + front : j * d.b;
        const px = cx + rx * d.a * i + fx * lz, pz = cz + rz * d.a * i + fz * lz;
        if (roadDist(road, px, pz, gap + 1) < gap) return false;
        if (d.solid !== false && wetAt(px, pz)) return false;
      }
    }
    // Stands on the lowest ground under it (sunk a little).
    let y = 1e9;
    for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) {
      const g = roadTerrain(road, cx + rx * d.a * i + fx * d.b * j, cz + rz * d.a * i + fz * d.b * j);
      if (g.ravine && d.solid !== false) return false;
      if (g.h < y) y = g.h;
    }
    const gc = roadTerrain(road, cx, cz).h;
    if (gc < y) y = gc;
    if (y < -1e7) return false;
    if (!occ.box(cx + fx * front * 0.5, cz + fz * front * 0.5, fx, fz, d.a, d.b + front * 0.5, margin, true)) return false;
    placed.push({ o, x, y: y - 0.3, z, fx, fz, v });
    return true;
  };
  const pick = (list: string[], v: number) => list[Math.floor(v * list.length) % list.length];
  const stripAt = (s: number, side: number): Strip => {
    for (const [a, b, l, r] of dress.zones) if (s >= a && s < b) return side < 0 ? l : r;
    return "none";
  };
  const at = (p: Sample, lat: number, along: number) => [p.x - p.dz * lat + p.dx * along, p.z + p.dx * lat + p.dz * along];

  // ── Set pieces, by hand ──
  for (const [o, s, side, gap, shift] of dress.set ?? []) {
    let i = 0;
    while (i < main.length - 1 && main[i].s < s) i++;
    const p = main[i], d = kit[o];
    if (!d) continue;
    const off = p.hw + gap + d.b + (d.front ?? 0);
    const [x, z] = at(p, side * off, shift ?? 0);
    // Faces the road.
    put(o, x, z, p.dz * side, -p.dx * side, hash(i, side, 90), 1, 0);
  }

  // ── Frontage: buildings shoulder to shoulder along each side, facing the road ──
  for (const side of [-1, 1]) {
    let s = 20;
    let n = 0;
    while (s < total - 10) {
      n++;
      const strip = stripAt(s, side);
      const mix = mixes[strip];
      if (!mix) { s += 10; continue; }
      let i = 0;
      while (i < main.length - 1 && main[i].s < s) i++;
      const p = main[i];
      const v = hash(n, side + 3, 91);
      // Kerb-side fillers (palms, planters) in front of the frontage, every 12 m.
      if (mix.filler.length && hash(n, side, 92) < 0.8) {
        const f = pick(mix.filler, hash(n, side, 93));
        const fd = kit[f];
        const [x, z] = at(p, side * (p.hw + 2.4 + fd.a), 0);
        put(f, x, z, p.dz * side, -p.dx * side, hash(n, side, 94), 1.4, 0.2);
      }
      if (!mix.front.length) { s += 12; continue; }
      const o = pick(mix.front, v);
      const d = kit[o];
      const off = p.hw + mix.setback + d.b + (d.front ?? 0);
      const [x, z] = at(p, side * off, d.a);
      if (put(o, x, z, p.dz * side, -p.dx * side, hash(n, side, 95), mix.setback - 0.5, 0.5)) s += d.a * 2 + 2 + hash(n, side, 96) * 4;
      else s += 6;
    }
  }

  // ── Blocks behind, on a street grid square to the start, out to the horizon ──
  const s0 = main[0];
  const ux = s0.dx, uz = s0.dz, vx = s0.dz, vz = -s0.dx; // grid axes
  const BLOCK = 64, STREET = 12;
  // The main road, every ~10 m, for "which stretch is nearest".
  const marks: Sample[] = [];
  for (let i = 0; i < main.length; i += 4) marks.push(main[i]);
  const nearest = (x: number, z: number) => {
    let bd = 1e18, bp = marks[0];
    for (const p of marks) {
      const dx = p.x - x, dz = p.z - z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; bp = p; }
    }
    return { p: bp, d: Math.sqrt(bd) };
  };
  const R = 560;
  const cx0 = (road.x0 + road.x1) / 2, cz0 = (road.z0 + road.z1) / 2;
  const span = Math.sqrt((road.x1 - road.x0) * (road.x1 - road.x0) + (road.z1 - road.z0) * (road.z1 - road.z0)) / 2 + R;
  const nb = Math.floor(span / BLOCK) + 1;
  // Project the centre onto the grid axes so blocks line up the same way every time.
  const gu0 = Math.floor((cx0 * ux + cz0 * uz) / BLOCK), gv0 = Math.floor((cx0 * vx + cz0 * vz) / BLOCK);
  const G = (u: number, v: number) => [ux * u + vx * v, uz * u + vz * v];
  for (let bu = -nb; bu <= nb; bu++) {
    for (let bv = -nb; bv <= nb; bv++) {
      const U = (gu0 + bu) * BLOCK, V = (gv0 + bv) * BLOCK;
      const [mx, mz] = G(U + BLOCK / 2, V + BLOCK / 2);
      const nr = nearest(mx, mz);
      if (nr.d > R) continue;
      const lat = -(mx - nr.p.x) * nr.p.dz + (mz - nr.p.z) * nr.p.dx;
      const strip = stripAt(nr.p.s, lat < 0 ? -1 : 1);
      const sand = sandAt(mx, mz);
      const mix = sand ? mixes.beach : mixes[strip] ?? mixes.park;
      if (!mix) continue;
      // Streets along two sides of every block (where they don't cross the race).
      if (!sand && strip !== "beach" && strip !== "park") {
        for (const [a, b] of [[G(U, V), G(U + BLOCK, V)], [G(U, V), G(U, V + BLOCK)]]) {
          let ok = true;
          for (let k = 0; k <= 4 && ok; k++) {
            const px = a[0] + (b[0] - a[0]) * k / 4, pz = a[1] + (b[1] - a[1]) * k / 4;
            if (roadDist(road, px, pz, 14) < 12 || wetAt(px, pz)) ok = false;
          }
          if (ok) {
            streets.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1] });
            const [qx, qz] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            const along = [b[0] - a[0], b[1] - a[1]];
            const L = Math.sqrt(along[0] * along[0] + along[1] * along[1]);
            occ.box(qx, qz, along[0] / L, along[1] / L, STREET / 2, L / 2, 0, true);
          }
        }
      }
      // Buildings round the block's edge, shoulder to shoulder, each facing its street.
      const far = nr.d > 260;
      const h0 = STREET / 2 + 2, h1 = BLOCK - STREET / 2 - 2;
      const sides: [number, number, number, number, number, number][] = [
        // start u, v; tangent (du, dv); outward normal (nu, nv)
        [h0, h0, 1, 0, 0, -1], [h1, h0, 0, 1, 1, 0], [h1, h1, -1, 0, 0, 1], [h0, h1, 0, -1, -1, 0],
      ];
      let n = 0;
      for (const [su, sv, tu, tv, nu, nv] of sides) {
        const [fx, fz] = G(nu, nv), [tx, tz] = G(tu, tv);
        let w = 0;
        while (w < h1 - h0 - 4) {
          n++;
          const h1x = hash(gu0 + bu, gv0 + bv, 100 + n);
          let o = pick(mix.back, h1x);
          if (far && mix.tall && hash(gu0 + bu, gv0 + bv, 110 + n) < 0.6) o = pick(mix.tall, h1x);
          const d = kit[o];
          const depth = d.b + (d.front ?? 0);
          const [ex, ez] = G(U + su + tu * w, V + sv + tv * w);
          const px = ex - fx * depth + tx * d.a, pz = ez - fz * depth + tz * d.a;
          if (w + d.a * 2 <= h1 - h0 && put(o, px, pz, fx, fz, hash(gu0 + bu, gv0 + bv, 120 + n), 6, 0.3)) w += d.a * 2 + 1;
          else {
            // Something smaller in the space.
            const f = pick(mix.filler, hash(gu0 + bu, gv0 + bv, 130 + n));
            const fd = kit[f];
            if (fd) put(f, ex - fx * (fd.b + 1.5) + tx * (fd.a + 1), ez - fz * (fd.b + 1.5) + tz * (fd.a + 1), fx, fz, hash(gu0 + bu, gv0 + bv, 140 + n), 2, 0.3);
            w += 7;
          }
        }
      }
      // The courtyard in the middle: palms.
      for (let k = 0; k < 3; k++) {
        const f = pick(mix.filler, hash(gu0 + bu, gv0 + bv, 160 + k));
        const [px, pz] = G(U + BLOCK / 2 + (hash(gu0 + bu, gv0 + bv, 161 + k) - 0.5) * 16, V + BLOCK / 2 + (hash(gu0 + bu, gv0 + bv, 162 + k) - 0.5) * 16);
        if (kit[f]) put(f, px, pz, ux, uz, hash(gu0 + bu, gv0 + bv, 163 + k), 2, 0.3);
      }
    }
  }

  // ── The sea: boats moored and moving, out of reach ──
  if (sea !== undefined && kit.yacht) {
    for (let k = 0; k < 40; k++) {
      const p = main[Math.floor(hash(k, 1, 150) * (main.length - 1))];
      const out = 60 + hash(k, 2, 151) * 420;
      for (const side of [-1, 1]) {
        const [x, z] = at(p, side * out, 0);
        if (landAt(road.land, x, z).h > sea - 2) continue;
        placed.push({ o: hash(k, 3, 152) < 0.45 ? "yacht" : "sailboat", x, y: sea, z, fx: p.dx, fz: p.dz, v: hash(k, 4, 153) });
        break;
      }
    }
  }
  const res = { placed, streets, kit };
  cache.set(road, res);
  return res;
}

/** True when an object is part of the physics. */
export const isSolid = (c: Composed, o: string) => c.kit[o]?.solid !== false;

