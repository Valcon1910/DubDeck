// Builds the 3D world for a track. Everything static is merged into a few
// meshes with vertex colours (one draw call each), and scenery is instanced,
// so even big maps stay cheap on phones.
import * as THREE from "three";
import { CELL, CURVE_IN, CURVE_OUT, DIRV, HALF_W, LEVEL, surface, type Piece, type Track } from "../sim/track.ts";
import type { Biome, BiomeId } from "../maps.ts";

const THICK = 1.4; // road slab thickness
const WALL_H = 1.3;
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
    for (let k = 0; k < rs.length - 1; k++) {
      const [l0, r0] = rs[k], [l1, r1] = rs[k + 1];
      const P = (q: [number, number], dh = 0) => f(q[0], q[1], hOf(p, q[0], q[1]) + dh);
      // Top (seen from above): l0 → r0 → r1 → l1 is clockwise from above in a
      // right-handed frame where u is to the right, so wind it the other way.
      b.quad(P(l0), P(l1), P(r1), P(r0), top);
      // Underside and the two side faces.
      b.quad(P(l0, -THICK), P(r0, -THICK), P(r1, -THICK), P(l1, -THICK), side);
      b.quad(P(l0), P(l0, -THICK), P(l1, -THICK), P(l1), side);
      b.quad(P(r0), P(r1), P(r1, -THICK), P(r0, -THICK), side);
      // Edge stripes.
      const sl = rails(p, 0.55)[k], sl1 = rails(p, 0.55)[k + 1];
      const e = 0.03;
      b.quad(P(l0, e), P(l1, e), P(sl1[0], e), P(sl[0], e), biome.edge);
      b.quad(P(sr(sl), e), P(sr(sl1), e), P(r1, e), P(r0, e), biome.edge);
      if (p.wall) {
        b.quad2(P(l0), P(l1), P(l1, WALL_H), P(l0, WALL_H), biome.wall);
        b.quad2(P(r0), P(r0, WALL_H), P(r1, WALL_H), P(r1), biome.wall);
        b.quad(P(l0, WALL_H), P(l1, WALL_H), P(sl1[0], WALL_H), P(sl[0], WALL_H), biome.wall);
      }
    }
    // Entry and exit faces (only visible where the road ends or at a gap).
    if (p.t === "boost") {
      for (const w0 of [-6, 0, 6]) {
        const h = (u: number, w: number) => f(u, w, hOf(p, u, w) + 0.05);
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
        const h = (u: number, w: number) => f(u, w, hOf(p, u, w) + 0.04);
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
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mats.push(mat);
  group.add(new THREE.Mesh(geos[0], mat));

  // Ramps get a bright lip so jumps read from far away.
  // (Part of the road colours above; nothing extra needed.)

  // ── Support pillars under raised pieces (one instanced mesh) ──
  const groundY = biomeId === "sky" ? null : track.minY - 40;
  if (groundY !== null) {
    const pillars = track.pieces.filter((p) => p.t !== "curveL" && p.t !== "curveR");
    const pg = new THREE.BoxGeometry(1.6, 1, 1.6);
    pg.translate(0, 0.5, 0);
    geos.push(pg);
    const pm = new THREE.MeshLambertMaterial({ color: new THREE.Color(biome.wall).multiplyScalar(0.6) });
    mats.push(pm);
    const im = new THREE.InstancedMesh(pg, pm, pillars.length);
    const m = new THREE.Matrix4();
    pillars.forEach((p, i) => {
      const top = p.y * LEVEL - THICK + (p.t === "down" ? -LEVEL : 0);
      m.makeScale(1, top - groundY, 1).setPosition(p.x * CELL, groundY, p.z * CELL);
      im.setMatrixAt(i, m);
    });
    group.add(im);

    // Ground.
    const span = bounds(track);
    const gg = new THREE.PlaneGeometry(span.size + 2400, span.size + 2400);
    gg.rotateX(-Math.PI / 2);
    geos.push(gg);
    const gm = new THREE.MeshLambertMaterial({ color: biome.ground });
    mats.push(gm);
    const ground = new THREE.Mesh(gg, gm);
    ground.position.set(span.cx, groundY, span.cz);
    group.add(ground);
  }

  scenery(group, track, biome, biomeId, groundY, geos, mats);
  sky(group, biome, geos, mats);

  return {
    group,
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

function scenery(group: THREE.Group, track: Track, biome: Biome, id: BiomeId, groundY: number | null, geos: THREE.BufferGeometry[], mats: THREE.Material[]) {
  const span = bounds(track);
  const used = new Set(track.pieces.map((p) => `${p.x},${p.z}`));
  const near = (x: number, z: number, r: number) => {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (used.has(`${x + dx},${z + dz}`)) return true;
    return false;
  };
  const rand = rng(track.pieces.length * 7919 + span.x0 * 31 + span.z1);
  let geo: THREE.BufferGeometry;
  const colours: string[] = [];
  switch (id) {
    case "city": geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); colours.push("#2b2f5c", "#3a2d6e", "#1f3a5c", "#4a2a5e"); break;
    case "canyon": geo = new THREE.CylinderGeometry(0.8, 1, 1, 6).translate(0, 0.5, 0); colours.push("#a4482a", "#c0643a", "#8e3b22"); break;
    case "glacier": geo = new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0); colours.push("#dff3ff", "#bfe6ff", "#a8dcff"); break;
    case "sky": geo = new THREE.IcosahedronGeometry(1, 0); colours.push("#ffffff", "#f3f8ff", "#e9f3ff"); break;
    default: geo = new THREE.SphereGeometry(1, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2); colours.push("#e3b866", "#d9ab57", "#efc77a"); break;
  }
  geos.push(geo);
  const mat = new THREE.MeshLambertMaterial({ color: "#ffffff", flatShading: true });
  mats.push(mat);
  const R = 9;
  const spots: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let x = span.x0 - R; x <= span.x1 + R; x++) {
    for (let z = span.z0 - R; z <= span.z1 + R; z++) {
      if (near(x, z, id === "sky" ? 0 : 1) || rand() > (id === "city" ? 0.55 : 0.3)) continue;
      const jx = (rand() - 0.5) * CELL * 0.6, jz = (rand() - 0.5) * CELL * 0.6;
      const gy = groundY ?? track.minY - 30;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      if (id === "city") { const w = 6 + rand() * 9; s.set(w, 30 + rand() * 70, w); v.set(x * CELL + jx, gy, z * CELL + jz); }
      else if (id === "canyon") { const w = 5 + rand() * 9; s.set(w, 25 + rand() * 45, w); v.set(x * CELL + jx, gy, z * CELL + jz); }
      else if (id === "glacier") { const w = 3 + rand() * 6; s.set(w, 18 + rand() * 40, w); v.set(x * CELL + jx, gy, z * CELL + jz); }
      else if (id === "sky") { const w = 5 + rand() * 10; s.set(w * 1.6, w * 0.6, w); v.set(x * CELL + jx, track.minY - 12 - rand() * 50, z * CELL + jz); }
      else { const w = 10 + rand() * 18; s.set(w * 1.5, w * 0.35, w); v.set(x * CELL + jx, gy, z * CELL + jz); }
      spots.push(new THREE.Matrix4().compose(v, q, s));
    }
  }
  const im = new THREE.InstancedMesh(geo, mat, spots.length);
  const c = new THREE.Color();
  spots.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, c.set(colours[i % colours.length])); });
  m.identity();
  group.add(im);
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
