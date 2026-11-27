// Draws loops and free parts. Parts are merged into two meshes (lit, and
// glowing for boost and kill) so even hundreds of them cost two draw calls.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { pipePoint, pipeRoll, type Loop, type Road } from "../sim/road.ts";
import type { Mat, Part, Parts } from "../sim/parts.ts";

export const MAT_COLOR: Record<Mat, string> = { solid: "#9aa3b5", bouncy: "#ff4fa3", ice: "#bfe9ff", boost: "#22e3ff", kill: "#ff3346" };

/** The wedge (and ramp): a box cut by the slope from its bottom back edge to its top front edge. */
function wedgeGeometry() {
  const v = [
    [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], // bottom
    [-1, 1, 1], [1, 1, 1], // top front edge
  ];
  const tri = [
    [0, 2, 1], [0, 3, 2], // bottom
    [3, 4, 5], [3, 5, 2], // front
    [0, 4, 3], [1, 2, 5], // sides
    [0, 1, 5], [0, 5, 4], // slope
  ];
  const pos: number[] = [];
  for (const t of tri) for (const i of t) pos.push(...v[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** One part's geometry, sized, turned and placed in the world, with its colour. */
export function partGeometry(p: Part): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (p.shape === "ball") g = new THREE.SphereGeometry(1, 20, 14);
  else if (p.shape === "cyl") g = new THREE.CylinderGeometry(1, 1, 2, 24);
  else if (p.shape === "wedge" || p.shape === "ramp") g = wedgeGeometry();
  else g = new THREE.BoxGeometry(2, 2, 2);
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute("uv");
  const m = p.m;
  const M = new THREE.Matrix4().set(m[0], m[1], m[2], p.x, m[3], m[4], m[5], p.y, m[6], m[7], m[8], p.z, 0, 0, 0, 1)
    .multiply(new THREE.Matrix4().makeScale(p.hx, p.hy, p.hz));
  g.applyMatrix4(M);
  const c = new THREE.Color(p.mat === "solid" && p.def.c ? p.def.c : MAT_COLOR[p.mat]);
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

export function buildParts(group: THREE.Group, parts: Parts | undefined, geos: THREE.BufferGeometry[], mats: THREE.Material[]) {
  if (!parts?.list.length) return;
  const lit: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [];
  for (const p of parts.list) (p.mat === "boost" || p.mat === "kill" ? glow : lit).push(partGeometry(p));
  if (lit.length) {
    const g = mergeGeometries(lit)!; geos.push(g);
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
    mats.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (glow.length) {
    const g = mergeGeometries(glow)!; geos.push(g);
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, fog: true });
    mats.push(m);
    group.add(new THREE.Mesh(g, m));
  }
  for (const g of [...lit, ...glow]) g.dispose();
}

/** A point on a loop: θ round it (radians), lat across (m), lifted `up` off the surface. */
export function loopPoint(L: Loop, th: number, lat: number, up = 0): [number, number, number] {
  const sn = Math.sin(th), cs = Math.cos(th);
  const side = L.off * th / (Math.PI * 2) + lat;
  const r = L.r - up;
  return [
    L.x + r * L.fx * sn + L.rx * side,
    L.y + L.r - r * cs,
    L.z + r * L.fz * sn + L.rz * side,
  ];
}

/** Wall rides: the road curling up the inside of a pipe and back down, with edges, rails and a thick underside. */
export function buildPipes(group: THREE.Group, road: Road, geos: THREE.BufferGeometry[], mats: THREE.Material[], asphalt: string, line: string) {
  if (!road.pipes.length) return;
  const pos: number[] = [], col: number[] = [], nrm: number[] = [];
  const A = new THREE.Color(asphalt), W = new THREE.Color(line), R = new THREE.Color("#d9dde6"), N = new THREE.Color("#ff4fd8");
  // Each corner is [point, normal]; normals follow the bank so the curve shades smoothly.
  type V = [number[], number[]];
  const quad = (a: V, b: V, c: V, d: V, k: THREE.Color) => {
    for (const v of [a, c, b, a, d, c]) { pos.push(...v[0]); nrm.push(...v[1]); col.push(k.r, k.g, k.b); }
  };
  for (const P of road.pipes) {
    const n = Math.max(24, Math.round(P.len / 2)), hw = P.hw;
    const sdx = P.w * P.rx, sdz = P.w * P.rz;
    // Strips across the road, the outer ones white.
    const cuts = [-hw, -hw + 0.5];
    for (let i = 1; i < 4; i++) cuts.push(-hw + 0.5 + ((2 * hw - 1) * i) / 4);
    cuts.push(hw - 0.5, hw);
    const v = (u: number, l: number, up: number, side = 0): V => {
      const th = pipeRoll(P, u)[0], sn = Math.sin(th), cs = Math.cos(th);
      // Up off the road, or out across it (for the rails).
      const nn = side ? [side * cs * sdx, side * sn, side * cs * sdz] : [-sn * sdx * Math.sign(up + 0.01), cs * Math.sign(up + 0.01), -sn * sdz * Math.sign(up + 0.01)];
      return [pipePoint(P, u, l, up), nn];
    };
    for (let i = 0; i < n; i++) {
      const u0 = (i / n) * P.len, u1 = ((i + 1) / n) * P.len;
      for (let j = 0; j < cuts.length - 1; j++) {
        const l0 = cuts[j], l1 = cuts[j + 1];
        const k = j === 0 || j === cuts.length - 2 ? W : A;
        quad(v(u0, l0, 0.04), v(u1, l0, 0.04), v(u1, l1, 0.04), v(u0, l1, 0.04), k);
        quad(v(u0, l1, -0.5), v(u1, l1, -0.5), v(u1, l0, -0.5), v(u0, l0, -0.5), A);
      }
      // A dashed middle line.
      if (i % 3 === 0) quad(v(u0, -0.15, 0.06), v(u1, -0.15, 0.06), v(u1, 0.15, 0.06), v(u0, 0.15, 0.06), W);
      for (const e of [-hw, hw]) {
        const k = e > 0 ? N : R, s = e > 0 ? -1 : 1;
        quad(v(u0, e, 0, s), v(u1, e, 0, s), v(u1, e, 1.1, s), v(u0, e, 1.1, s), k);
        quad(v(u0, e, 1.1, -s), v(u1, e, 1.1, -s), v(u1, e, 0, -s), v(u0, e, 0, -s), k);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geos.push(g);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  mats.push(m);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
}

/** Loops: the road surface (both faces), white edges, low rails and a pair of legs. */
export function buildLoops(group: THREE.Group, road: Road, geos: THREE.BufferGeometry[], mats: THREE.Material[], asphalt: string, line: string) {
  if (!road.loops.length) return;
  const pos: number[] = [], col: number[] = [];
  const A = new THREE.Color(asphalt), W = new THREE.Color(line), R = new THREE.Color("#d9dde6");
  const quad = (a: number[], b: number[], c: number[], d: number[], k: THREE.Color) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) col.push(k.r, k.g, k.b);
  };
  for (const L of road.loops) {
    const n = Math.max(48, Math.round(L.r * 5));
    const hw = L.hw;
    const lanes: [number, number, THREE.Color][] = [[-hw, -hw + 0.5, W], [-hw + 0.5, hw - 0.5, A], [hw - 0.5, hw, W]];
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2;
      for (const [l0, l1, k] of lanes) {
        quad(loopPoint(L, t0, l0), loopPoint(L, t1, l0), loopPoint(L, t1, l1), loopPoint(L, t0, l1), k);
        // Underside (a little thick).
        quad(loopPoint(L, t0, l1, -0.6), loopPoint(L, t1, l1, -0.6), loopPoint(L, t1, l0, -0.6), loopPoint(L, t0, l0, -0.6), A);
      }
      // Rails on both edges.
      for (const e of [-hw, hw]) {
        quad(loopPoint(L, t0, e), loopPoint(L, t1, e), loopPoint(L, t1, e, 1.1), loopPoint(L, t0, e, 1.1), R);
        quad(loopPoint(L, t0, e, 1.1), loopPoint(L, t1, e, 1.1), loopPoint(L, t1, e), loopPoint(L, t0, e), R);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  geos.push(g);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide });
  mats.push(m);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
}
