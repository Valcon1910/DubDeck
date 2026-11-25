// Drawing what stands around the roads:
//  • the solid props from the physics (towers, buttes, icebergs, dunes,
//    grandstands with a cheering crowd, parked cars, rocks, trees), and
//  • breakables: lamp posts, cones, fences, cacti, barrels, snowmen, crates.
//    These are only for show (not in the physics): a car knocks them flying
//    and they tumble, topple and settle where they land, until a restart.
// Every kind is one instanced mesh, so a whole map's props are a few draw calls.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CELL, CURVE_IN, CURVE_OUT, DIRV, groundAt, HALF_W, key, yawOf, type Track } from "../sim/track.ts";
import { NO_GROUND, terrainAt } from "../sim/terrain.ts";
import { propsOf, roadClear, type Solid, type SolidKind } from "../sim/props.ts";
import type { Biome, BiomeId } from "../maps.ts";
import { GAP, WALL_T, WL, WR, type Sample } from "../sim/road.ts";

type G = THREE.BufferGeometry;

/** Gives a primitive one vertex colour (and drops what we don't use). */
function paint(g: G, c: THREE.ColorRepresentation): G {
  g.deleteAttribute("uv");
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  const cc = new THREE.Color(c);
  for (let i = 0; i < n; i++) { col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}
function merge(...gs: G[]): G {
  const idx = gs.map((g) => (g.index ? g.toNonIndexed() : g));
  const m = mergeGeometries(idx)!;
  for (const g of gs) g.dispose();
  for (const g of idx) g.dispose();
  return m;
}
const at = (g: G, x: number, y: number, z: number) => g.translate(x, y, z);
const box = (w: number, h: number, d: number, c: string, x = 0, y = 0, z = 0) => at(paint(new THREE.BoxGeometry(w, h, d), c), x, y, z);
const cyl = (r0: number, r1: number, h: number, seg: number, c: string, x = 0, y = 0, z = 0) => at(paint(new THREE.CylinderGeometry(r0, r1, h, seg), c), x, y, z);
const cone = (r: number, h: number, seg: number, c: string, x = 0, y = 0, z = 0) => at(paint(new THREE.ConeGeometry(r, h, seg), c), x, y, z);
const ball = (r: number, c: string, x = 0, y = 0, z = 0, detail = 1) => at(paint(new THREE.IcosahedronGeometry(r, detail), c), x, y, z);

// ── Solid props ─────────────────────────────────────────────────────────────

function standGeo(accent: string): G {
  const parts: G[] = [];
  for (let i = 0; i < 5; i++) {
    const top = 0.6 + i * 0.95;
    parts.push(box(17, top, 1.25, i % 2 ? "#5d6072" : "#6b6e82", 0, top / 2, 3.2 - 0.62 - i * 1.25));
    parts.push(box(17, 0.1, 0.5, i % 2 ? "#c9ccd8" : "#aeb2c4", 0, top + 0.05, 3.2 - 0.4 - i * 1.25)); // seat row
  }
  parts.push(box(17.2, 7.6, 0.3, "#3a3d50", 0, 3.8, -3.15));
  parts.push(box(17.2, 0.5, 0.12, accent, 0, 0.35, 3.26)); // banner along the front
  parts.push(box(18, 0.25, 7.4, "#e6e8f0", 0, 7.85, -0.2));
  parts.push(box(18, 0.4, 0.15, accent, 0, 7.6, 3.5));
  for (const x of [-8.3, 0, 8.3]) parts.push(box(0.25, 7.8, 0.25, "#2c2e3c", x, 3.9, 3.3));
  return merge(...parts);
}

function parkedGeo(): G {
  const parts = [
    box(1.95, 0.62, 4.3, "#ffffff", 0, 0.62, 0),
    box(1.7, 0.55, 2.1, "#1b2232", 0, 1.2, -0.25),
    box(1.6, 0.06, 1.9, "#ffffff", 0, 1.5, -0.25),
    box(1.6, 0.12, 0.05, "#fff4d0", 0, 0.72, 2.16),
    box(1.6, 0.12, 0.05, "#c2182c", 0, 0.72, -2.16),
  ];
  for (const x of [-0.9, 0.9]) for (const z of [-1.35, 1.35]) {
    const w = paint(new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10), "#111216");
    w.rotateZ(Math.PI / 2); w.translate(x, 0.36, z);
    parts.push(w);
  }
  return merge(...parts);
}

function pineGeo(snow: boolean): G {
  const leaf = "#2c5a44";
  const parts = [
    cyl(0.22, 0.32, 2, 6, "#5b3d26", 0, 1, 0),
    cone(2.1, 3.4, 7, leaf, 0, 3.4, 0),
    cone(1.6, 2.9, 7, leaf, 0, 5.2, 0),
    cone(1.05, 2.4, 7, leaf, 0, 6.9, 0),
  ];
  if (snow) parts.push(cone(0.55, 1.0, 7, "#f4f9ff", 0, 7.75, 0), cone(1.3, 0.5, 7, "#f4f9ff", 0, 4.75, 0));
  return merge(...parts);
}

function palmGeo(): G {
  const parts: G[] = [];
  let x = 0, y = 0;
  for (let i = 0; i < 5; i++) {
    const s = paint(new THREE.CylinderGeometry(0.2 - i * 0.012, 0.27 - i * 0.012, 1.8, 6), i % 2 ? "#8a6a45" : "#9a7a52");
    s.rotateZ(-0.08 - i * 0.04);
    s.translate(x, y + 0.9, 0);
    parts.push(s);
    x += Math.sin(0.08 + i * 0.04) * 1.8; y += Math.cos(0.08 + i * 0.04) * 1.75;
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const f = paint(new THREE.ConeGeometry(0.45, 3.6, 3), i % 2 ? "#3f8f4a" : "#4ea457");
    f.scale(1, 1, 0.25);
    f.translate(0, 1.8, 0);
    f.rotateX(1.05 + (i % 3) * 0.12);
    f.rotateY(a);
    f.translate(x, y, 0);
    parts.push(f);
  }
  parts.push(ball(0.35, "#6b4a2a", x, y - 0.1, 0, 0));
  return merge(...parts);
}

function rockGeo(): G {
  const g = paint(new THREE.DodecahedronGeometry(1, 0), "#ffffff");
  g.translate(0, 0.35, 0);
  return g;
}

function butteGeo(): G {
  // Hex columns with darker bands of rock.
  const g = new THREE.CylinderGeometry(0.8, 1, 1, 6, 5);
  g.translate(0, 0.5, 0);
  g.deleteAttribute("uv");
  const pos = g.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const band = Math.floor(pos.getY(i) * 5 + 0.001) % 2 ? 0.86 : 1;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = band;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * Towers and hotels: windows drawn by the shader in each building's own
 * frame (no textures). At night some are lit; by day they are glass.
 */
function towerMaterial(day = false): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color: "#ffffff", vertexColors: true });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLp;\nvarying vec3 vWn;\nvarying vec2 vSeed;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vec3 hxS = vec3(1.0);
        vSeed = vec2(0.0);
        #ifdef USE_INSTANCING
          hxS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vSeed = floor(instanceMatrix[3].xz);
        #endif
        vLp = transformed * hxS;
        vWn = objectNormal;`);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLp;\nvarying vec3 vWn;\nvarying vec2 vSeed;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        if (abs(vWn.y) < 0.5) {
          float sx = abs(vWn.x) > 0.5 ? vLp.z : vLp.x;
          vec2 c = vec2(floor(sx / 2.4), floor(vLp.y / 3.2));
          vec2 f = vec2(fract(sx / 2.4), fract(vLp.y / 3.2));
          float inside = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.78) * step(2.0, vLp.y);
          float h = fract(sin(dot(c + sign(vWn.xz) * 17.0 + vSeed * 0.37, vec2(12.9898, 78.233))) * 43758.5453);
          ${day ? `
          // Glass: dark, a little blue, brighter near the top (it mirrors the sky).
          vec3 glass = mix(vec3(0.16, 0.22, 0.3), vec3(0.45, 0.6, 0.75), f.y * 0.4 + step(0.85, h) * 0.3);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, inside * 0.85);
          totalEmissiveRadiance += glass * inside * 0.18;` : `
          float lit = step(0.6, h) * inside;
          vec3 wc = h > 0.93 ? vec3(0.35, 0.95, 1.0) : h > 0.88 ? vec3(1.0, 0.35, 0.9) : vec3(1.0, 0.78, 0.45);
          totalEmissiveRadiance += wc * lit * 0.85;`}
        }`);
  };
  m.customProgramCacheKey = () => `tower${day}`;
  return m;
}

const PALETTE: Partial<Record<SolidKind, string[]>> = {
  tower: ["#2b2f5c", "#3a2d6e", "#1f3a5c", "#4a2a5e", "#242a48"],
  butte: ["#a4482a", "#c0643a", "#8e3b22", "#b5553a"],
  berg: ["#dff3ff", "#bfe6ff", "#a8dcff"],
  dune: ["#e3b866", "#d9ab57", "#efc77a"],
  parked: ["#d8dde8", "#1c1f28", "#b3202c", "#2d5fbf", "#f0b429", "#5f6878", "#f4f4f4"],
  rock: ["#8f8478", "#a39484", "#7d7268"],
  hotel: ["#ffd8e4", "#bdf0e6", "#fff1c9", "#f6f6f2", "#ffc9a8", "#c9e4ff"],
  chalet: ["#ffffff"],
  pylon: ["#ffffff"],
};

/** Pastel beach hotels: balconies in bands, a roof cap. Unit footprint, unit height. */
function hotelGeo(): G {
  const parts: G[] = [box(1, 1, 1, "#ffffff", 0, 0.5, 0)];
  for (let i = 1; i < 12; i++) parts.push(box(1.04, 0.012, 1.04, "#e9e4de", 0, i / 12, 0));
  parts.push(box(0.5, 0.04, 0.5, "#9aa0a8", 0, 1.02, 0));
  return merge(...parts);
}

function chaletGeo(): G {
  // A wooden chalet with a steep roof (a gable, like a long triangular prism).
  const roof = new THREE.CylinderGeometry(4.4, 4.4, 12.4, 3, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
  roof.scale(1.25, 0.55, 1).translate(0, 7.2, 0);
  return merge(
    box(8.6, 0.8, 10.6, "#7a7570", 0, 0.4, 0),
    box(8, 4.6, 10, "#8a5a36", 0, 3.1, 0),
    box(8.1, 0.25, 10.1, "#6a4428", 0, 1.6, 0),
    paint(roof, "#5a3424"),
    box(1.6, 0.9, 0.08, "#ffd98a", -2, 3.4, 5.02), box(1.6, 0.9, 0.08, "#ffd98a", 2, 3.4, 5.02),
    box(0.9, 1.0, 0.9, "#7a7570", 2.5, 9.6, 2),
  );
}

function pylonGeo(): G {
  return merge(cyl(0.25, 0.5, 6, 6, "#3a3e58", 0, 3, 0), cyl(0.7, 0.7, 0.3, 8, "#ff3df2", 0, 6, 0));
}

// ── Breakables ──────────────────────────────────────────────────────────────

type BreakKind = "lamp" | "cone" | "bin" | "fence" | "cactus" | "barrel" | "crate" | "snowman" | "sapling" | "lantern" | "chevron" | "tyres" | "hay" | "umbrella" | "hydrant" | "beacon";
interface KindDef { body: () => G; glow?: () => G; glowColor?: string; r: number; h: number; tall: boolean; chips: string; sound: "metal" | "wood" | "plastic" | "snow" }

const KINDS: Record<BreakKind, KindDef> = {
  lamp: {
    body: () => merge(cyl(0.08, 0.13, 6.2, 6, "#4a4d5c", 0, 3.1, 0), box(0.1, 0.1, 1.7, "#4a4d5c", 0, 6.15, 0.8), box(0.5, 0.14, 0.75, "#2a2c36", 0, 6.1, 1.55)),
    glow: () => paint(new THREE.BoxGeometry(0.42, 0.06, 0.65), "#ffffff").translate(0, 6.0, 1.55),
    glowColor: "#fff1c2", r: 0.25, h: 6.3, tall: true, chips: "#cfe8ff", sound: "metal",
  },
  lantern: {
    body: () => merge(cyl(0.06, 0.09, 2.4, 6, "#6b5a48", 0, 1.2, 0), box(0.5, 0.06, 0.5, "#6b5a48", 0, 2.45, 0)),
    glow: () => ball(0.26, "#ffffff", 0, 2.72, 0, 1),
    glowColor: "#ffd27a", r: 0.3, h: 3, tall: true, chips: "#ffd27a", sound: "wood",
  },
  cone: { body: () => merge(cone(0.3, 0.78, 10, "#ff6a1a", 0, 0.45, 0), cyl(0.21, 0.24, 0.12, 10, "#f4f4f4", 0, 0.45, 0), box(0.62, 0.06, 0.62, "#2a2a2e", 0, 0.03, 0)), r: 0.35, h: 0.85, tall: false, chips: "#ff6a1a", sound: "plastic" },
  bin: { body: () => merge(cyl(0.36, 0.3, 1.0, 9, "#3d6b55", 0, 0.5, 0), cyl(0.4, 0.4, 0.08, 9, "#2a4a3b", 0, 1.02, 0)), r: 0.4, h: 1.1, tall: false, chips: "#7fae8f", sound: "metal" },
  barrel: { body: () => merge(cyl(0.45, 0.45, 1.25, 10, "#ffffff", 0, 0.62, 0), cyl(0.47, 0.47, 0.07, 10, "#555555", 0, 0.32, 0), cyl(0.47, 0.47, 0.07, 10, "#555555", 0, 0.92, 0)), r: 0.5, h: 1.25, tall: false, chips: "#ffb04a", sound: "metal" },
  crate: { body: () => merge(box(1.1, 1.1, 1.1, "#a5794a", 0, 0.55, 0), box(1.14, 0.14, 1.14, "#7a5733", 0, 0.1, 0), box(1.14, 0.14, 1.14, "#7a5733", 0, 1.0, 0)), r: 0.65, h: 1.1, tall: false, chips: "#c79a62", sound: "wood" },
  fence: {
    body: () => merge(box(0.16, 1.15, 0.16, "#7a5733", 0, 0.58, -1.95), box(0.16, 1.15, 0.16, "#7a5733", 0, 0.58, 1.95), box(0.07, 0.14, 4.0, "#8f6a40", 0, 0.45, 0), box(0.07, 0.14, 4.0, "#8f6a40", 0, 0.92, 0)),
    r: 2.0, h: 1.15, tall: true, chips: "#b98a52", sound: "wood",
  },
  cactus: {
    body: () => merge(cyl(0.28, 0.34, 2.7, 7, "#3f8a4a", 0, 1.35, 0), cyl(0.17, 0.2, 0.9, 6, "#3f8a4a", 0.55, 1.55, 0), cyl(0.17, 0.2, 0.55, 6, "#3f8a4a", 0.35, 1.2, 0).rotateZ(1.2).translate(0.45, 0.65, 0), cyl(0.15, 0.18, 0.7, 6, "#4a9a55", -0.5, 1.9, 0), cyl(0.15, 0.18, 0.45, 6, "#4a9a55", -0.3, 1.55, 0).rotateZ(-1.2).translate(-0.45, 0.85, 0)),
    r: 0.45, h: 2.7, tall: true, chips: "#6fbf6a", sound: "wood",
  },
  snowman: {
    body: () => merge(ball(0.6, "#f6fbff", 0, 0.55, 0), ball(0.44, "#f6fbff", 0, 1.38, 0), ball(0.3, "#f6fbff", 0, 2.0, 0), cone(0.07, 0.4, 6, "#ff7a1a", 0, 2.0, 0.42).rotateX(0), cyl(0.24, 0.24, 0.32, 8, "#1a1a22", 0, 2.42, 0), cyl(0.36, 0.36, 0.05, 8, "#1a1a22", 0, 2.27, 0), cyl(0.34, 0.36, 0.14, 9, "#d8283c", 0, 1.74, 0), box(0.16, 0.5, 0.06, "#d8283c", 0.18, 1.5, 0.36), ball(0.05, "#1a1a22", 0, 1.45, 0.43, 0), ball(0.05, "#1a1a22", 0, 1.25, 0.43, 0)),
    r: 0.6, h: 2.6, tall: false, chips: "#ffffff", sound: "snow",
  },
  chevron: {
    // A bend sign: a board of arrows on two legs, facing the oncoming cars.
    body: () => merge(box(0.08, 1.2, 0.08, "#5a5d66", -0.55, 0.6, 0), box(0.08, 1.2, 0.08, "#5a5d66", 0.55, 0.6, 0), box(1.5, 0.8, 0.06, "#1a1a22", 0, 1.55, 0)),
    glow: () => merge(...[-0.45, 0, 0.45].map((x) => paint(new THREE.ConeGeometry(0.2, 0.34, 3).rotateZ(-Math.PI / 2).scale(1, 1, 0.1), "#ffffff").translate(x, 1.55, 0.05))),
    glowColor: "#ffcf2a", r: 0.8, h: 2, tall: true, chips: "#ffcf2a", sound: "metal",
  },
  tyres: { body: () => merge(...[0, 1, 2].map((i) => cyl(0.42, 0.42, 0.3, 12, i % 2 ? "#1c1c20" : "#26262b", 0, 0.16 + i * 0.3, 0)), cyl(0.2, 0.2, 0.95, 8, "#0c0c0e", 0, 0.47, 0)), r: 0.45, h: 0.92, tall: false, chips: "#3a3a40", sound: "plastic" },
  hay: { body: () => merge(cyl(0.6, 0.6, 1.3, 12, "#d9b558", 0, 0.6, 0).rotateZ(Math.PI / 2).translate(0, 0.6, 0), cyl(0.62, 0.62, 0.06, 12, "#b8923c", 0, 0, 0).rotateZ(Math.PI / 2).translate(0.35, 0.6, 0), cyl(0.62, 0.62, 0.06, 12, "#b8923c", 0, 0, 0).rotateZ(Math.PI / 2).translate(-0.35, 0.6, 0)), r: 0.7, h: 1.2, tall: false, chips: "#e6c46a", sound: "wood" },
  umbrella: {
    body: () => merge(cyl(0.04, 0.04, 2.3, 5, "#f4f4f4", 0, 1.15, 0), cone(1.5, 0.55, 8, "#ffffff", 0, 2.35, 0), box(0.5, 0.42, 1.6, "#3dd6ff", 0.9, 0.21, 0)),
    r: 0.5, h: 2.6, tall: true, chips: "#ff6aa8", sound: "plastic",
  },
  hydrant: { body: () => merge(cyl(0.16, 0.2, 0.7, 8, "#d42a2a", 0, 0.35, 0), ball(0.17, "#d42a2a", 0, 0.72, 0, 1), cyl(0.07, 0.07, 0.42, 6, "#b01f1f", 0, 0.45, 0).rotateZ(Math.PI / 2).translate(0, 0.0, 0)), r: 0.28, h: 0.9, tall: false, chips: "#ff5a3a", sound: "metal" },
  beacon: {
    body: () => merge(cyl(0.12, 0.32, 1.3, 6, "#3a3e58", 0, 0.65, 0)),
    glow: () => ball(0.2, "#ffffff", 0, 1.45, 0, 1),
    glowColor: "#7cf7ff", r: 0.35, h: 1.6, tall: true, chips: "#7cf7ff", sound: "metal",
  },
  sapling: { body: () => merge(cyl(0.08, 0.12, 0.8, 5, "#5b3d26", 0, 0.4, 0), cone(0.8, 1.4, 6, "#2f6a4d", 0, 1.3, 0), cone(0.55, 1.1, 6, "#2f6a4d", 0, 2.0, 0), cone(0.3, 0.5, 6, "#f4f9ff", 0, 2.55, 0)), r: 0.45, h: 2.8, tall: true, chips: "#9fd0b4", sound: "wood" },
};

const THEME_BREAKS: Record<BiomeId, { edge?: BreakKind; fence: boolean; bits: BreakKind[]; curve?: BreakKind; sign?: BreakKind; block?: BreakKind[] }> = {
  city: { edge: "lamp", fence: false, bits: ["bin", "cone"], curve: "cone" },
  canyon: { fence: true, bits: ["cactus", "barrel", "crate"] },
  glacier: { fence: true, bits: ["snowman", "sapling", "sapling", "crate"] },
  desert: { fence: true, bits: ["cactus", "barrel", "cactus"], curve: "cone" },
  sky: { edge: "lantern", fence: false, bits: ["crate"], curve: "lantern", block: ["crate", "barrel"] },
  miami: { edge: "lamp", fence: false, bits: ["bin", "umbrella", "hydrant", "cone"], curve: "tyres", sign: "chevron", block: ["crate", "barrel", "cone", "umbrella"] },
  storm: { edge: "lamp", fence: false, bits: ["bin", "hydrant", "cone", "barrel"], curve: "cone", sign: "chevron", block: ["bin", "barrel", "crate", "cone"] },
  alpine: { fence: true, bits: ["snowman", "sapling", "crate", "hay"], curve: "tyres", sign: "chevron", block: ["hay", "crate", "snowman"] },
  space: { edge: "beacon", fence: false, bits: ["crate", "barrel"], curve: "beacon", block: ["crate", "barrel"] },
  baja: { fence: true, bits: ["cactus", "barrel", "crate", "tyres"], curve: "tyres", sign: "chevron", block: ["hay", "barrel", "crate", "tyres"] },
};

interface Bit {
  kind: number; i: number;
  x: number; y: number; z: number; yaw: number;
  /** Has been hit (moving or lying where it landed). */
  hit: boolean; rest: boolean;
  vx: number; vy: number; vz: number;
  // Toppling (tall things fall over about their base) or tumbling (small things).
  ax: number; az: number; ang: number; angV: number;
  q: THREE.Quaternion; w: THREE.Vector3;
  age: number;
}

export interface Smash { x: number; y: number; z: number; color: string; sound: KindDef["sound"]; hard: number }

/** The breakables of one map: knocked over by the car, reset on restart. */
export class Breakables {
  private bits: Bit[] = [];
  private cells = new Map<number, Bit[]>();
  private meshes: { body: THREE.InstancedMesh; glow?: THREE.InstancedMesh; def: KindDef }[] = [];
  private moving: Bit[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private dimmed = new THREE.Color("#3a3a40");

  constructor(private track: Track, group: THREE.Group, theme: BiomeId, geos: G[], mats: THREE.Material[]) {
    const plan = THEME_BREAKS[theme];
    const spots: { k: BreakKind; x: number; z: number; yaw: number; y?: number }[] = [];
    const solids = propsOf(track);
    const free = (x: number, z: number, r: number) => {
      if (!roadClear(track, x, z, r + 0.3)) return false;
      const list = solids.cells.get(key(Math.round(x / CELL), Math.round(z / CELL)));
      if (list) for (const s of list) {
        const dx = Math.abs(x - s.x) - s.a, dz = Math.abs(z - s.z) - s.b;
        if (dx < r + 0.6 && dz < r + 0.6) return false;
      }
      for (const o of spots) if ((o.x - x) ** 2 + (o.z - z) ** 2 < (r + KINDS[o.k].r + 0.4) ** 2) return false;
      return true;
    };
    const spaced = (x: number, z: number, r: number) => {
      for (const o of spots) if ((o.x - x) ** 2 + (o.z - z) ** 2 < (r + KINDS[o.k].r + 0.3) ** 2) return false;
      return true;
    };
    const R = (i: number, s: number, salt: number) => {
      let h = Math.imul(i + 1, 374761393) ^ Math.imul(s + 7, 668265263) ^ Math.imul(salt, 1442695041);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const put = (k: BreakKind, x: number, z: number, yaw: number) => { if (free(x, z, KINDS[k].r)) spots.push({ k, x, z, yaw }); };

    if (track.road) this.roadSpots(track, plan, put, (k, x, y, z, yaw, stack) => { if (stack || spaced(x, z, KINDS[k].r)) spots.push({ k, x, z, yaw, y }); }, R);
    track.pieces.forEach((p, i) => {
      const [fx, fz] = DIRV[p.d];
      const [rx, rz] = DIRV[(p.d + 1) % 4];
      const cx = p.x * CELL, cz = p.z * CELL;
      const curve = p.t === "curveL" || p.t === "curveR";
      const P = (u: number, w: number) => [cx + rx * u + fx * w, cz + rz * u + fz * w] as const;
      if (curve) {
        const sgn = p.t === "curveR" ? 1 : -1;
        const ccu = sgn * (CELL / 2), ccw = -CELL / 2;
        if (plan.curve && !p.wall) {
          // Cones round the outside of the bend.
          for (let j = 1; j < 5; j++) {
            const a = (j / 5) * (Math.PI / 2), rr = CURVE_OUT + 1.3;
            const [x, z] = P(ccu - sgn * Math.cos(a) * rr, ccw + Math.sin(a) * rr);
            put(plan.curve, x, z, R(i, j, 3) * 6);
          }
          // And one on the apex inside.
          const [x, z] = P(ccu - sgn * 0.7071 * (CURVE_IN - 1.4), ccw + 0.7071 * (CURVE_IN - 1.4));
          put(plan.curve, x, z, 0);
        }
        return;
      }
      if (p.t === "start" || p.t === "finish") return;
      if (plan.edge) {
        // Lamps (or lanterns) on alternating sides, facing the road.
        const s = i % 2 ? 1 : -1;
        const [x, z] = P(s * (HALF_W + (p.wall ? 1.9 : 1.6)), 0);
        put(plan.edge, x, z, yawOf(((p.d + (s > 0 ? 3 : 1)) % 4) as 0));
      }
      if (plan.fence && !p.wall && R(i, 0, 5) < 0.45) {
        const s = R(i, 0, 6) < 0.5 ? -1 : 1;
        for (let j = 0; j < 4; j++) {
          const [x, z] = P(s * (HALF_W + 2.3), -6.3 + j * 4.2);
          put("fence", x, z, yawOf(p.d));
        }
      }
      for (const s of [-1, 1]) {
        if (R(i, s, 7) > 0.38) continue;
        const k = plan.bits[Math.floor(R(i, s, 8) * plan.bits.length)];
        const [x, z] = P(s * (HALF_W + 1.4 + R(i, s, 9) * 5), (R(i, s, 10) - 0.5) * 14);
        put(k, x, z, R(i, s, 11) * 6.28);
        // City bins and cones come in small groups.
        if (k === "cone" || k === "barrel") {
          const [x2, z2] = P(s * (HALF_W + 1.6 + R(i, s, 12) * 4), (R(i, s, 13) - 0.5) * 14);
          put(k, x2, z2, R(i, s, 14) * 6.28);
        }
      }
    });

    // One instanced mesh per kind.
    const kinds = [...new Set(spots.map((s) => s.k))];
    const lambert = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    mats.push(lambert);
    kinds.forEach((k, ki) => {
      const def = KINDS[k];
      const list = spots.filter((s) => s.k === k);
      const bg = def.body(); geos.push(bg);
      const body = new THREE.InstancedMesh(bg, lambert, list.length);
      body.frustumCulled = false;
      let glow: THREE.InstancedMesh | undefined;
      if (def.glow) {
        const gg = def.glow(); geos.push(gg);
        const gm = new THREE.MeshBasicMaterial({ color: "#ffffff" }); mats.push(gm);
        glow = new THREE.InstancedMesh(gg, gm, list.length);
        glow.frustumCulled = false;
      }
      const barrels = ["#c2412b", "#2d6fbf", "#e0a326", "#4f8a3a"];
      const c = new THREE.Color();
      // Hidden until placed (a spot with no ground under it stays hidden).
      const none = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < list.length; i++) { body.setMatrixAt(i, none); glow?.setMatrixAt(i, none); }
      list.forEach((s, i) => {
        const t = terrainAt(track, s.x, s.z).h;
        const road = groundAt(track, s.x, t + 3, s.z, 3);
        const y = s.y ?? (road && road.h > t ? road.h : t);
        if (y <= NO_GROUND) return;
        const bit: Bit = { kind: ki, i, x: s.x, y, z: s.z, yaw: s.yaw, hit: false, rest: true, vx: 0, vy: 0, vz: 0, ax: 1, az: 0, ang: 0, angV: 0, q: new THREE.Quaternion(), w: new THREE.Vector3(), age: 0 };
        this.bits.push(bit);
        if (k === "barrel") body.setColorAt(i, c.set(barrels[i % barrels.length]));
        else body.setColorAt(i, c.set("#ffffff"));
        if (glow) glow.setColorAt(i, c.set(def.glowColor ?? "#ffffff"));
        // Listed in every cell it could be touched from.
        const pad = def.r + 1.5;
        for (let gx = Math.round((s.x - pad) / CELL); gx <= Math.round((s.x + pad) / CELL); gx++) {
          for (let gz = Math.round((s.z - pad) / CELL); gz <= Math.round((s.z + pad) / CELL); gz++) {
            const kk = key(gx, gz);
            const l = this.cells.get(kk);
            if (l) l.push(bit); else this.cells.set(kk, [bit]);
          }
        }
      });
      group.add(body);
      if (glow) group.add(glow);
      this.meshes[ki] = { body, glow, def };
    });
    for (const b of this.bits) this.place(b);
    for (const mm of this.meshes) {
      mm.body.instanceMatrix.needsUpdate = true;
      if (mm.glow) mm.glow.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Breakables of a road map, along every strand: lamps down the edges, bend
   * signs and tyre stacks round the outside of corners, fences, odds and ends,
   * and on the shortcuts a mess of crates and barrels to smash through.
   */
  private roadSpots(track: Track, plan: (typeof THEME_BREAKS)[BiomeId], put: (k: BreakKind, x: number, z: number, yaw: number) => void,
    onRoad: (k: BreakKind, x: number, y: number, z: number, yaw: number, stack?: boolean) => void, R: (i: number, s: number, salt: number) => number) {
    const road = track.road!;
    const yawOf2 = (dx: number, dz: number) => Math.atan2(dx, dz);
    road.strands.forEach((st, si) => {
      const pts = st.pts;
      const at = (p: Sample, lat: number, along = 0): [number, number] => [p.x - p.dz * lat + p.dx * along, p.z + p.dx * lat + p.dz * along];
      const curv = (i: number) => {
        const a = pts[Math.max(0, i - 3)], b = pts[Math.min(pts.length - 1, i + 3)];
        return (a.dx * b.dz - a.dz * b.dx) / ((b.s - a.s) || 1);
      };
      for (let i = 2; i < pts.length - 2; i++) {
        const p = pts[i];
        if (p.flags & GAP) continue;
        const salt = si * 7919 + i;
        const k = curv(i);
        const edgeOf = (sd: number) => p.hw + ((p.flags & (sd < 0 ? WL : WR)) ? WALL_T + 0.9 : 1.5);
        // Lamps every 30 m, alternating sides.
        if (plan.edge && i % 12 === 0) {
          const sd = (i / 12) % 2 ? 1 : -1;
          const [x, z] = at(p, sd * edgeOf(sd));
          // Lamp heads reach out over the road.
          put(plan.edge, x, z, yawOf2(p.dz * sd, -p.dx * sd));
        }
        // Bends: the outside is to the right of a left bend (k > 0).
        if (Math.abs(k) > 0.012 && i % 4 === 0) {
          const sd = k > 0 ? 1 : -1;
          if (!(p.flags & (sd < 0 ? WL : WR))) {
            const o = p.hw + 1.8;
            const [x, z] = at(p, sd * o);
            if (plan.sign && i % 8 === 0) put(plan.sign, x, z, yawOf2(-p.dx, -p.dz));
            else if (plan.curve) {
              put(plan.curve, x, z, R(salt, 0, 3) * 6);
              const [x2, z2] = at(p, sd * (o + 1.0), 0.6);
              put(plan.curve, x2, z2, R(salt, 0, 4) * 6);
            }
          }
        }
        // Fences along open stretches.
        if (plan.fence && i % 2 === 0 && Math.abs(k) < 0.01) {
          for (const sd of [-1, 1]) {
            if (p.flags & (sd < 0 ? WL : WR)) continue;
            if (R(Math.floor(i / 24), sd + si * 3, 5) > 0.35) continue;
            const [x, z] = at(p, sd * (p.hw + 3.2));
            put("fence", x, z, yawOf2(p.dx, p.dz));
          }
        }
        // Odds and ends.
        if (i % 3 === 0) for (const sd of [-1, 1]) {
          if (R(salt, sd, 7) > 0.2) continue;
          const kk = plan.bits[Math.floor(R(salt, sd, 8) * plan.bits.length)];
          const [x, z] = at(p, sd * (edgeOf(sd) + 0.5 + R(salt, sd, 9) * 5), (R(salt, sd, 10) - 0.5) * 6);
          put(kk, x, z, R(salt, sd, 11) * 6.28);
        }
        // Shortcuts: stuff lying about on the road itself.
        if (st.alt && plan.block && i > 6 && i < pts.length - 6 && R(salt, 0, 12) < 0.35) {
          const kk = plan.block[Math.floor(R(salt, 0, 13) * plan.block.length)];
          const lat = (R(salt, 0, 14) * 2 - 1) * (p.hw - 0.8);
          const [x, z] = at(p, lat);
          // Only where the shortcut has left the main road.
          let clear = true;
          for (const o of road.strands) {
            if (o === st) continue;
            for (const q of o.pts) if ((q.x - x) ** 2 + (q.z - z) ** 2 < (q.hw + 1.5) ** 2) { clear = false; break; }
            if (!clear) break;
          }
          if (!clear) continue;
          onRoad(kk, x, p.y + p.bank * lat, z, R(salt, 0, 15) * 6.28);
          if (kk === "crate" && R(salt, 0, 16) < 0.4) onRoad("crate", x, p.y + p.bank * lat + 1.1, z, R(salt, 0, 17) * 6.28, true);
        }
      }
    });
  }

  private place(b: Bit) {
    const mm = this.meshes[b.kind];
    this.q.setFromAxisAngle(this.up, b.yaw);
    if (b.hit) {
      if (mm.def.tall) this.q.premultiply(this.q2.setFromAxisAngle(this.v.set(b.ax, 0, b.az), b.ang));
      else this.q.premultiply(b.q);
    }
    this.m.compose(this.v.set(b.x, b.y, b.z), this.q, this.one);
    mm.body.setMatrixAt(b.i, this.m);
    mm.glow?.setMatrixAt(b.i, this.m);
  }

  /**
   * Knocks over whatever the car (at x, y, z moving at vx, vz) drives into.
   * Returns what broke, for particles and sounds.
   */
  hit(x: number, y: number, z: number, vx: number, vz: number, out: Smash[]) {
    const list = this.cells.get(key(Math.round(x / CELL), Math.round(z / CELL)));
    if (!list) return;
    const sp = Math.sqrt(vx * vx + vz * vz);
    for (const b of list) {
      if (b.hit) continue;
      const def = this.meshes[b.kind].def;
      if (y > b.y + def.h || y + 1.4 < b.y) continue;
      let dx = b.x - x, dz = b.z - z;
      let reach = def.r + 1.15;
      if (def.r > 1.5) {
        // Fence sections are long and thin: test against the segment.
        const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
        const along = Math.max(-def.r, Math.min(def.r, -(dx * fx + dz * fz)));
        dx += fx * along; dz += fz * along;
        reach = 0.2 + 1.15;
      }
      const d2 = dx * dx + dz * dz;
      if (d2 > reach * reach) continue;
      const d = Math.sqrt(d2) || 1;
      b.hit = true; b.rest = false; b.age = 0;
      const k = Math.min(1, sp / 40);
      const ox = dx / d, oz = dz / d;
      b.vx = vx * (0.55 + 0.3 * Math.random()) + ox * (2 + 4 * k);
      b.vz = vz * (0.55 + 0.3 * Math.random()) + oz * (2 + 4 * k);
      b.vy = def.tall ? 0 : 2 + sp * (0.12 + 0.1 * Math.random());
      // Tall things fall away from the car, small ones spin.
      const hx = b.vx, hz = b.vz, hl = Math.sqrt(hx * hx + hz * hz) || 1;
      b.ax = hz / hl; b.az = -hx / hl;
      b.ang = 0; b.angV = 1.5 + sp * 0.12;
      b.w.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14).multiplyScalar(0.3 + k);
      b.q.identity();
      if (def.glow) this.meshes[b.kind].glow!.setColorAt(b.i, this.dimmed);
      if (this.meshes[b.kind].glow?.instanceColor) this.meshes[b.kind].glow!.instanceColor!.needsUpdate = true;
      this.moving.push(b);
      out.push({ x: b.x, y: b.y + Math.min(def.h, 1.5) * 0.6, z: b.z, color: def.chips, sound: def.sound, hard: k });
    }
  }

  private floor(x: number, y: number, z: number) {
    const t = terrainAt(this.track, x, z).h;
    const road = groundAt(this.track, x, y + 1.5, z, 2);
    const g = road && road.h > t ? road.h : t;
    return g <= NO_GROUND ? this.track.minY - 40 : g;
  }

  update(dt: number) {
    if (!this.moving.length) return;
    const touched = new Set<number>();
    for (let n = this.moving.length - 1; n >= 0; n--) {
      const b = this.moving[n];
      const def = this.meshes[b.kind].def;
      b.age += dt;
      if (def.tall) {
        // Falls over about its base, which slides along.
        b.angV += (4 + 10 * Math.sin(b.ang)) * dt;
        b.ang += b.angV * dt;
        if (b.ang > Math.PI / 2 - 0.04) { b.ang = Math.PI / 2 - 0.04; b.angV *= -0.25; if (Math.abs(b.angV) < 0.4) b.angV = 0; }
        const f = Math.exp(-dt * 2.5);
        b.vx *= f; b.vz *= f;
        b.x += b.vx * dt; b.z += b.vz * dt;
        b.y = this.floor(b.x, b.y, b.z);
        if (b.angV === 0 && b.vx * b.vx + b.vz * b.vz < 0.2) b.rest = true;
      } else {
        b.vy -= 26 * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        const wl = b.w.length();
        if (wl > 1e-3) b.q.premultiply(this.q2.setFromAxisAngle(this.v.copy(b.w).divideScalar(wl), wl * dt));
        const g = this.floor(b.x, b.y, b.z);
        if (b.y < g) {
          b.y = g;
          b.vy = Math.abs(b.vy) > 2 ? -b.vy * 0.32 : 0;
          b.vx *= 0.7; b.vz *= 0.7; b.w.multiplyScalar(0.6);
          if (b.vy === 0 && b.vx * b.vx + b.vz * b.vz < 0.3) b.rest = true;
        }
        if (b.y < this.track.minY - 39) b.rest = true;
      }
      if (b.age > 8) b.rest = true;
      this.place(b);
      touched.add(b.kind);
      if (b.rest) this.moving.splice(n, 1);
    }
    for (const k of touched) {
      this.meshes[k].body.instanceMatrix.needsUpdate = true;
      if (this.meshes[k].glow) this.meshes[k].glow!.instanceMatrix.needsUpdate = true;
    }
  }

  /** Everything back where it stood. */
  reset() {
    const c = new THREE.Color();
    for (const b of this.bits) {
      if (!b.hit) continue;
      b.hit = false; b.rest = true; b.ang = 0; b.q.identity();
      this.place(b);
      const mm = this.meshes[b.kind];
      if (mm.glow) { mm.glow.setColorAt(b.i, c.set(mm.def.glowColor ?? "#ffffff")); mm.glow.instanceColor!.needsUpdate = true; }
    }
    this.moving.length = 0;
    for (const mm of this.meshes) {
      mm.body.instanceMatrix.needsUpdate = true;
      if (mm.glow) mm.glow.instanceMatrix.needsUpdate = true;
    }
  }
}

// ── Building it all ─────────────────────────────────────────────────────────

export interface PropsView {
  breakables: Breakables;
  /** Advances the crowd (cheer 0..1: how wildly they jump). */
  update(dt: number, cheer: number): void;
}

/** Adds every prop of the track to group. */
export function buildProps(group: THREE.Group, track: Track, biome: Biome, id: BiomeId, geos: G[], mats: THREE.Material[]): PropsView {
  const solids = propsOf(track).list;
  const byKind = new Map<SolidKind, Solid[]>();
  for (const s of solids) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
  const flat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mats.push(flat);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s3 = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  for (const [kind, list] of byKind) {
    let geo: G;
    let mat: THREE.Material = flat;
    switch (kind) {
      case "tower": geo = paint(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), "#ffffff"); mat = towerMaterial(); mats.push(mat); break;
      case "butte": geo = butteGeo(); break;
      case "berg": geo = paint(new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0), "#ffffff"); break;
      case "dune": geo = paint(new THREE.SphereGeometry(1, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2), "#ffffff"); break;
      case "stand": geo = standGeo(biome.accent); break;
      case "parked": geo = parkedGeo(); break;
      case "rock": geo = rockGeo(); break;
      case "pine": geo = pineGeo(id === "glacier" || id === "alpine"); break;
      case "hotel": geo = hotelGeo(); mat = towerMaterial(id !== "storm" && id !== "city"); mats.push(mat); break;
      case "chalet": geo = chaletGeo(); break;
      case "pylon": geo = pylonGeo(); break;
      default: geo = palmGeo(); break;
    }
    geos.push(geo);
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const pal = PALETTE[kind];
    list.forEach((sd, i) => {
      const h = sd.top - sd.y;
      const turned = sd.fx !== undefined && sd.fz !== undefined ? Math.atan2(sd.fx, sd.fz) : null;
      q.setFromAxisAngle(up, turned !== null ? turned : kind === "stand" || kind === "parked" ? yawOf(sd.d as 0) : kind === "tower" || kind === "dune" ? 0 : sd.v * Math.PI * 2);
      if (kind === "tower" || kind === "hotel") s3.set(sd.a * 2, h, sd.b * 2);
      else if (kind === "butte") s3.set(sd.a / 0.92, h, sd.b / 0.92);
      else if (kind === "berg") s3.set(sd.a / 0.85, h, sd.b / 0.85);
      else if (kind === "dune") s3.set(sd.a, h, sd.b);
      else if (kind === "rock") s3.set(sd.a, (h - 0.5) * 0.85, sd.b);
      else if (kind === "pine" || kind === "palm") s3.setScalar(h / 9);
      else s3.set(1, 1, 1);
      v.set(sd.x, sd.y + (kind === "stand" || kind === "parked" ? 0.4 : 0), sd.z);
      m.compose(v, q, s3);
      im.setMatrixAt(i, m);
      im.setColorAt(i, c.set(pal ? pal[Math.floor(sd.v * pal.length) % pal.length] : "#ffffff"));
    });
    group.add(im);
  }

  // The crowd in the grandstands: little people bobbing (faster when cheering).
  const stands = byKind.get("stand") ?? [];
  const time = { value: 0 }, cheer = { value: 0 };
  if (stands.length) {
    const person = merge(box(0.5, 0.75, 0.32, "#ffffff", 0, 0.38, 0), ball(0.17, "#ffffff", 0, 0.92, 0, 0));
    geos.push(person);
    const cm = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    cm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time; sh.uniforms.uCheer = cheer;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uCheer;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          float ph = float(gl_InstanceID) * 1.37;
          float rate = 4.0 + mod(ph, 3.0) + uCheer * 5.0;
          transformed.y += max(0.0, sin(uTime * rate + ph)) * (0.08 + uCheer * 0.55);`);
    };
    mats.push(cm);
    const shirts = ["#ff3d6e", "#ffd23d", "#3dd6ff", "#7cff5a", "#b06bff", "#f4f4f4", "#ff8a3d", "#2d5fbf", biome.accent];
    const people: THREE.Matrix4[] = [];
    const cols: string[] = [];
    let seed = 7;
    const rnd = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
    for (const sd of stands) {
      const yaw = sd.fx !== undefined && sd.fz !== undefined ? Math.atan2(sd.fx, sd.fz) : yawOf(sd.d as 0);
      const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      for (let tier = 0; tier < 5; tier++) {
        const top = 0.6 + tier * 0.95, lz = 3.2 - 0.75 - tier * 1.25;
        for (let lx = -8; lx <= 8; lx += 1.05) {
          if (rnd() < 0.25) continue;
          const px = lx + (rnd() - 0.5) * 0.3;
          q.setFromAxisAngle(up, yaw + (rnd() - 0.5) * 0.6);
          m.compose(v.set(sd.x + rx * px + fx * lz, sd.y + 0.4 + top, sd.z + rz * px + fz * lz), q, s3.setScalar(0.9 + rnd() * 0.25));
          people.push(m.clone());
          cols.push(shirts[Math.floor(rnd() * shirts.length)]);
        }
      }
    }
    const crowd = new THREE.InstancedMesh(person, cm, people.length);
    people.forEach((mm, i) => { crowd.setMatrixAt(i, mm); crowd.setColorAt(i, c.set(cols[i])); });
    crowd.frustumCulled = false;
    group.add(crowd);
  }

  const breakables = new Breakables(track, group, id, geos, mats);
  return {
    breakables,
    update(dt, ch) {
      time.value += dt;
      cheer.value += (ch - cheer.value) * Math.min(1, dt * 3);
    },
  };
}
