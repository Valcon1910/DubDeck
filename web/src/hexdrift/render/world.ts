// Builds the 3D world for a track. Everything static is merged into a few
// meshes with vertex colours (one draw call each), and scenery is instanced,
// so even big maps stay cheap on phones.
import * as THREE from "three";
import { CELL, CURVE_IN, CURVE_OUT, DIRV, HALF_W, LEVEL, surface, THICK, WALL_H, WALL_T, type Piece, type Track } from "../sim/track.ts";
import { NO_GROUND, terrainAt } from "../sim/terrain.ts";
import type { Biome, BiomeId } from "../maps.ts";
import { buildProps, type Breakables } from "./props.ts";

const ARCH_H = 9;

/** Collects triangles with flat normals and colours, then makes one geometry. */
class Builder {
  pos: number[] = [];
  col: number[] = [];
  private c = new THREE.Color();
  tri(a: number[], b: number[], c: number[], color: THREE.ColorRepresentation) {
    this.c.set(color);
    // The piece frame (u right, h up, w forward) is mirrored in world space,
    // so flip the winding here to keep faces pointing outwards.
    this.pos.push(...a, ...c, ...b);
    for (let i = 0; i < 3; i++) this.col.push(this.c.r, this.c.g, this.c.b);
  }
  /** a b c d counter-clockwise when seen from the front. */
  quad(a: number[], b: number[], c: number[], d: number[], color: THREE.ColorRepresentation) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }
  /** Both windings (thin things seen from either side). */
  quad2(a: number[], b: number[], c: number[], d: number[], color: THREE.ColorRepresentation) {
    this.quad(a, b, c, d, color);
    this.quad(a, d, c, b, color);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals(); // non-indexed: flat per triangle
    return g;
  }
}

/** Maps a piece's local (u right, w forward, h up) to world [x, y, z]. */
function frame(p: Piece) {
  const [fx, fz] = DIRV[p.d];
  const [rx, rz] = DIRV[(p.d + 1) % 4];
  const cx = p.x * CELL, cz = p.z * CELL;
  return (u: number, w: number, h: number) => [cx + rx * u + fx * w, h, cz + rz * u + fz * w];
}

/** Outline of a piece's road as pairs of (left, right) points in u/w, entry to exit. */
function rails(p: Piece, inset = 0): [number, number][][] {
  if (p.t === "curveL" || p.t === "curveR") {
    const s = p.t === "curveR" ? 1 : -1;
    const out: [number, number][][] = [];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * (Math.PI / 2);
      const at = (r: number): [number, number] => [s * (CELL / 2 - Math.cos(a) * r), -CELL / 2 + Math.sin(a) * r];
      // For a right curve the outer edge (big radius) is on the left.
      const outer = at(CURVE_OUT - inset), inner = at(CURVE_IN + inset);
      out.push(s > 0 ? [outer, inner] : [inner, outer]);
    }
    return out;
  }
  const l: [number, number] = [-HALF_W + inset, 0], r: [number, number] = [HALF_W - inset, 0];
  return [-CELL / 2, CELL / 2].map((w) => [[l[0], w], [r[0], w]]);
}

const hOf = (p: Piece, u: number, w: number) => {
  const h = surface(p, Math.max(-CELL / 2, Math.min(CELL / 2, u)), Math.max(-CELL / 2, Math.min(CELL / 2, w)));
  return h === h ? h : p.y * LEVEL;
};

export interface World {
  group: THREE.Group;
  /** Lamp posts, cones, fences...: knocked over by the car (only for show). */
  breakables: Breakables;
  /** Animates the world (the crowd; cheer 0..1). */
  update(dt: number, cheer?: number): void;
  dispose(): void;
}

export function buildWorld(track: Track, biome: Biome, biomeId: BiomeId): World {
  const b = new Builder();
  const mats: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const group = new THREE.Group();

  const road = new THREE.Color(biome.road), roadAlt = new THREE.Color(biome.roadAlt);
  const side = new THREE.Color(biome.road).multiplyScalar(0.55);
  const ice = new THREE.Color("#9fdcff");
  const accent = biome.accent;

  track.pieces.forEach((p, i) => {
    const f = frame(p);
    const rs = rails(p);
    const top = p.ice ? ice.clone().lerp(new THREE.Color(i % 2 ? biome.road : biome.roadAlt), 0.25) : i % 2 ? road : roadAlt;
    const wt = p.wall ? WALL_T : 0;
    const slab = rails(p, -wt), outer = rails(p, -WALL_T);
    const P = (q: [number, number], dh = 0) => f(q[0], q[1], hOf(p, q[0], q[1]) + dh);
    for (let k = 0; k < rs.length - 1; k++) {
      const [l0, r0] = rs[k], [l1, r1] = rs[k + 1];
      const [L0, R0] = slab[k], [L1, R1] = slab[k + 1];
      // Top (seen from above): l0 → r0 → r1 → l1 is clockwise from above in a
      // right-handed frame where u is to the right, so wind it the other way.
      b.quad(P(l0), P(l1), P(r1), P(r0), top);
      // Underside and the two side faces (the slab runs under the walls).
      b.quad(P(L0, -THICK), P(R0, -THICK), P(R1, -THICK), P(L1, -THICK), side);
      b.quad(P(L0, p.wall ? WALL_H : 0), P(L0, -THICK), P(L1, -THICK), P(L1, p.wall ? WALL_H : 0), p.wall ? biome.wall : side);
      b.quad(P(R0, p.wall ? WALL_H : 0), P(R1, p.wall ? WALL_H : 0), P(R1, -THICK), P(R0, -THICK), p.wall ? biome.wall : side);
      // Edge stripes, raised a little so they never flicker against the road.
      const sl = rails(p, 0.55)[k], sl1 = rails(p, 0.55)[k + 1];
      const e = 0.06;
      b.quad(P(l0, e), P(l1, e), P(sl1[0], e), P(sl[0], e), biome.edge);
      b.quad(P(sr(sl), e), P(sr(sl1), e), P(r1, e), P(r0, e), biome.edge);
      if (p.wall) {
        // Solid walls: inner face, top, outer face (the slab side above).
        const [o0, q0] = outer[k], [o1, q1] = outer[k + 1];
        b.quad(P(l0), P(l1), P(l1, WALL_H), P(l0, WALL_H), biome.wall);
        b.quad(P(r0), P(r0, WALL_H), P(r1, WALL_H), P(r1), biome.wall);
        b.quad(P(o0, WALL_H), P(o1, WALL_H), P(l1, WALL_H), P(l0, WALL_H), biome.edge);
        b.quad(P(r0, WALL_H), P(r1, WALL_H), P(q1, WALL_H), P(q0, WALL_H), biome.edge);
      }
    }
    // Dashed centre line.
    if (p.t !== "start" && p.t !== "finish" && p.t !== "boost") {
      const mid = rails(p, 0);
      for (let k = 0; k < mid.length - 1; k += p.t === "curveL" || p.t === "curveR" ? 2 : 1) {
        const a = mid[k], c = mid[Math.min(mid.length - 1, k + 1)];
        const m0: [number, number] = [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2];
        const m1: [number, number] = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2];
        const n = p.t === "curveL" || p.t === "curveR" ? 1 : 3;
        for (let j = 0; j < n; j++) {
          const t0 = (j + 0.2) / n, t1 = (j + 0.6) / n;
          const A: [number, number] = [m0[0] + (m1[0] - m0[0]) * t0, m0[1] + (m1[1] - m0[1]) * t0];
          const B: [number, number] = [m0[0] + (m1[0] - m0[0]) * t1, m0[1] + (m1[1] - m0[1]) * t1];
          const dx = B[0] - A[0], dz = B[1] - A[1], len = Math.hypot(dx, dz) || 1;
          const nx = (-dz / len) * 0.18, nz = (dx / len) * 0.18;
          b.quad(P([A[0] - nx, A[1] - nz], 0.06), P([B[0] - nx, B[1] - nz], 0.06), P([B[0] + nx, B[1] + nz], 0.06), P([A[0] + nx, A[1] + nz], 0.06), "#e9e6dc");
        }
      }
    }
    // End faces where the road stops (start, finish, the edges of a gap).
    for (const end of [p.endIn ? 0 : -1, p.endOut ? slab.length - 1 : -1]) {
      if (end < 0) continue;
      const [L, R] = slab[end];
      const hl = p.wall ? WALL_H : 0;
      if (end === 0) b.quad(P(L, hl), P(R, hl), P(R, -THICK), P(L, -THICK), side);
      else b.quad(P(L, hl), P(L, -THICK), P(R, -THICK), P(R, hl), side);
    }
    if (p.t === "boost") {
      for (const w0 of [-6, 0, 6]) {
        const h = (u: number, w: number) => f(u, w, hOf(p, u, w) + 0.07);
        b.tri(h(-4, w0), h(0, w0 + 3.5), h(0, w0 + 1.8), accent);
        b.tri(h(-4, w0), h(0, w0 + 1.8), h(-4, w0 - 1.7), accent);
        b.tri(h(4, w0), h(4, w0 - 1.7), h(0, w0 + 1.8), accent);
        b.tri(h(4, w0), h(0, w0 + 1.8), h(0, w0 + 3.5), accent);
      }
    }
    if (p.t === "start" || p.t === "finish") {
      // Checkered line across the road.
      const n = 8, wq = 1.6, cw = (2 * HALF_W) / n;
      for (let r = 0; r < 2; r++) for (let c = 0; c < n; c++) {
        const u0 = -HALF_W + c * cw, w0 = (p.t === "start" ? 2 : -2) + r * wq;
        const h = (u: number, w: number) => f(u, w, hOf(p, u, w) + 0.07);
        b.quad(h(u0, w0), h(u0, w0 + wq), h(u0 + cw, w0 + wq), h(u0 + cw, w0), (r + c) % 2 ? "#111111" : "#f4f4f4");
      }
    }
    if (p.t === "checkpoint" || p.t === "start" || p.t === "finish") {
      const col = p.t === "checkpoint" ? accent : p.t === "finish" ? "#f4f4f4" : biome.edge;
      const w0 = p.t === "start" ? 2.8 : p.t === "finish" ? -1.2 : 0;
      arch(b, f, hOf(p, 0, w0), w0, col);
    }
  });

  geos.push(b.geometry());
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mats.push(mat);
  group.add(new THREE.Mesh(geos[0], mat));

  // ── The ground: roads run over it, on embankments ──
  terrain(group, track, biome, biomeId, geos, mats);

  // Pillars only where a road passes high over the ground (bridges).
  const tall = track.pieces.filter((p) => p.t !== "curveL" && p.t !== "curveR").map((p) => {
    const top = p.y * LEVEL - THICK + (p.t === "down" ? -LEVEL : 0);
    const g = terrainAt(track, p.x * CELL, p.z * CELL).h;
    return { p, top, g };
  }).filter((q) => q.g > NO_GROUND && q.top - q.g > 1.5);
  if (tall.length) {
    const pg = new THREE.BoxGeometry(1.6, 1, 1.6);
    pg.translate(0, 0.5, 0);
    geos.push(pg);
    const pm = new THREE.MeshLambertMaterial({ color: new THREE.Color(biome.wall).multiplyScalar(0.6) });
    mats.push(pm);
    const im = new THREE.InstancedMesh(pg, pm, tall.length);
    const m = new THREE.Matrix4();
    tall.forEach((q, i) => { m.makeScale(1, q.top - q.g + 1, 1).setPosition(q.p.x * CELL, q.g - 1, q.p.z * CELL); im.setMatrixAt(i, m); });
    group.add(im);
  }

  // Solid scenery and props (from the physics), and the breakables.
  const props = buildProps(group, track, biome, biomeId, geos, mats);
  if (biomeId === "sky") islands(group, track, geos, mats);
  sky(group, biome, geos, mats);

  return {
    group,
    breakables: props.breakables,
    update(dt, cheer = 0) { props.update(dt, cheer); },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

const sr = (pair: [number, number][]) => pair[1];

function arch(b: Builder, f: (u: number, w: number, h: number) => number[], h0: number, w0: number, col: string) {
  const t = 0.7;
  for (const u0 of [-HALF_W - 1.2, HALF_W + 0.5]) box(b, f, u0, u0 + t, w0 - t / 2, w0 + t / 2, h0 - THICK, h0 + ARCH_H, col);
  box(b, f, -HALF_W - 1.2, HALF_W + 1.2, w0 - t / 2, w0 + t / 2, h0 + ARCH_H - 1.2, h0 + ARCH_H, col);
}

function box(b: Builder, f: (u: number, w: number, h: number) => number[], u0: number, u1: number, w0: number, w1: number, h0: number, h1: number, col: string) {
  const P = (u: number, w: number, h: number) => f(u, w, h);
  b.quad(P(u0, w0, h1), P(u0, w1, h1), P(u1, w1, h1), P(u1, w0, h1), col); // top
  b.quad(P(u0, w0, h0), P(u1, w0, h0), P(u1, w0, h1), P(u0, w0, h1), col); // back
  b.quad(P(u0, w1, h0), P(u0, w1, h1), P(u1, w1, h1), P(u1, w1, h0), col); // front
  b.quad(P(u0, w0, h0), P(u0, w0, h1), P(u0, w1, h1), P(u0, w1, h0), col); // left
  b.quad(P(u1, w0, h0), P(u1, w1, h0), P(u1, w1, h1), P(u1, w0, h1), col); // right
}

function bounds(track: Track) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of track.pieces) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  return { cx: ((x0 + x1) / 2) * CELL, cz: ((z0 + z1) / 2) * CELL, size: (Math.max(x1 - x0, z1 - z0) + 1) * CELL, x0, x1, z0, z1 };
}

/** A tiny seeded random generator, so scenery is the same every time. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Cloud islands drifting far below the sky roads (out of reach: only for looks). */
function islands(group: THREE.Group, track: Track, geos: THREE.BufferGeometry[], mats: THREE.Material[]) {
  const span = bounds(track);
  const used = new Set(track.pieces.map((p) => `${p.x},${p.z}`));
  const rand = rng(track.pieces.length * 7919 + span.x0 * 31 + span.z1);
  const geo = new THREE.IcosahedronGeometry(1, 0);
  geos.push(geo);
  const mat = new THREE.MeshLambertMaterial({ color: "#ffffff", flatShading: true });
  mats.push(mat);
  const colours = ["#ffffff", "#f3f8ff", "#e9f3ff"];
  const spots: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const R = 9;
  for (let x = span.x0 - R; x <= span.x1 + R; x++) {
    for (let z = span.z0 - R; z <= span.z1 + R; z++) {
      if (used.has(`${x},${z}`) || rand() > 0.3) continue;
      const jx = (rand() - 0.5) * CELL * 0.6, jz = (rand() - 0.5) * CELL * 0.6;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      const w = 5 + rand() * 10;
      s.set(w * 1.6, w * 0.6, w);
      v.set(x * CELL + jx, track.minY - 12 - rand() * 50, z * CELL + jz);
      spots.push(new THREE.Matrix4().compose(v, q, s));
    }
  }
  const im = new THREE.InstancedMesh(geo, mat, spots.length);
  const c = new THREE.Color();
  spots.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, c.set(colours[i % colours.length])); });
  group.add(im);
}

export const GROUND: Record<BiomeId, { flat: string; bank: string; low: string }> = {
  city: { flat: "#24223a", bank: "#3a3456", low: "#101024" },
  canyon: { flat: "#c2643a", bank: "#8e3b22", low: "#ff7a2a" },
  glacier: { flat: "#f2f8ff", bank: "#a9cfe8", low: "#5fa8d8" },
  sky: { flat: "#86d46c", bank: "#8c7a68", low: "#6b5d50" },
  desert: { flat: "#ecc985", bank: "#c99a52", low: "#b07a3a" },
};

/**
 * The ground as one smooth mesh, sampled from the same height function the
 * physics uses. Fine near the roads, coarser towards the horizon.
 */
function terrain(group: THREE.Group, track: Track, biome: Biome, id: BiomeId, geos: THREE.BufferGeometry[], mats: THREE.Material[]) {
  const span = bounds(track);
  const sky = id === "sky";
  const axis = (a0: number, a1: number) => {
    const out: number[] = [];
    const lo = a0 * CELL - CELL - 50, hi = a1 * CELL + CELL + 50, far = sky ? 30 : 520;
    let x = lo - far, stepOut = 40;
    const before: number[] = [];
    for (let v = lo, st = 3; v > lo - far; st = Math.min(stepOut, st * 1.2), v -= st) before.push(v);
    out.push(...before.reverse());
    for (x = lo + 3; x < hi; x += 3) out.push(x);
    for (let v = hi, st = 3; v < hi + far; st = Math.min(stepOut, st * 1.2), v += st) out.push(v);
    return out;
  };
  const xs = axis(span.x0, span.x1), zs = axis(span.z0, span.z1);
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
  const hs = new Float32Array(nx * nz);
  const valid = new Uint8Array(nx * nz);
  const pal = GROUND[id];
  const flat = new THREE.Color(pal.flat), bank = new THREE.Color(pal.bank), low = new THREE.Color(pal.low), c = new THREE.Color();
  const floor = track.minY - 8;
  const bottom = track.minY - 26;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const t = terrainAt(track, xs[i], zs[j]);
      const ok = t.h > NO_GROUND;
      valid[k] = ok ? 1 : 0;
      hs[k] = ok ? t.h - 0.12 : bottom;
      pos[k * 3] = xs[i]; pos[k * 3 + 1] = hs[k]; pos[k * 3 + 2] = zs[j];
    }
  }
  // Colour by steepness and height: banks and cliffs differ from flat ground.
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(nz - 1, j + 1);
      const gx = (hs[j * nx + i1] - hs[j * nx + i0]) / ((xs[i1] - xs[i0]) || 1);
      const gz = (hs[j1 * nx + i] - hs[j0 * nx + i]) / ((zs[j1] - zs[j0]) || 1);
      const steep = Math.min(1, Math.sqrt(gx * gx + gz * gz) * 1.6);
      c.copy(flat).lerp(bank, steep);
      if (!valid[k]) c.copy(bank).multiplyScalar(0.6);
      else if (!sky && hs[k] < floor - 2) c.lerp(low, Math.min(1, (floor - 2 - hs[k]) / 4));
      // A little variation so big areas don't look flat.
      const v = 0.94 + (((i * 73856093) ^ (j * 19349663)) >>> 0) % 1000 / 1000 * 0.08;
      col[k * 3] = c.r * v; col[k * 3 + 1] = c.g * v; col[k * 3 + 2] = c.b * v;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
      if (sky && !valid[a] && !valid[b] && !valid[d] && !valid[e]) continue;
      idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals(); // shared vertices: smooth shading
  geos.push(g);
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: sky ? THREE.DoubleSide : THREE.FrontSide });
  mats.push(m);
  const mesh = new THREE.Mesh(g, m);
  mesh.name = "terrain";
  group.add(mesh);
  void biome;
}

/** A big gradient dome behind everything (no texture, one draw call). */
function sky(group: THREE.Group, biome: Biome, geos: THREE.BufferGeometry[], mats: THREE.Material[]) {
  const g = new THREE.SphereGeometry(1500, 16, 10);
  const top = new THREE.Color(biome.sky).multiplyScalar(0.8), mid = new THREE.Color(biome.fog);
  const pos = g.getAttribute("position");
  const col: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i) / 1500);
    c.copy(mid).lerp(top, Math.sqrt(t));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geos.push(g);
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  mats.push(m);
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = -1;
  mesh.name = "sky";
  group.add(mesh);
}
