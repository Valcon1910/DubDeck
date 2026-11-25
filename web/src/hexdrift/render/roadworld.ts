// The 3D world of a road map: the land as one big mesh sampled from the same
// height function the physics uses, the road with its markings painted by
// the shader (lanes, curbs, boost pads, the start and the finish), barriers,
// tunnels, bridges, gantries, the sea and the sky. Static things are merged
// into a few meshes and scenery is instanced, so phones stay smooth.
import * as THREE from "three";
import { groundAt, type Track } from "../sim/track.ts";
import { terrainAt } from "../sim/terrain.ts";
import { BOOST, FLUSH, GAP, landAt, MAT, roadDist, TUN, WALL_H, WALL_T, WL, WR, THICK, type Road, type Sample } from "../sim/road.ts";
import type { Biome, BiomeId } from "../maps.ts";
import { buildProps } from "./props.ts";
import { buildKit } from "./kit.ts";
import { clampUnder, sinkUnderStreets } from "./under.ts";
import { addGrain, noiseTex } from "./textures.ts";
import type { World } from "./world.ts";

const NONE = -1e8;

/** How a setting looks. */
export interface Look {
  /** Ground colours by material: grass, sand, rock, snow, dirt, sea bed, pavement. */
  ground: string[];
  rock: string;
  sea?: { shallow: string; deep: string; opacity: number };
  /** 0 dry .. 1 soaked roads. */
  wet: number;
  night: boolean;
  sun: [number, number, number]; sunColor: string; sunI: number;
  hemiSky: string; hemiGround: string; hemiI: number;
  skyTop: string; skyHorizon: string; skyLow: string;
  sunDisc: string; clouds: number; stars: number;
  barrier: "jersey" | "armco" | "neon";
  asphalt: string; line: string; centre: string; curbA: string; curbB: string;
  dirt: string; sand: string; metal: string;
}

export const LOOKS: Partial<Record<BiomeId, Look>> = {
  miami: {
    ground: ["#7d9a4f", "#e8cf9c", "#9a8f80", "#ffffff", "#a5835a", "#c9b48a", "#cdbfae"], rock: "#9a8f80",
    sea: { shallow: "#2fc4c9", deep: "#145f8f", opacity: 0.86 },
    wet: 0, night: false,
    sun: [-0.55, 0.22, 0.8], sunColor: "#ffc48a", sunI: 3.1, hemiSky: "#ffcfb8", hemiGround: "#6a4a64", hemiI: 0.95,
    skyTop: "#3d4fa8", skyHorizon: "#ff9a62", skyLow: "#ffb98a", sunDisc: "#fff0c8", clouds: 0.55, stars: 0,
    barrier: "jersey", asphalt: "#5a5660", line: "#f4f1ea", centre: "#f2c230", curbA: "#e8364c", curbB: "#f4f1ea",
    dirt: "#a5835a", sand: "#e2c48e", metal: "#8f95a8",
  },
  storm: {
    ground: ["#2c3a2c", "#4a4538", "#3a3a40", "#c8d0dc", "#3a3028", "#1d2a33", "#3a3c44"], rock: "#33333a",
    sea: { shallow: "#16343f", deep: "#081820", opacity: 0.92 },
    wet: 1, night: true,
    sun: [0.3, 0.6, -0.4], sunColor: "#8fa8ff", sunI: 0.55, hemiSky: "#3a4a7a", hemiGround: "#141018", hemiI: 1.1,
    skyTop: "#05070f", skyHorizon: "#1a2240", skyLow: "#1a2240", sunDisc: "#000000", clouds: 0.95, stars: 0,
    barrier: "jersey", asphalt: "#2e2e36", line: "#e6ecff", centre: "#e0b030", curbA: "#d02a44", curbB: "#e6ecff",
    dirt: "#3a3028", sand: "#4a4538", metal: "#555a6a",
  },
  alpine: {
    ground: ["#5f7d45", "#b9ab8a", "#7d7870", "#f4f8ff", "#7a6248", "#4f6a5a", "#8a8a8a"], rock: "#7a756e",
    sea: { shallow: "#3a9ab8", deep: "#1b4f6e", opacity: 0.9 },
    wet: 0.15, night: false,
    sun: [0.45, 0.75, 0.35], sunColor: "#fff6e8", sunI: 2.0, hemiSky: "#bcd8ff", hemiGround: "#5a5a48", hemiI: 1.35,
    skyTop: "#2f6fd0", skyHorizon: "#cfe3f7", skyLow: "#e6eef6", sunDisc: "#ffffff", clouds: 0.35, stars: 0,
    barrier: "armco", asphalt: "#4d4f57", line: "#ffffff", centre: "#ffffff", curbA: "#d8283c", curbB: "#ffffff",
    dirt: "#7a6248", sand: "#b9ab8a", metal: "#8f95a8",
  },
  space: {
    ground: ["#3a3550", "#4a4560", "#2a2838", "#9aa0c0", "#3a3550", "#101020", "#2f3248"], rock: "#2a2838",
    wet: 0.3, night: true,
    sun: [0.6, 0.35, 0.7], sunColor: "#dfe8ff", sunI: 1.9, hemiSky: "#6a5aff", hemiGround: "#1a0f2a", hemiI: 1.3,
    skyTop: "#020208", skyHorizon: "#0d0824", skyLow: "#020208", sunDisc: "#fff8e8", clouds: 0, stars: 1,
    barrier: "neon", asphalt: "#30334a", line: "#7cf7ff", centre: "#ff3df2", curbA: "#ff3df2", curbB: "#20223a",
    dirt: "#3a3550", sand: "#4a4560", metal: "#3a3e58",
  },
  baja: {
    ground: ["#a8a060", "#ddb57a", "#a07a5a", "#ffffff", "#b38a5a", "#7a9aa8", "#c9a87a"], rock: "#9a6e4e",
    wet: 0, night: false,
    sun: [0.35, 0.8, -0.45], sunColor: "#fff2d8", sunI: 2.2, hemiSky: "#cfe4ff", hemiGround: "#8a6a48", hemiI: 1.3,
    skyTop: "#3d82d6", skyHorizon: "#f2e2c4", skyLow: "#f2dcb4", sunDisc: "#ffffff", clouds: 0.2, stars: 0,
    barrier: "armco", asphalt: "#5a5660", line: "#fff3d6", centre: "#fff3d6", curbA: "#ff7a1a", curbB: "#fff3d6",
    dirt: "#a9845c", sand: "#d8b07a", metal: "#8f95a8",
  },
  sky: {
    ground: ["#7ccf62", "#e8d9a8", "#8c7a68", "#ffffff", "#9a7a5a", "#bfe6ff", "#d8d4e8"], rock: "#8c7a68",
    wet: 0, night: false,
    sun: [0.5, 0.7, 0.4], sunColor: "#fff8ec", sunI: 1.9, hemiSky: "#cfeaff", hemiGround: "#8a7a9a", hemiI: 1.45,
    skyTop: "#4aa3ff", skyHorizon: "#d8f0ff", skyLow: "#f4fbff", sunDisc: "#ffffff", clouds: 0.8, stars: 0,
    barrier: "neon", asphalt: "#4c5672", line: "#ffe27a", centre: "#ff7ad9", curbA: "#ff7ad9", curbB: "#ffffff",
    dirt: "#9a7a5a", sand: "#e8d9a8", metal: "#8f95a8",
  },
};

/** Fog, background and lights for a map (road maps have their own look; tile maps keep theirs). */
export function setupScene(scene: THREE.Scene, biome: Biome, id: BiomeId, road: boolean, near = 1, far = 1): { sun: THREE.DirectionalLight; hemi?: THREE.HemisphereLight } {
  const L = road ? LOOKS[id] : undefined;
  const fog = L ? L.skyHorizon : biome.fog;
  scene.fog = new THREE.Fog(fog, biome.fogNear * near, biome.fogFar * far);
  scene.background = new THREE.Color(fog);
  if (!L) {
    scene.add(new THREE.HemisphereLight(biome.sky, biome.ground, 1.5));
    const sun = new THREE.DirectionalLight("#ffffff", 1.7);
    sun.position.set(0.45, 1, 0.3);
    scene.add(sun);
    return { sun };
  }
  const hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(L.sunColor, L.sunI);
  sun.position.set(...L.sun);
  scene.add(sun);
  return { sun, hemi };
}

/** Collects triangles with colours (flat normals). */
class Builder {
  pos: number[] = [];
  col: number[] = [];
  private c = new THREE.Color();
  tri(a: number[], b: number[], c: number[], color: THREE.ColorRepresentation) {
    this.c.set(color);
    // (Written with the road's right as +lat, which is a mirror image: flip.)
    this.pos.push(...a, ...c, ...b);
    for (let i = 0; i < 3; i++) this.col.push(this.c.r, this.c.g, this.c.b);
  }
  /** Counter-clockwise seen from the front. */
  quad(a: number[], b: number[], c: number[], d: number[], color: THREE.ColorRepresentation) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }
  quad2(a: number[], b: number[], c: number[], d: number[], color: THREE.ColorRepresentation) {
    this.quad(a, b, c, d, color);
    this.quad(a, d, c, b, color);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

/** A point beside a sample: lat to the right, dh up (follows the road's lean). */
const side = (p: Sample, lat: number, dh = 0): number[] => [p.x - p.dz * lat, p.y + p.bank * lat + dh, p.z + p.dx * lat];

export function buildRoadWorld(track: Track, biome: Biome, id: BiomeId): World {
  const road = track.road!;
  const look = LOOKS[id] ?? LOOKS.miami!;
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const time = { value: 0 };
  const updates: ((dt: number) => void)[] = [(dt) => { time.value += dt; }];

  sky(group, look, geos, mats, time);
  const ground = road.land.kind !== "void" ? terrain(group, track, look, geos, mats) : null;
  if (road.land.sea !== undefined && look.sea) water(group, road, look, geos, mats, time);
  roadSurface(group, road, look, geos, mats, time);
  const misc = new Builder();
  const glow = new Builder();
  edges(misc, track, look);
  barriers(misc, glow, road, look, biome);
  tunnels(misc, glow, road, look);
  gantries(misc, glow, road, look, biome);
  const mg = misc.geometry(); geos.push(mg);
  const mm = new THREE.MeshLambertMaterial({ vertexColors: true });
  addGrain(mm, 0.5, 0.05, 0.6);
  mats.push(mm);
  group.add(new THREE.Mesh(mg, mm));
  if (glow.pos.length) {
    const gg = glow.geometry(); geos.push(gg);
    const gm = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    mats.push(gm);
    group.add(new THREE.Mesh(gg, gm));
  }
  pillars(group, track, geos, mats);

  const props = buildProps(group, track, biome, id, geos, mats);
  const kit = buildKit(group, road, look.night, new THREE.Color(look.skyHorizon), biome.fogFar, time);
  return {
    group,
    breakables: props.breakables,
    update(dt, cheer = 0, cam) {
      for (const u of updates) u(dt);
      props.update(dt, cheer);
      if (cam) { kit.update(dt, cam); ground?.(cam); }
    },
    dispose() {
      kit.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

// ── Sky ─────────────────────────────────────────────────────────────────────

function sky(group: THREE.Group, L: Look, geos: THREE.BufferGeometry[], mats: THREE.Material[], time: { value: number }) {
  const g = new THREE.SphereGeometry(2200, 32, 16);
  geos.push(g);
  const sun = new THREE.Vector3(...L.sun).normalize();
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(L.skyTop) }, uHor: { value: new THREE.Color(L.skyHorizon) }, uLow: { value: new THREE.Color(L.skyLow) },
      uSun: { value: sun }, uSunCol: { value: new THREE.Color(L.sunDisc) }, uClouds: { value: L.clouds }, uStars: { value: L.stars },
      uNoise: { value: noiseTex() }, uTime: time, uNight: { value: L.night ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHor, uLow, uSun, uSunCol;
      uniform float uClouds, uStars, uTime, uNight;
      uniform sampler2D uNoise;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(uHor, uTop, pow(h, 0.55)) : mix(uHor, uLow, clamp(-h * 6.0, 0.0, 1.0));
        float sd = max(dot(d, uSun), 0.0);
        // A warm glow round the sun, and the sun itself.
        col += uSunCol * (pow(sd, 10.0) * 0.32 + pow(sd, 90.0) * 0.5) * (1.0 - uNight);
        col = mix(col, uSunCol * 1.25, smoothstep(0.9993, 0.9996, sd) * (1.0 - uNight));
        // Clouds on a plane high above.
        if (uClouds > 0.0 && h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 0.22 + vec2(uTime * 0.0035, uTime * 0.0012);
          float c = texture2D(uNoise, uv).g * 0.65 + texture2D(uNoise, uv * 3.1).r * 0.35;
          float m = smoothstep(0.52 - uClouds * 0.2, 0.78, c) * smoothstep(0.0, 0.25, h);
          vec3 cc = mix(vec3(1.0), uHor * 1.1, 0.35) + uSunCol * pow(sd, 6.0) * 0.6;
          if (uNight > 0.5) cc = uHor * 1.6 + 0.04;
          col = mix(col, cc, m * 0.9);
        }
        // Stars.
        if (uStars > 0.0) {
          vec3 q = floor(d * 380.0);
          float r = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float tw = 0.6 + 0.4 * sin(uTime * 2.0 + r * 50.0);
          col += vec3(step(0.9975, r) * tw) * uStars;
          // A faint band of the galaxy.
          float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.5, -0.8))) * 3.2, 2.0));
          col += vec3(0.25, 0.18, 0.4) * band * texture2D(uNoise, d.xz * 2.0 + d.y).g * 0.5 * uStars;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  mats.push(m);
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = "sky";
  // The dome moves with the camera (set in the vertex shader).
  group.add(mesh);
}

// ── The land ────────────────────────────────────────────────────────────────

/** Terrain tiles: finer near the camera, coarser further off. */
type TerrainLod = (cam: THREE.Camera) => void;

function terrain(group: THREE.Group, track: Track, L: Look, geos: THREE.BufferGeometry[], mats: THREE.Material[]): TerrainLod {
  const road = track.road!;
  const isles = road.land.kind === "isles";
  const axis = (a0: number, a1: number) => {
    const lo = a0 - 160, hi = a1 + 160, far = isles ? 200 : 1500;
    const before: number[] = [];
    for (let v = lo, st = 4; v > lo - far; st = Math.min(80, st * 1.18), v -= st) before.push(v);
    const out = before.reverse();
    for (let x = lo + 4; x < hi; x += 4) out.push(x);
    for (let v = hi, st = 4; v < hi + far; st = Math.min(80, st * 1.18), v += st) out.push(v);
    return out;
  };
  const xs = axis(road.x0, road.x1), zs = axis(road.z0, road.z1);
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
  const hs = new Float32Array(nx * nz), mt = new Uint8Array(nx * nz), valid = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const t = terrainAt(track, xs[i], zs[j]);
      let h = t.h;
      valid[k] = h > NONE ? 1 : 0;
      if (!valid[k]) h = road.minY - 30;
      else {
        // Tucked a little under the road so it never shows through.
        const g = groundAt(track, xs[i], h + 2.5, zs[j], 0);
        if (g && g.h - h < 1.2) h -= 0.45;
        h = clampUnder(road, xs[i], zs[j], sinkUnderStreets(road, xs[i], zs[j], h));
      }
      // Near a road: a kerb-side strip in the verge colour; further out, the land itself.
      let mat = t.mat === MAT.water ? MAT.water : landAt(road.land, xs[i], zs[j]).mat;
      if (valid[k] && road.land.verge !== undefined && roadDist(road, xs[i], zs[j], 4) < 3.2) mat = road.land.verge;
      hs[k] = h; mt[k] = mat;
      pos[k * 3] = xs[i]; pos[k * 3 + 1] = h; pos[k * 3 + 2] = zs[j];
    }
  }
  const pal = L.ground.map((c) => new THREE.Color(c));
  const rock = new THREE.Color(L.rock), c = new THREE.Color(), snow = new THREE.Color(L.ground[3]);
  const sea = road.land.sea;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(nz - 1, j + 1);
      const gx = (hs[j * nx + i1] - hs[j * nx + i0]) / ((xs[i1] - xs[i0]) || 1);
      const gz = (hs[j1 * nx + i] - hs[j0 * nx + i]) / ((zs[j1] - zs[j0]) || 1);
      const steep = Math.sqrt(gx * gx + gz * gz);
      c.copy(pal[mt[k]] ?? pal[0]);
      // Steep ground is bare rock (snow stays on gentler slopes).
      const r = Math.max(0, Math.min(1, (steep - 0.55) * 2.2));
      c.lerp(rock, r);
      if (mt[k] === 3 && r > 0.2) c.lerp(snow, 0.25);
      // Under the sea: darker with depth.
      if (sea !== undefined && hs[k] < sea) c.lerp(pal[5], Math.min(1, (sea - hs[k]) / 6));
      // Wet sand right at the waterline.
      if (sea !== undefined && hs[k] >= sea && hs[k] < sea + 0.6 && mt[k] === 1) c.multiplyScalar(0.78);
      const v = 0.93 + (((i * 73856093) ^ (j * 19349663)) >>> 0) % 1000 / 1000 * 0.1;
      col[k * 3] = c.r * v; col[k * 3 + 1] = c.g * v; col[k * 3 + 2] = c.b * v;
    }
  }
  const cell = (i: number, j: number, out: number[], k = 1, i1 = nx - 1, j1 = nz - 1) => {
    const ii = Math.min(i + k, i1), jj = Math.min(j + k, j1);
    const a = j * nx + i, b = j * nx + ii, d = jj * nx + i, e = jj * nx + ii;
    if (isles && !(valid[a] && valid[b] && valid[d] && valid[e])) return;
    out.push(a, d, b, b, d, e);
  };
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) cell(i, j, idx);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  geos.push(g);
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  addGrain(m, 0.21, 0.018, 1.1);
  mats.push(m);
  g.setIndex(null);
  // In tiles (sharing the one set of points), so what is off screen is
  // skipped, each with three levels of detail (every point, every 2nd, every 4th).
  const T = 48;
  const tiles: { mesh: THREE.Mesh; lods: THREE.BufferGeometry[]; c: THREE.Vector3; r: number }[] = [];
  for (let tj = 0; tj < nz - 1; tj += T) {
    for (let ti = 0; ti < nx - 1; ti += T) {
      const i1 = Math.min(nx - 1, ti + T), j1 = Math.min(nz - 1, tj + T);
      const lods: THREE.BufferGeometry[] = [];
      for (const k of [1, 2, 4]) {
        const ix: number[] = [];
        for (let j = tj; j < j1; j += k) for (let i = ti; i < i1; i += k) cell(i, j, ix, k, i1, j1);
        if (!ix.length) break;
        const tg = new THREE.BufferGeometry();
        for (const a of ["position", "color", "normal"]) tg.setAttribute(a, g.getAttribute(a));
        tg.setIndex(ix);
        // Bounds from this tile's own points (the shared list holds them all).
        const bb = new THREE.Box3(), pt = new THREE.Vector3();
        for (const q of ix) bb.expandByPoint(pt.fromArray(pos, q * 3));
        tg.boundingBox = bb;
        tg.boundingSphere = bb.getBoundingSphere(new THREE.Sphere());
        geos.push(tg);
        lods.push(tg);
      }
      if (!lods.length) continue;
      const mesh = new THREE.Mesh(lods[0], m);
      mesh.name = "terrain";
      group.add(mesh);
      tiles.push({ mesh, lods, c: lods[0].boundingSphere!.center, r: lods[0].boundingSphere!.radius });
    }
  }
  if (isles) islandUndersides(group, xs, zs, hs, valid, L, geos, mats);
  return (cam) => {
    for (const t of tiles) {
      const d = Math.max(0, Math.hypot(t.c.x - cam.position.x, t.c.z - cam.position.z) - t.r);
      const want = t.lods[d < 160 ? 0 : d < 420 ? 1 : 2] ?? t.lods[t.lods.length - 1];
      if (t.mesh.geometry !== want) t.mesh.geometry = want;
    }
  };
}

/** Sky islands: rocky undersides hanging below the grass. */
function islandUndersides(group: THREE.Group, xs: number[], zs: number[], hs: Float32Array, valid: Uint8Array, L: Look, geos: THREE.BufferGeometry[], mats: THREE.Material[]) {
  const nx = xs.length, nz = zs.length;
  const b = new Builder();
  const rock = new THREE.Color(L.rock), dark = rock.clone().multiplyScalar(0.55);
  // Depth below each valid point: deeper away from the island's edge.
  const depth = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (!valid[k]) continue;
    let e = 99;
    for (let r = 1; r < 12 && e === 99; r++) {
      for (let o = -r; o <= r; o++) {
        const pts = [[i + o, j - r], [i + o, j + r], [i - r, j + o], [i + r, j + o]];
        for (const [a, c] of pts) if (a < 0 || c < 0 || a >= nx || c >= nz || !valid[c * nx + a]) { e = r; break; }
        if (e !== 99) break;
      }
    }
    const n = Math.sin(i * 1.7 + j * 2.3) * 0.5 + 0.5;
    depth[k] = 3 + e * e * 1.6 + n * 6;
  }
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, bb = a + 1, d = a + nx, e = d + 1;
    if (!(valid[a] && valid[bb] && valid[d] && valid[e])) continue;
    const P = (k: number, ii: number, jj: number) => [xs[ii], hs[k] - depth[k], zs[jj]];
    b.quad(P(a, i, j), P(bb, i + 1, j), P(e, i + 1, j + 1), P(d, i, j + 1), dark);
    // Cliff walls on the island's rim.
    const rim = (k1: number, i1: number, j1: number, k2: number, i2: number, j2: number) => {
      b.quad([xs[i1], hs[k1], zs[j1]], [xs[i2], hs[k2], zs[j2]], [xs[i2], hs[k2] - depth[k2], zs[j2]], [xs[i1], hs[k1] - depth[k1], zs[j1]], rock);
    };
    if (j === 0 || !valid[a - nx] || !valid[bb - nx]) rim(bb, i + 1, j, a, i, j);
    if (j === nz - 2 || !valid[d + nx] || !valid[e + nx]) rim(d, i, j + 1, e, i + 1, j + 1);
    if (i === 0 || !valid[a - 1] || !valid[d - 1]) rim(a, i, j, d, i, j + 1);
    if (i === nx - 2 || !valid[bb + 1] || !valid[e + 1]) rim(e, i + 1, j + 1, bb, i + 1, j);
  }
  const g = b.geometry(); geos.push(g);
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  addGrain(m, 0.15, 0.03, 1.3);
  mats.push(m);
  group.add(new THREE.Mesh(g, m));
}

// ── The sea ─────────────────────────────────────────────────────────────────

function water(group: THREE.Group, road: Road, L: Look, geos: THREE.BufferGeometry[], mats: THREE.Material[], time: { value: number }) {
  const cx = (road.x0 + road.x1) / 2, cz = (road.z0 + road.z1) / 2;
  const g = new THREE.PlaneGeometry(6000, 6000, 1, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(cx, road.land.sea!, cz);
  geos.push(g);
  const m = new THREE.MeshStandardMaterial({ color: L.sea!.deep, roughness: 0.18, metalness: 0.1, transparent: true, opacity: L.sea!.opacity });
  const sun = new THREE.Vector3(...L.sun).normalize();
  m.onBeforeCompile = (s) => {
    s.uniforms.uNoise = { value: noiseTex() };
    s.uniforms.uTime = time;
    s.uniforms.uShallow = { value: new THREE.Color(L.sea!.shallow) };
    s.uniforms.uSunD = { value: sun };
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWp;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWp;\nuniform sampler2D uNoise;\nuniform float uTime;\nuniform vec3 uShallow;\nuniform vec3 uSunD;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        float wv1 = texture2D(uNoise, vWp.xz * 0.012 + vec2(uTime * 0.01, uTime * 0.006)).a;
        float wv2 = texture2D(uNoise, vWp.xz * 0.05 - vec2(uTime * 0.02, -uTime * 0.013)).a;
        float wv = wv1 * 0.6 + wv2 * 0.4;
        float dist = length(vWp.xz - cameraPosition.xz);
        diffuseColor.rgb = mix(diffuseColor.rgb, uShallow, smoothstep(0.35, 0.8, wv) * 0.5);
        // Foam streaks and sparkle toward the sun.
        float foam = smoothstep(0.8, 0.92, wv2) * (1.0 - smoothstep(60.0, 400.0, dist));
        diffuseColor.rgb += foam * 0.35;`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        {
          float e = 0.6;
          vec2 q = vWp.xz;
          float h0 = texture2D(uNoise, q * 0.05 - vec2(uTime * 0.02, -uTime * 0.013)).a;
          float hx = texture2D(uNoise, (q + vec2(e, 0.0)) * 0.05 - vec2(uTime * 0.02, -uTime * 0.013)).a;
          float hz = texture2D(uNoise, (q + vec2(0.0, e)) * 0.05 - vec2(uTime * 0.02, -uTime * 0.013)).a;
          vec3 pn = normalize(vec3((h0 - hx) * 2.2, 1.0, (h0 - hz) * 2.2));
          normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz);
        }`);
  };
  mats.push(m);
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 1;
  mesh.name = "water";
  group.add(mesh);
}

// ── The road ────────────────────────────────────────────────────────────────

const SURF_CODE: Record<string, number> = { asphalt: 0, dirt: 1, sand: 2, metal: 3, ice: 4 };

function roadSurface(group: THREE.Group, road: Road, L: Look, geos: THREE.BufferGeometry[], mats: THREE.Material[], time: { value: number }) {
  const pos: number[] = [], ra: number[] = [], mk: number[] = [];
  const main = road.strands[0].pts;
  // Where the gates are along the main road (start, checkpoints, finish).
  const sOf = (x: number, z: number) => {
    let bi = 0, bd = Infinity;
    main.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } });
    return main[bi].s;
  };
  const gates: { s: number; t: number }[] = [{ s: 0, t: 2 }, ...road.gates.map((g) => ({ s: sOf(g.x, g.z), t: 1 })), { s: sOf(road.finish.x, road.finish.z), t: 2 }];
  road.strands.forEach((st, si) => {
    const pts = st.pts;
    // Curvature at each sample (for curbs).
    const curv = pts.map((_p, i) => {
      const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
      const ds = b.s - a.s || 1;
      return (a.dx * b.dz - a.dz * b.dx) / ds;
    });
    // Ramps: the last 20 m before a gap.
    const gapAt: number[] = [];
    pts.forEach((p) => { if (p.flags & GAP) gapAt.push(p.s); });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a.flags & GAP) continue;
      let gate = 99, gt = 0;
      if (si === 0) for (const g of gates) { const d = (a.s + b.s) / 2 - g.s; if (Math.abs(d) < Math.abs(gate)) { gate = d; gt = g.t; } }
      const nearGap = gapAt.some((gs) => gs - b.s >= -0.1 && gs - a.s < 20);
      const code = SURF_CODE[a.surf] + (Math.abs(gate) < 6 ? gt * 10 : 0) + (nearGap ? 100 : 0);
      const b0 = a.flags & BOOST && a.boost ? a.boost[0] : 1, b1 = a.flags & BOOST && a.boost ? a.boost[1] : 0;
      const cols = [-1, 0, 1];
      const P = (p: Sample, c: number, k: number) => {
        const lat = c * p.hw;
        const q = side(p, lat, 0.02);
        pos.push(...q);
        ra.push(lat, p.s, p.hw, curv[k]);
        // Gate distance from this vertex.
        let gd = 99;
        if (si === 0) for (const g of gates) { const d = p.s - g.s; if (Math.abs(d) < Math.abs(gd)) gd = d; }
        mk.push(b0, b1, Math.abs(gate) < 6 ? gd : 99, code);
      };
      for (let c = 0; c < 2; c++) {
        const c0 = cols[c], c1 = cols[c + 1];
        // Two triangles, counter-clockwise from above.
        P(a, c0, i); P(a, c1, i); P(b, c1, i + 1);
        P(a, c0, i); P(b, c1, i + 1); P(b, c0, i + 1);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aRoad", new THREE.Float32BufferAttribute(ra, 4));
  g.setAttribute("aMark", new THREE.Float32BufferAttribute(mk, 4));
  g.computeVertexNormals();
  geos.push(g);
  const m = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.88, metalness: 0 });
  const C = (c: string) => ({ value: new THREE.Color(c) });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, {
      uNoise: { value: noiseTex() }, uTime: time, uWet: { value: L.wet },
      uAsphalt: C(L.asphalt), uLine: C(L.line), uCentre: C(L.centre), uCurbA: C(L.curbA), uCurbB: C(L.curbB),
      uDirt: C(L.dirt), uSand: C(L.sand), uMetal: C(L.metal), uBoost: C("#2ee6ff"), uAccent: C(L.centre),
    });
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aRoad;\nattribute vec4 aMark;\nvarying vec4 vRoad;\nvarying vec4 vMark;\nvarying vec3 vWp;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvRoad = aRoad; vMark = aMark; vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec4 vRoad; varying vec4 vMark; varying vec3 vWp;
        uniform sampler2D uNoise; uniform float uTime; uniform float uWet;
        uniform vec3 uAsphalt, uLine, uCentre, uCurbA, uCurbB, uDirt, uSand, uMetal, uBoost, uAccent;
        float band(float x, float a, float b, float aa) { return smoothstep(a - aa, a + aa, x) - smoothstep(b - aa, b + aa, x); }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        float lat = vRoad.x, sv = vRoad.y, hw = vRoad.z, curv = vRoad.w;
        float al = abs(lat);
        float code = vMark.w + 0.01;
        float rampF = step(99.5, code); code -= rampF * 100.0;
        float gateT = floor(code / 10.0); float surf = floor(code - gateT * 10.0);
        float n1 = texture2D(uNoise, vWp.xz * 0.29).r, n2 = texture2D(uNoise, vWp.xz * 0.041).g, n3 = texture2D(uNoise, vWp.xz * 1.3).b;
        float aa = max(fwidth(lat), 0.002) * 0.8;
        float hxGlow = 0.0, hxBoost = 0.0, hxPaint = 0.0;
        vec3 col;
        if (surf < 0.5) {
          col = uAsphalt * (0.8 + 0.22 * n1 + 0.1 * n3) * (0.86 + 0.28 * n2);
          // Darker, polished lines where tyres run.
          float lw = 3.6;
          float inLane = mod(al, lw) / lw;
          col *= 1.0 - 0.07 * (exp(-pow((inLane - 0.27) * 7.0, 2.0)) + exp(-pow((inLane - 0.73) * 7.0, 2.0)));
          float edge = band(al, hw - 0.9, hw - 0.62, aa);
          float k = floor(al / lw + 0.5);
          float lane = (k >= 1.0 && k * lw < hw - 1.7) ? band(abs(al - k * lw), -0.08, 0.08, aa) * step(mod(sv, 12.0), 6.0) : 0.0;
          float centre = hw > 7.4 ? band(al, 0.1, 0.24, aa) : band(al, -0.09, 0.09, aa) * step(mod(sv, 12.0), 6.0);
          hxPaint = clamp(edge + lane, 0.0, 1.0) * (0.82 + 0.18 * n3);
          col = mix(col, uLine, hxPaint);
          col = mix(col, uCentre, centre * 0.9);
          hxPaint = max(hxPaint, centre);
          // Curbs round the bends.
          if (abs(curv) > 0.006 && al > hw - 0.55) {
            col = mix(uCurbA, uCurbB, step(mod(sv, 4.0), 2.0)) * (0.88 + 0.12 * n1);
            hxPaint = 1.0;
          }
        } else if (surf < 1.5) {
          col = uDirt * (0.72 + 0.34 * n1 + 0.12 * n3) * (0.82 + 0.34 * n2);
          float rut = exp(-pow((al - 1.7) / 0.5, 2.0));
          col *= 1.0 - 0.2 * rut;
          col = mix(col, uDirt * 1.18, smoothstep(hw - 3.0, hw, al) * 0.55);
        } else if (surf < 2.5) {
          col = uSand * (0.86 + 0.18 * n1) * (0.9 + 0.2 * n2) * (0.96 + 0.04 * sin(sv * 2.4 + n2 * 9.0));
          col *= 1.0 - 0.12 * exp(-pow((al - 1.6) / 0.5, 2.0));
        } else if (surf < 3.5) {
          col = uMetal * (0.85 + 0.12 * n1);
          vec2 cell = abs(fract(vec2(sv / 6.0, lat / 4.0)) - 0.5);
          col *= 1.0 - 0.45 * smoothstep(0.46, 0.49, max(cell.x, cell.y));
          hxGlow = band(al, hw - 0.7, hw - 0.35, aa) + band(al, -0.12, 0.12, aa) * step(mod(sv - uTime * 30.0, 10.0), 5.0) * 0.8;
          col = mix(col, uLine, hxGlow);
        } else {
          col = vec3(0.72, 0.86, 0.95) * (0.8 + 0.3 * n1) * (0.9 + 0.2 * n2);
          col = mix(col, vec3(1.0), smoothstep(0.9, 0.97, n3) * 0.6);
        }
        // Start and finish: a chequered band; checkpoints: a coloured line.
        float gd = vMark.z;
        if (gateT > 1.5 && abs(gd) < 2.4) {
          float ch = mod(floor(sv / 1.2) + floor((lat + 60.0) / 1.2), 2.0);
          col = mix(col, ch > 0.5 ? vec3(0.95) : vec3(0.06), 0.95);
          hxPaint = 1.0;
        } else if (gateT > 0.5 && gateT < 1.5 && abs(gd) < 0.7) {
          col = mix(col, uAccent, 0.9);
          hxGlow = max(hxGlow, 0.4);
        }
        // Ramp kickers: yellow and black.
        if (rampF > 0.5) {
          float st = step(0.5, fract((sv + al) / 2.4));
          col = mix(col, st > 0.5 ? vec3(1.0, 0.78, 0.08) : vec3(0.07), 0.8);
          hxPaint = 1.0;
        }
        // Boost pads: arrows running forward.
        if (vMark.x < vMark.y && lat > vMark.x && lat < vMark.y) {
          float chev = fract(sv * 0.2 - al * 0.2 - uTime * 1.8);
          hxBoost = smoothstep(0.5, 0.56, chev) - smoothstep(0.8, 0.86, chev);
          col = mix(col * 0.55, uBoost * 0.35, 0.4);
          col = mix(col, uBoost, hxBoost);
        }
        // Wet roads: darker, with puddles.
        float wetK = uWet * (0.55 + 0.45 * smoothstep(0.35, 0.7, n2));
        col *= 1.0 - 0.38 * wetK * (1.0 - hxPaint * 0.5);
        diffuseColor.rgb = col;`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, wetK);
        roughnessFactor = mix(roughnessFactor, 0.55, hxPaint * 0.5);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += uBoost * hxBoost * 1.4 + uLine * hxGlow * 0.9;`);
  };
  mats.push(m);
  const mesh = new THREE.Mesh(g, m);
  mesh.name = "road";
  group.add(mesh);
}

// ── Road edges: verges, embankment skirts, undersides ───────────────────────

function edges(b: Builder, track: Track, L: Look) {
  const road = track.road!;
  const verge = new THREE.Color(L.ground[road.land.verge ?? 4] ?? L.ground[0]);
  const concrete = new THREE.Color("#a7a4a0").multiplyScalar(L.night ? 0.45 : 1);
  const under = concrete.clone().multiplyScalar(0.6);
  for (const st of road.strands) {
    const pts = st.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      if (a.flags & GAP) continue;
      const flush = (a.flags & FLUSH) !== 0;
      for (const sd of [-1, 1]) {
        const walled = (a.flags & (sd < 0 ? WL : WR)) !== 0;
        // A shoulder strip that slopes down into the ground.
        const ea = side(a, sd * a.hw, 0.015), ec = side(c, sd * c.hw, 0.015);
        const oa = side(a, sd * (a.hw + 1.4), flush ? -0.06 : -0.35), oc = side(c, sd * (c.hw + 1.4), flush ? -0.06 : -0.35);
        if (!walled) {
          if (sd > 0) b.quad(ea, ec, oc, oa, verge); else b.quad(ea, oa, oc, ec, verge);
        }
        if (flush) continue;
        // The slab's side, down into the ground.
        const da = [ea[0], ea[1] - THICK - 1.5, ea[2]], dc = [ec[0], ec[1] - THICK - 1.5, ec[2]];
        if (sd > 0) b.quad(ea, da, dc, ec, concrete); else b.quad(ea, ec, dc, da, concrete);
      }
      if (flush) continue;
      // The underside (seen on bridges and jumps).
      const la = side(a, -a.hw, -THICK), ra = side(a, a.hw, -THICK), lc = side(c, -c.hw, -THICK), rc = side(c, c.hw, -THICK);
      b.quad(la, lc, rc, ra, under);
      // The end faces where the road stops (gaps, start, end).
      const end = (p: Sample, dir: number) => {
        const l = side(p, -p.hw), r = side(p, p.hw), lb = side(p, -p.hw, -THICK), rb = side(p, p.hw, -THICK);
        if (dir > 0) b.quad(l, r, rb, lb, concrete); else b.quad(l, lb, rb, r, concrete);
      };
      if (i === 0 || (pts[i - 1].flags & GAP)) end(a, -1);
      if (i === pts.length - 2 || (c.flags & GAP)) end(c, 1);
    }
  }
}

/** Columns under roads that run high over the ground. */
function pillars(group: THREE.Group, track: Track, geos: THREE.BufferGeometry[], mats: THREE.Material[]) {
  const road = track.road!;
  if (road.land.kind === "void") return;
  const spots: THREE.Matrix4[] = [];
  for (const st of road.strands) {
    let last = -99;
    for (const p of st.pts) {
      if (p.flags & (GAP | FLUSH) || p.s - last < 22) continue;
      const g = terrainAt(track, p.x, p.z).h;
      if (g <= NONE || p.y - THICK - g < 2.5) continue;
      last = p.s;
      for (const sd of p.hw > 7 ? [-0.55, 0.55] : [0]) {
        const q = side(p, sd * p.hw);
        spots.push(new THREE.Matrix4().makeScale(1, q[1] - THICK - g + 1, 1).setPosition(q[0], g - 1, q[2]));
      }
    }
  }
  if (!spots.length) return;
  const geo = new THREE.CylinderGeometry(0.9, 1.1, 1, 10).translate(0, 0.5, 0);
  geos.push(geo);
  const m = new THREE.MeshLambertMaterial({ color: "#9a9894" });
  addGrain(m, 0.6, 0.05, 0.7);
  mats.push(m);
  const im = new THREE.InstancedMesh(geo, m, spots.length);
  spots.forEach((s, i) => im.setMatrixAt(i, s));
  group.add(im);
}

// ── Barriers ────────────────────────────────────────────────────────────────

function barriers(b: Builder, glow: Builder, road: Road, L: Look, biome: Biome) {
  const dim = L.night ? 0.5 : 1;
  const conc = new THREE.Color("#d9d6cf").multiplyScalar(dim), stripe = new THREE.Color(biome.accent).multiplyScalar(dim);
  const steel = new THREE.Color("#c3c8d0").multiplyScalar(dim), post = new THREE.Color("#6a6e76").multiplyScalar(dim);
  for (const st of road.strands) {
    const pts = st.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      if (a.flags & GAP) continue;
      for (const sd of [-1, 1]) {
        if (!(a.flags & (sd < 0 ? WL : WR))) continue;
        // Profile across the wall: offset outwards from the edge, height.
        const P = (p: Sample, o: number, h: number) => {
          const e = sd * p.hw;
          const q = side(p, e + sd * o);
          return [q[0], p.y + p.bank * e + h, q[2]];
        };
        const strip = (o0: number, h0: number, o1: number, h1: number, col: THREE.Color, g: Builder = b) => {
          const A0 = P(a, o0, h0), A1 = P(a, o1, h1), C0 = P(c, o0, h0), C1 = P(c, o1, h1);
          if (sd > 0) g.quad(A0, C0, C1, A1, col); else g.quad(A0, A1, C1, C0, col);
        };
        const band = Math.floor(a.s / 6) % 2 === 0;
        if (L.barrier === "jersey") {
          strip(0, -0.4, 0, 0.28, conc);
          strip(0, 0.28, 0.2, 0.62, conc);
          strip(0.2, 0.62, 0.3, WALL_H, band ? stripe : conc);
          strip(0.3, WALL_H, WALL_T, WALL_H, conc);
          strip(WALL_T, WALL_H, WALL_T, -0.6, conc);
        } else if (L.barrier === "armco") {
          strip(0.1, 0.55, 0.1, 0.95, steel);
          strip(0.1, 0.95, 0.3, 0.95, steel);
          strip(0.3, 0.95, 0.3, 0.55, steel);
          if (i % 2 === 0) {
            const q0 = P(a, 0.25, -0.5), q1 = P(a, 0.25, 0.9);
            const fx = a.dx * 0.08, fz = a.dz * 0.08, rx = -a.dz * 0.08 * sd, rz = a.dx * 0.08 * sd;
            const c0 = [q0[0] - fx - rx, q0[1], q0[2] - fz - rz], c1 = [q0[0] + fx - rx, q0[1], q0[2] + fz - rz];
            const t0 = [q1[0] - fx - rx, q1[1], q1[2] - fz - rz], t1 = [q1[0] + fx - rx, q1[1], q1[2] + fz - rz];
            b.quad2(c0, c1, t1, t0, post);
          }
        } else {
          strip(0, -0.4, 0, 0.5, post);
          strip(0, 0.5, 0.15, 0.5, post);
          strip(0.05, 0.55, 0.05, 0.75, stripe, glow);
          strip(0.05, 1.05, 0.05, 1.2, stripe, glow);
          strip(0.15, 0.5, 0.15, -0.6, post);
        }
      }
    }
  }
}

// ── Tunnels ─────────────────────────────────────────────────────────────────

function tunnels(b: Builder, glow: Builder, road: Road, L: Look) {
  const wall = new THREE.Color("#b8b2a8"), ceil = new THREE.Color("#5a5752"), lamp = new THREE.Color("#ffe9b8");
  const land = new THREE.Color(L.ground[2]);
  for (const st of road.strands) {
    const pts = st.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      if (!(a.flags & TUN)) continue;
      // Cross-section: up the left wall, over the arch, down the right.
      const arch: [number, number][] = [];
      const n = 8;
      for (let k = 0; k <= n; k++) {
        const t = k / n, ang = Math.PI * (1 - t);
        arch.push([Math.cos(ang), Math.sin(ang)]);
      }
      const P = (p: Sample, u: number, v: number, w = 1.0) => {
        const half = p.hw + 0.8;
        const lat = u * half * w;
        const q = side(p, lat);
        return [q[0], p.y + 5.2 * (v > 0 ? 1 : 0) + v * 3.2 + (v === 0 ? 0 : 0), q[2]];
      };
      // Walls.
      for (const sd of [-1, 1]) {
        const A0 = side(a, sd * (a.hw + 0.8), -0.2), A1 = side(a, sd * (a.hw + 0.8), 5.2), C0 = side(c, sd * (c.hw + 0.8), -0.2), C1 = side(c, sd * (c.hw + 0.8), 5.2);
        if (sd < 0) b.quad(A0, C0, C1, A1, wall); else b.quad(A0, A1, C1, C0, wall);
        // A strip of lights along each wall.
        const L0 = side(a, sd * (a.hw + 0.75), 4.6), L1 = side(a, sd * (a.hw + 0.75), 4.85), M0 = side(c, sd * (c.hw + 0.75), 4.6), M1 = side(c, sd * (c.hw + 0.75), 4.85);
        if (i % 3 !== 0) glow.quad2(L0, M0, M1, L1, lamp);
      }
      for (let k = 0; k < n; k++) {
        const [u0, v0] = arch[k], [u1, v1] = arch[k + 1];
        const A0 = P(a, u0, v0 + 0.0001), A1 = P(a, u1, v1 + 0.0001), C0 = P(c, u0, v0 + 0.0001), C1 = P(c, u1, v1 + 0.0001);
        b.quad(A0, A1, C1, C0, ceil);
      }
      // The ground over the tunnel (the trench is cut for the physics; this hides it).
      const top = (p: Sample, lat: number) => {
        const q = side(p, lat);
        const h = landAt(road.land, q[0], q[2]).h;
        return [q[0], Math.max(h, p.y + 9), q[2]];
      };
      const span = [-1.6, -1.15, -0.6, 0, 0.6, 1.15, 1.6];
      for (let k = 0; k < span.length - 1; k++) {
        const A0 = top(a, span[k] * a.hw), A1 = top(a, span[k + 1] * a.hw), C0 = top(c, span[k] * c.hw), C1 = top(c, span[k + 1] * c.hw);
        b.quad(A0, C0, C1, A1, land);
      }
      // Portals: a concrete frame where the tunnel begins and ends.
      const portal = (p: Sample, dir: number) => {
        const h = p.hw + 2.2;
        for (const [l0, l1, y0, y1] of [[-h, -p.hw - 0.8, 0, 9.5], [p.hw + 0.8, h, 0, 9.5], [-h, h, 8.4, 10.5]] as const) {
          const q = (lat: number, y: number, o: number) => { const r = side(p, lat); return [r[0] + p.dx * o * dir, p.y + y, r[2] + p.dz * o * dir]; };
          b.quad(q(l0, y0, 0), q(l1, y0, 0), q(l1, y1, 0), q(l0, y1, 0), wall);
          b.quad(q(l0, y0, 0), q(l0, y1, 0), q(l1, y1, 0), q(l1, y0, 0), wall);
        }
      };
      if (!(pts[i - 1]?.flags & TUN)) portal(a, -1);
      if (!(c.flags & TUN)) portal(c, 1);
    }
  }
}

// ── Gantries over the start, the checkpoints and the finish ─────────────────

function gantries(b: Builder, glow: Builder, road: Road, L: Look, biome: Biome) {
  const main = road.strands[0].pts;
  const near = (x: number, z: number) => main.reduce((bi, p, i) => ((p.x - x) ** 2 + (p.z - z) ** 2 < (main[bi].x - x) ** 2 + (main[bi].z - z) ** 2 ? i : bi), 0);
  const truss = new THREE.Color(L.night ? "#3a3d4a" : "#2b2e38");
  const acc = new THREE.Color(biome.accent);
  const one = (p: Sample, finish: boolean) => {
    const h = 9.5, w = p.hw + 1.6;
    const box = (l0: number, l1: number, y0: number, y1: number, d: number, col: THREE.Color, g = b) => {
      const q = (lat: number, y: number, o: number) => { const r = side(p, lat); return [r[0] + p.dx * o, p.y + y, r[2] + p.dz * o]; };
      g.quad(q(l0, y0, -d), q(l1, y0, -d), q(l1, y1, -d), q(l0, y1, -d), col);
      g.quad(q(l0, y0, d), q(l0, y1, d), q(l1, y1, d), q(l1, y0, d), col);
      g.quad(q(l0, y1, -d), q(l1, y1, -d), q(l1, y1, d), q(l0, y1, d), col);
      g.quad(q(l0, y0, -d), q(l0, y1, -d), q(l0, y1, d), q(l0, y0, d), col);
      g.quad(q(l1, y0, -d), q(l1, y0, d), q(l1, y1, d), q(l1, y1, -d), col);
    };
    box(-w - 0.6, -w + 0.2, -0.5, h + 1.4, 0.45, truss);
    box(w - 0.2, w + 0.6, -0.5, h + 1.4, 0.45, truss);
    box(-w, w, h, h + 1.6, 0.5, truss);
    if (finish) {
      // A chequered banner.
      const n = Math.round((2 * w) / 1.2);
      for (let k = 0; k < n; k++) {
        const l0 = -w + (2 * w * k) / n, l1 = -w + (2 * w * (k + 1)) / n;
        box(l0, l1, h + 0.2, h + 0.8, 0.55, k % 2 ? new THREE.Color("#111111") : new THREE.Color("#f4f4f4"));
        box(l0, l1, h + 0.8, h + 1.4, 0.55, k % 2 ? new THREE.Color("#f4f4f4") : new THREE.Color("#111111"));
      }
    } else box(-w + 0.4, w - 0.4, h + 0.55, h + 1.05, 0.56, acc, glow);
    box(-w - 0.5, -w + 0.1, 1, h, 0.5, acc, glow);
    box(w - 0.1, w + 0.5, 1, h, 0.5, acc, glow);
  };
  one(main[0], true);
  for (const g of road.gates) one(main[near(g.x, g.z)], false);
  one(main[near(road.finish.x, road.finish.z)], true);
}
