// Draws the kit objects a road map is composed of (see sim/kit.ts): the
// Blender kit is loaded once, every object gets an instanced mesh for near
// and one for far, and a cheap pass every few frames sends each placement to
// the right one (or hides it when it is behind the camera or past the fog).
// Also draws the side streets and the traffic driving them.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { compose, type Composed, type Placed } from "../sim/kit.ts";
import { roadTerrain, type Road } from "../sim/road.ts";
import miamiUrl from "../kit/miami.glb?url";

const URLS: Record<string, string> = { miami: miamiUrl };

/** Material kinds (from the Blender material name). */
const PLAIN = 0, GLASS = 1, NEON = 2, LAMP = 3, SCREEN = 4, CAR_GLASS = 5, FACADE = 6;
const kindOf = (name: string) =>
  name === "glass_car" ? CAR_GLASS : name.startsWith("glass") ? GLASS : name.startsWith("neon") ? NEON
    : name === "lamp" || name === "tail" ? LAMP : name === "screen" ? SCREEN : PLAIN;

interface KitGeo { near: THREE.BufferGeometry; far: THREE.BufferGeometry; block: THREE.BufferGeometry; r: number }

/** A plain block the size of an object, for far away: walls in its average
 * colour with painted windows (lit at night), and a flat roof. */
function blockOf(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute("position"), col = g.getAttribute("color"), kind = g.getAttribute("aKind");
  let top = 0;
  for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
  // The body, not the canopies and awnings round its foot.
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < top * 0.4) continue;
    x0 = Math.min(x0, pos.getX(i)); x1 = Math.max(x1, pos.getX(i));
    z0 = Math.min(z0, pos.getZ(i)); z1 = Math.max(z1, pos.getZ(i));
    if (kind.getX(i) === PLAIN) { r += col.getX(i); gg += col.getY(i); b += col.getZ(i); n++; }
  }
  if (!n) { r = gg = b = 0.8; n = 1; }
  const box = new THREE.BoxGeometry(x1 - x0, top, z1 - z0).translate((x0 + x1) / 2, top / 2, (z0 + z1) / 2).toNonIndexed();
  box.deleteAttribute("uv");
  const nor = box.getAttribute("normal");
  const C = new Float32Array(nor.count * 3), K = new Float32Array(nor.count);
  for (let i = 0; i < nor.count; i++) {
    C[i * 3] = r / n; C[i * 3 + 1] = gg / n; C[i * 3 + 2] = b / n;
    K[i] = Math.abs(nor.getY(i)) > 0.5 ? PLAIN : FACADE;
  }
  box.setAttribute("color", new THREE.BufferAttribute(C, 3));
  box.setAttribute("aKind", new THREE.BufferAttribute(K, 1));
  return box;
}

const loaded = new Map<string, Promise<Map<string, KitGeo> | null>>();

/** Loads (once) a kit: one merged geometry per object (near and far). */
function loadKit(kit: string): Promise<Map<string, KitGeo> | null> {
  const url = URLS[kit];
  if (!url) return Promise.resolve(null);
  let p = loaded.get(kit);
  if (p) return p;
  p = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const parts = new Map<string, THREE.BufferGeometry[]>();
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      const src = m.geometry;
      const pos = src.getAttribute("position"), nor = src.getAttribute("normal");
      const n = pos.count;
      const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), K = new Float32Array(n);
      const kind = kindOf(mat.name);
      const c = mat.color;
      for (let i = 0; i < n; i++) {
        P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i);
        N[i * 3] = nor.getX(i); N[i * 3 + 1] = nor.getY(i); N[i * 3 + 2] = nor.getZ(i);
        C[i * 3] = c.r; C[i * 3 + 1] = c.g; C[i * 3 + 2] = c.b;
        K[i] = kind;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(P, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      g.setAttribute("color", new THREE.BufferAttribute(C, 3));
      g.setAttribute("aKind", new THREE.BufferAttribute(K, 1));
      g.setIndex(src.getIndex() ? Array.from(src.getIndex()!.array) : null);
      g.applyMatrix4(m.matrixWorld);
      g.normalizeNormals();
      src.dispose();
      let top: THREE.Object3D = m;
      while (top.parent && top.parent !== gltf.scene) top = top.parent;
      const l = parts.get(top.name);
      if (l) l.push(g); else parts.set(top.name, [g]);
    });
    const merged = new Map<string, THREE.BufferGeometry>();
    for (const [name, l] of parts) merged.set(name, l.length === 1 ? l[0] : mergeGeometries(l, false)!);
    const out = new Map<string, KitGeo>();
    for (const [name, near] of merged) {
      if (name.endsWith("~far")) continue;
      near.computeBoundingSphere();
      const far = merged.get(name + "~far") ?? near;
      out.set(name, { near, far, block: blockOf(far), r: near.boundingSphere!.radius });
    }
    return out;
  }).catch((e) => { console.warn("kit", kit, e); return null; });
  loaded.set(kit, p);
  return p;
}

/** One look for every kit object: vertex colours, plus lit windows, neon,
 * lamps and video screens picked by the per-vertex kind. */
function kitMaterial(time: { value: number }, night: number, sky: THREE.Color): THREE.Material {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.uniforms.uNight = { value: night };
    sh.uniforms.uSky = { value: sky };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
attribute float aKind;
varying float vKind;
varying vec3 vLoc;
varying vec3 vNrm;
varying float vSeed;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vKind = aKind;
vLoc = position;
vNrm = normal;
#ifdef USE_INSTANCING
vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
#else
vSeed = 0.5;
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uTime;
uniform float uNight;
uniform vec3 uSky;
varying float vKind;
varying vec3 vLoc;
varying vec3 vNrm;
varying float vSeed;
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
if (vKind > 0.5 && vKind < 1.5) {
  // Windows: sky and a sheen by day; at night some rooms are lit.
  vec2 g = vec2((vLoc.x + vLoc.z) / 2.4, vLoc.y / 3.2);
  vec2 cell = floor(g);
  float h = hash2(cell + vSeed * 91.0);
  // Far away a window is smaller than a pixel: use the average instead of flickering.
  float aa = clamp(1.6 - max(fwidth(g.x), fwidth(g.y)) * 3.0, 0.0, 1.0);
  float up = clamp(vNrm.y * 0.5 + 0.5, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uSky * (0.55 + 0.25 * h), 0.55 * (1.0 - uNight));
  vec3 room = mix(vec3(1.0, 0.78, 0.45), vec3(0.75, 0.88, 1.0), step(0.7, hash2(cell.yx + vSeed)));
  float share = 0.08 + 0.45 * uNight;
  totalEmissiveRadiance += room * mix(share, step(h, share), aa) * (0.2 + 0.9 * uNight) * (1.0 - up * 0.5);
} else if (vKind > 1.5 && vKind < 2.5) {
  // Neon: glows and breathes.
  float pulse = 0.85 + 0.15 * sin(uTime * 3.0 + vSeed * 6.28 + vLoc.y * 0.4);
  totalEmissiveRadiance += diffuseColor.rgb * (0.9 + 0.8 * uNight) * pulse;
  diffuseColor.rgb *= 0.3;
} else if (vKind > 2.5 && vKind < 3.5) {
  totalEmissiveRadiance += diffuseColor.rgb * (0.7 + 0.8 * uNight);
} else if (vKind > 3.5 && vKind < 4.5) {
  // Video screens: a different clip on each, cut every few seconds.
  // Video screens: an ad on each (a brand colour, a big shape, a line of text), cut every few seconds.
  float clip = floor(uTime / 5.0 + vSeed * 7.0);
  float k = hash2(vec2(clip, vSeed));
  float k2 = hash2(vec2(vSeed, clip + 3.0));
  vec2 p = vec2(vLoc.x + vLoc.z, vLoc.y);
  vec3 brand = 0.55 + 0.45 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + k));
  vec3 bg = mix(vec3(0.06, 0.07, 0.1), brand * 0.35, step(0.5, k2));
  float blob = smoothstep(0.42, 0.38, length(fract(p * vec2(0.18, 0.3) + vec2(k, k2)) - 0.5));
  float text = step(0.55, fract(p.x * 1.3)) * step(abs(fract(p.y * 0.3 + k2) - 0.2), 0.06);
  float wipe = smoothstep(0.0, 0.15, fract(uTime / 5.0 + vSeed * 7.0));
  vec3 col = mix(bg, brand, blob) + text * 0.5;
  totalEmissiveRadiance += col * wipe * (0.65 + 0.35 * uNight);
  diffuseColor.rgb *= 0.1;
} else if (vKind > 4.5 && vKind < 5.5) {
  float up = clamp(vNrm.y, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uSky * 0.6, up * 0.5 * (1.0 - uNight));
} else if (vKind > 5.5) {
  // A far block's walls: rows of painted windows above the ground floor.
  vec2 g = vec2((vLoc.x + vLoc.z) / 2.6, vLoc.y / 3.2);
  vec2 f = fract(g);
  float above = step(4.0, vLoc.y);
  float win = step(0.25, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.85) * above;
  float aa = clamp(1.6 - max(fwidth(g.x), fwidth(g.y)) * 3.0, 0.0, 1.0);
  float w = mix(0.3 * above, win, aa);
  diffuseColor.rgb = mix(diffuseColor.rgb, uSky * 0.55, w * 0.7 * (1.0 - uNight));
  float h = hash2(floor(g) + vSeed * 91.0);
  float share = 0.08 + 0.45 * uNight;
  totalEmissiveRadiance += vec3(1.0, 0.8, 0.5) * w * mix(share, step(h, share), aa) * (0.2 + 0.9 * uNight);
}`);
  };
  m.customProgramCacheKey = () => "hexdrift-kit";
  return m;
}

/** A street, as a strip of asphalt with kerbs and a dashed centre line. */
function streets(c: Composed, road: Road, night: boolean): THREE.BufferGeometry | null {
  if (!c.streets.length) return null;
  const pos: number[] = [], col: number[] = [];
  const asphalt = new THREE.Color(night ? "#1d1f24" : "#4a4a4e"), kerb = new THREE.Color(night ? "#5a5a5e" : "#b9b5ad"), line = new THREE.Color("#e8e4d6");
  const quad = (a: number[], b: number[], cc: number[], d: number[], k: THREE.Color) => {
    pos.push(...a, ...cc, ...b, ...a, ...d, ...cc);
    for (let i = 0; i < 6; i++) col.push(k.r, k.g, k.b);
  };
  const H = (x: number, z: number) => roadTerrain(road, x, z).h;
  for (const s of c.streets) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const L = Math.hypot(dx, dz);
    if (L < 1) continue;
    const ux = dx / L, uz = dz / L, rx = -uz, rz = ux;
    const n = Math.max(1, Math.ceil(L / 8));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const x0 = s.ax + dx * t0, z0 = s.az + dz * t0, x1 = s.ax + dx * t1, z1 = s.az + dz * t1;
      const pt = (x: number, z: number, lat: number, up: number) => {
        const px = x + rx * lat, pz = z + rz * lat;
        return [px, H(px, pz) + up, pz];
      };
      quad(pt(x0, z0, -4.5, 0.06), pt(x0, z0, 4.5, 0.06), pt(x1, z1, 4.5, 0.06), pt(x1, z1, -4.5, 0.06), asphalt);
      for (const sd of [-1, 1]) {
        quad(pt(x0, z0, sd * 4.5, 0.2), pt(x0, z0, sd * 6, 0.2), pt(x1, z1, sd * 6, 0.2), pt(x1, z1, sd * 4.5, 0.2), kerb);
      }
      if (i % 2 === 0) {
        const xa = x0 + ux * 1, za = z0 + uz * 1, xb = x0 + ux * 4, zb = z0 + uz * 4;
        quad(pt(xa, za, -0.12, 0.08), pt(xa, za, 0.12, 0.08), pt(xb, zb, 0.12, 0.08), pt(xb, zb, -0.12, 0.08), line);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

const TRAFFIC = ["sedan_r", "sedan_b", "sedan_w", "taxi", "sedan_r", "van", "sedan_w", "police", "bus", "sedan_b"];
/** Near versions within this (plus the object's size); small things vanish past FAR_SMALL. */
const NEAR = 70, MID = 240, FAR_SMALL = 320;

export interface KitView {
  /** Moves traffic and picks what to draw for this camera. */
  update(dt: number, cam: THREE.Camera): void;
  dispose(): void;
}

/** Adds a road map's kit objects to the world (once the kit has loaded). */
export function buildKit(group: THREE.Group, road: Road, night: boolean, sky: THREE.Color, fogFar: number, time: { value: number }): KitView {
  const c = compose(road);
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  let live: ((dt: number, cam: THREE.Camera) => void) | null = null;
  let gone = false;
  if (!c) return { update() {}, dispose() {} };

  const sg = streets(c, road, night);
  if (sg) {
    const sm = new THREE.MeshLambertMaterial({ vertexColors: true });
    geos.push(sg); mats.push(sm);
    group.add(new THREE.Mesh(sg, sm));
  }

  loadKit(road.dress!.kit).then((kit) => {
    if (!kit || gone) return;
    const mat = kitMaterial(time, night ? 1 : 0.3, sky);
    mats.push(mat);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);

    // ── Still objects ──
    interface Set { near: THREE.InstancedMesh; far: THREE.InstancedMesh; block: THREE.InstancedMesh | null; mats: Float32Array; xz: Float32Array; big: boolean; r: number }
    const sets: Set[] = [];
    const byObj = new Map<string, Placed[]>();
    for (const p of c.placed) { const l = byObj.get(p.o); if (l) l.push(p); else byObj.set(p.o, [p]); }
    for (const [o, list] of byObj) {
      const g = kit.get(o);
      if (!g) continue;
      const M = new Float32Array(list.length * 16), XZ = new Float32Array(list.length * 2);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, Math.atan2(p.fx, p.fz));
        m4.compose(v.set(p.x, p.y, p.z), q, one).toArray(M, i * 16);
        XZ[i * 2] = p.x; XZ[i * 2 + 1] = p.z;
      });
      const big = (c.kit[o]?.h ?? 0) > 18 && c.kit[o]?.solid !== false;
      const near = new THREE.InstancedMesh(g.near, mat, list.length), far = new THREE.InstancedMesh(g.far, mat, list.length);
      const block = big ? new THREE.InstancedMesh(g.block, mat, list.length) : null;
      for (const im of [near, far, block]) { if (!im) continue; im.frustumCulled = false; im.count = 0; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(im); }
      sets.push({ near, far, block, mats: M, xz: XZ, big, r: g.r });
    }

    // ── Traffic ──
    interface Car { st: number; t: number; dir: number; speed: number; type: number }
    const cars: Car[] = [];
    const tGeo = TRAFFIC.map((o) => kit.get(o)).filter((g): g is KitGeo => !!g);
    const tMesh = tGeo.map((g) => {
      const near = new THREE.InstancedMesh(g.near, mat, 64), far = new THREE.InstancedMesh(g.far, mat, 64);
      for (const im of [near, far]) { im.frustumCulled = false; im.count = 0; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(im); }
      return { near, far };
    });
    const SL = c.streets.map((s) => Math.hypot(s.bx - s.ax, s.bz - s.az));
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const nearStreets: number[] = [];

    let wait = 0;
    const cx = { x: 1e9, z: 1e9 }, fwd = new THREE.Vector3();
    const pick = (cam: THREE.Camera) => {
      cam.getWorldDirection(fwd);
      const fl = Math.hypot(fwd.x, fwd.z) || 1;
      const ux = fwd.x / fl, uz = fwd.z / fl;
      const px = cam.position.x, pz = cam.position.z;
      cx.x = px; cx.z = pz;
      const far2 = fogFar * fogFar;
      for (const s of sets) {
        let nn = 0, nf = 0, nb = 0;
        const n = s.xz.length / 2;
        const lim = s.big ? far2 : FAR_SMALL * FAR_SMALL;
        for (let i = 0; i < n; i++) {
          const dx = s.xz[i * 2] - px, dz = s.xz[i * 2 + 1] - pz;
          const d2 = dx * dx + dz * dz;
          if (d2 > lim) continue;
          const d = Math.sqrt(d2);
          // Behind the camera (with room for its size and a turn of the view).
          if (d > s.r + 20 && dx * ux + dz * uz < -d * 0.35 + s.r) continue;
          const m = s.mats.subarray(i * 16, i * 16 + 16);
          if (d < NEAR + s.r) s.near.instanceMatrix.array.set(m, (nn++) * 16);
          else if (!s.block || d < MID + s.r) s.far.instanceMatrix.array.set(m, (nf++) * 16);
          else s.block.instanceMatrix.array.set(m, (nb++) * 16);
        }
        s.near.count = nn; s.far.count = nf;
        s.near.instanceMatrix.needsUpdate = true; s.far.instanceMatrix.needsUpdate = true;
        if (s.block) { s.block.count = nb; s.block.instanceMatrix.needsUpdate = true; }
      }
      // Streets near the camera get cars (the same ones while they stay near).
      nearStreets.length = 0;
      c.streets.forEach((st, i) => {
        const mx = (st.ax + st.bx) / 2 - px, mz = (st.az + st.bz) / 2 - pz;
        if (mx * mx + mz * mz < 300 * 300) nearStreets.push(i);
      });
      for (let i = cars.length - 1; i >= 0; i--) if (!nearStreets.includes(cars[i].st)) cars.splice(i, 1);
      for (const st of nearStreets) {
        if (cars.length >= tMesh.length * 12) break;
        if (cars.some((k) => k.st === st)) continue;
        const k = Math.floor(rnd() * 3);
        for (let j = 0; j < k; j++) cars.push({ st, t: rnd(), dir: rnd() < 0.5 ? 1 : -1, speed: 8 + rnd() * 6, type: Math.floor(rnd() * tMesh.length) });
      }
    };
    const counts = tMesh.map(() => ({ n: 0, f: 0 }));
    live = (dt, cam) => {
      wait -= dt;
      if (wait <= 0 || Math.hypot(cam.position.x - cx.x, cam.position.z - cx.z) > 25) { pick(cam); wait = 0.12; }
      for (const k of counts) { k.n = 0; k.f = 0; }
      for (const car of cars) {
        const st = c.streets[car.st], L = SL[car.st];
        car.t += (car.dir * car.speed * dt) / L;
        if (car.t > 1) car.t -= 1; else if (car.t < 0) car.t += 1;
        const ux = (st.bx - st.ax) / L, uz = (st.bz - st.az) / L;
        const fx = ux * car.dir, fz = uz * car.dir;
        const lane = 2.2; // drive on the right
        const x = st.ax + (st.bx - st.ax) * car.t + fz * lane, z = st.az + (st.bz - st.az) * car.t - fx * lane;
        q.setFromAxisAngle(up, Math.atan2(fx, fz));
        m4.compose(v.set(x, roadTerrain(road, x, z).h + 0.06, z), q, one);
        const dx = x - cam.position.x, dz = z - cam.position.z;
        const tm = tMesh[car.type], cnt = counts[car.type];
        if (dx * dx + dz * dz < NEAR * NEAR) { if (cnt.n < 64) m4.toArray(tm.near.instanceMatrix.array, (cnt.n++) * 16); }
        else if (cnt.f < 64) m4.toArray(tm.far.instanceMatrix.array, (cnt.f++) * 16);
      }
      tMesh.forEach((tm, i) => {
        tm.near.count = counts[i].n; tm.far.count = counts[i].f;
        tm.near.instanceMatrix.needsUpdate = true; tm.far.instanceMatrix.needsUpdate = true;
      });
    };
  });

  return {
    update(dt, cam) { live?.(dt, cam); },
    dispose() {
      gone = true;
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
