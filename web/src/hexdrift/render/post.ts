// The look of a frame: sun shadows that follow the car, then the scene drawn
// into an HDR buffer and finished in a few small passes: god rays from the
// sun (worked out from the depth buffer at quarter size), bloom (a short
// chain of tiny blurs), haze toward the sun, a soft highlight roll-off, a
// colour grade per map, a vignette and fine grain. Three quality levels;
// even "low" stays a handful of cheap passes so phones keep their frame rate.
import * as THREE from "three";
import type { Look } from "./roadworld.ts";

export type Gfx = "low" | "medium" | "high";
export const GFX: Gfx[] = ["low", "medium", "high"];

// Shadows fade out toward the edge of the shadowed area instead of stopping at a line.
THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replaceAll(
  "return mix( 1.0, shadow, shadowIntensity );",
  `vec2 shadowEdge = abs( shadowCoord.xy * 2.0 - 1.0 );
			return mix( 1.0, shadow, shadowIntensity * ( 1.0 - smoothstep( 0.72, 0.98, max( shadowEdge.x, shadowEdge.y ) ) ) );`,
);

/** How a map's frames are finished. */
export interface Grade {
  exposure: number; saturation: number; contrast: number;
  gain: [number, number, number]; lift: [number, number, number];
  bloom: number; threshold: number; rays: number; haze: number; vignette: number;
}

const GRADES: Record<string, Grade> = {
  miami: { exposure: 1.0, saturation: 1.12, contrast: 1.07, gain: [1.05, 1.0, 0.95], lift: [0.02, 0.0, 0.035], bloom: 0.5, threshold: 1.0, rays: 0.85, haze: 0.5, vignette: 0.3 },
  storm: { exposure: 1.12, saturation: 0.92, contrast: 1.1, gain: [0.93, 1.0, 1.1], lift: [0.0, 0.01, 0.03], bloom: 0.9, threshold: 0.65, rays: 0.0, haze: 0.1, vignette: 0.38 },
  alpine: { exposure: 1.0, saturation: 1.06, contrast: 1.05, gain: [1.0, 1.0, 1.02], lift: [0.0, 0.005, 0.02], bloom: 0.4, threshold: 1.05, rays: 0.6, haze: 0.35, vignette: 0.25 },
  space: { exposure: 1.05, saturation: 1.1, contrast: 1.12, gain: [1.0, 0.97, 1.06], lift: [0.01, 0.0, 0.03], bloom: 1.0, threshold: 0.75, rays: 0.35, haze: 0.15, vignette: 0.4 },
  baja: { exposure: 1.0, saturation: 1.08, contrast: 1.06, gain: [1.06, 1.0, 0.92], lift: [0.02, 0.01, 0.0], bloom: 0.45, threshold: 1.0, rays: 0.7, haze: 0.5, vignette: 0.28 },
  sky: { exposure: 1.02, saturation: 1.08, contrast: 1.03, gain: [1.02, 1.0, 1.0], lift: [0.01, 0.01, 0.03], bloom: 0.6, threshold: 0.95, rays: 0.9, haze: 0.45, vignette: 0.22 },
};
/** The older tile maps: a light touch, so they keep their look. */
const TILE: Grade = { exposure: 1.0, saturation: 1.06, contrast: 1.04, gain: [1, 1, 1], lift: [0, 0, 0.01], bloom: 0.45, threshold: 1.0, rays: 0.4, haze: 0.25, vignette: 0.25 };

export function gradeFor(id: string, look?: Look): Grade {
  return look ? GRADES[id] ?? TILE : TILE;
}

/**
 * What each level does. The biggest cost on phones is the number of pixels, so
 * each level also caps the resolution (pixels per screen point): high-density
 * phone screens would otherwise draw 4x the pixels on every level. Low also
 * draws into a lighter 8-bit buffer.
 */
const LEVELS: Record<Gfx, { samples: number; shadow: number; mips: number; first: number; rays: number; fxaa: boolean; ratio: number; floor: number; ldr: boolean }> = {
  low: { samples: 0, shadow: 0, mips: 3, first: 4, rays: 0, fxaa: true, ratio: 1, floor: 0.7, ldr: true },
  medium: { samples: 0, shadow: 1024, mips: 4, first: 2, rays: 16, fxaa: true, ratio: 1.5, floor: 0.85, ldr: false },
  high: { samples: 4, shadow: 2048, mips: 5, first: 2, rays: 32, fxaa: false, ratio: 2, floor: 1, ldr: false },
};
/** The level's resolution: its cap and the lowest it may drop to when frames get slow. */
export const ratioOf = (level: Gfx) => ({ max: LEVELS[level].ratio, min: LEVELS[level].floor });

/** A first guess at what a device can run (frame timing adjusts it later). */
export function guessGfx(): Gfx {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const touch = matchMedia("(pointer: coarse)").matches;
  const mem = nav.deviceMemory ?? 8, cores = nav.hardwareConcurrency ?? 8;
  if (mem <= 2 || cores <= 2 || (touch && (mem <= 4 || cores <= 4))) return "low";
  return touch ? "medium" : "high";
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const shader = (frag: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string | number> = {}) =>
  new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false });

const RAYS = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uSun;
uniform float uAspect;
varying vec2 vUv;
float sky(vec2 p) {
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) return 0.0;
  return step(0.999999, texture2D(tDepth, p).r);
}
void main() {
  // March toward the sun; open sky lets light through, anything drawn blocks it.
  vec2 step1 = (vUv - uSun) * (0.85 / float(SAMPLES));
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec2 p = vUv - step1 * ign;
  float light = 1.0, sum = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    vec2 q = (p - uSun) * vec2(uAspect, 1.0);
    sum += sky(p) * light / (1.0 + dot(q, q) * 6.0);
    light *= 0.955;
    p -= step1;
  }
  gl_FragColor = vec4(vec3(sum / float(SAMPLES)), 1.0);
}`;

const PREFILTER = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = (texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
          + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
  c = min(c, vec3(24.0));
  float l = max(c.r, max(c.g, c.b));
  float knee = uThreshold * 0.5;
  float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  gl_FragColor = vec4(c * max(soft, l - uThreshold) / max(l, 1e-4), 1.0);
}`;

const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 h = uTexel;
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0
    + texture2D(tSrc, vUv - h).rgb + texture2D(tSrc, vUv + h).rgb
    + texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb + texture2D(tSrc, vUv - vec2(h.x, -h.y)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

const UP = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 h = uTexel;
  vec3 s = texture2D(tSrc, vUv + vec2(-h.x * 2.0, 0.0)).rgb + texture2D(tSrc, vUv + vec2(h.x * 2.0, 0.0)).rgb
    + texture2D(tSrc, vUv + vec2(0.0, h.y * 2.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, -h.y * 2.0)).rgb
    + (texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb + texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb
     + texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb + texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb) * 2.0;
  gl_FragColor = vec4(s / 12.0, 1.0);
}`;

const FINAL = /* glsl */ `
uniform sampler2D tColor, tDepth, tBloom, tRays;
uniform vec2 uTexel, uRayTexel;
uniform vec3 uRay00, uRay10, uRay01, uRay11, uSunDir, uSunCol, uGain, uLift;
uniform float uNear, uFar, uBloom, uRays, uHaze, uExposure, uSat, uContrast, uVig, uAspect, uTime;
varying vec2 vUv;

vec3 tex(vec2 uv) { return texture2D(tColor, uv).rgb; }
float luma(vec3 c) { return dot(c / (1.0 + c), vec3(0.299, 0.587, 0.114)); }

// Keeps colours as they are up to 0.6, then rolls highlights off softly.
vec3 shoulder(vec3 c) {
  vec3 o = 0.6 + 0.4 * (1.0 - exp(-(c - 0.6) / 0.4));
  return mix(c, o, step(0.6, c));
}
vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec3 c = tex(vUv);
#ifdef FXAA
  // A light FXAA: soften only where the brightness jumps.
  vec3 nw = tex(vUv + uTexel * vec2(-1.0, 1.0)), ne = tex(vUv + uTexel * vec2(1.0, 1.0));
  vec3 sw = tex(vUv + uTexel * vec2(-1.0, -1.0)), se = tex(vUv + uTexel * vec2(1.0, -1.0));
  float lnw = luma(nw), lne = luma(ne), lsw = luma(sw), lse = luma(se), lm = luma(c);
  float lmin = min(lm, min(min(lnw, lne), min(lsw, lse))), lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  if (lmax - lmin > max(0.04, lmax * 0.12)) {
    vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
    float red = max((lnw + lne + lsw + lse) * 0.03125, 0.0078125);
    dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), -8.0, 8.0) * uTexel;
    vec3 a = 0.5 * (tex(vUv - dir / 6.0) + tex(vUv + dir / 6.0));
    vec3 b = a * 0.5 + 0.25 * (tex(vUv - dir * 0.5) + tex(vUv + dir * 0.5));
    float lb = luma(b);
    c = (lb < lmin || lb > lmax) ? a : b;
  }
#endif
  // Haze lit by the sun: thicker with distance, brightest looking toward it.
  vec3 rd = normalize(mix(mix(uRay00, uRay10, vUv.x), mix(uRay01, uRay11, vUv.x), vUv.y));
  float d = texture2D(tDepth, vUv).r;
  float z = uNear * uFar / (uFar - d * (uFar - uNear));
  float thick = 1.0 - exp(-z * 0.0016);
  float sd = max(dot(rd, uSunDir), 0.0);
  c += uSunCol * (pow(sd, 6.0) * 0.35 + pow(sd, 32.0) * 0.5) * thick * uHaze;
  c += texture2D(tBloom, vUv).rgb * uBloom;
  // The rays were worked out at quarter size with a jitter: four soft taps smooth the jitter out.
#ifndef NO_RAYS
  vec2 rt = uRayTexel;
  float ray = texture2D(tRays, vUv + rt * vec2(-0.75, -0.25)).r + texture2D(tRays, vUv + rt * vec2(0.75, 0.25)).r
            + texture2D(tRays, vUv + rt * vec2(0.25, -0.75)).r + texture2D(tRays, vUv + rt * vec2(-0.25, 0.75)).r;
  c += uSunCol * ray * 0.25 * uRays;
#endif
  c = shoulder(c * uExposure);
  // Grade.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, uSat), 0.0);
  c = c * uGain + uLift * (1.0 - c);
  c = toSRGB(c);
  c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
  vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0);
  c *= 1.0 - uVig * smoothstep(0.25, 1.1, dot(v, v) * 1.6);
#ifndef LITE
  // Fine grain (also hides banding in the sky).
  float n = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * 0.018;
#endif
  gl_FragColor = vec4(c, 1.0);
}`;

/** The sun's shadow: a square of the world round the car, kept steady as it moves. */
export class SunShadow {
  private size = 0;
  private c = new THREE.Vector3();
  private m = new THREE.Matrix4();
  private inv = new THREE.Matrix4();
  constructor(readonly sun: THREE.DirectionalLight, scene: THREE.Scene) {
    scene.add(sun.target);
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 2.5;
  }
  setLevel(mapSize: number) {
    this.size = mapSize;
    this.sun.castShadow = mapSize > 0;
    if (!mapSize) return;
    const half = mapSize >= 2048 ? 75 : 62;
    const cam = this.sun.shadow.camera;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.near = 1; cam.far = 700;
    cam.updateProjectionMatrix();
    this.sun.shadow.normalBias = (half * 2 / mapSize) * 0.9;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }
  /** Centres the shadow a little ahead of the car (dir: where the camera looks). */
  update(car: THREE.Vector3, dir: THREE.Vector3, sunDir: THREE.Vector3) {
    if (!this.size) return;
    const half = this.sun.shadow.camera.right;
    const fl = Math.hypot(dir.x, dir.z) || 1;
    this.c.set(car.x + (dir.x / fl) * half * 0.45, car.y, car.z + (dir.z / fl) * half * 0.45);
    // Snap to whole shadow texels (in the light's own frame) so edges don't crawl.
    this.m.lookAt(sunDir, new THREE.Vector3(0, 0, 0), Math.abs(sunDir.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0));
    this.inv.copy(this.m).invert();
    const tx = (half * 2) / this.size;
    this.c.applyMatrix4(this.inv);
    this.c.x = Math.round(this.c.x / tx) * tx; this.c.y = Math.round(this.c.y / tx) * tx;
    this.c.applyMatrix4(this.m);
    this.sun.target.position.copy(this.c);
    this.sun.position.copy(this.c).addScaledVector(sunDir, 350);
    this.sun.target.updateMatrixWorld();
  }
}

export class Post {
  /** Extra exposure for a moment (lightning). 0 = none. */
  flash = 0;
  private level: Gfx = "medium";
  private scene!: THREE.WebGLRenderTarget;
  private rays!: THREE.WebGLRenderTarget;
  private raysSoft!: THREE.WebGLRenderTarget;
  private mips: THREE.WebGLRenderTarget[] = [];
  private w = 1;
  private h = 1;
  private quad: THREE.Mesh;
  private qScene = new THREE.Scene();
  private qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private type: THREE.TextureDataType;
  private raysMat!: THREE.ShaderMaterial;
  private pre: THREE.ShaderMaterial;
  private down: THREE.ShaderMaterial;
  private up: THREE.ShaderMaterial;
  private fin!: THREE.ShaderMaterial;
  private v = new THREE.Vector3();
  private time = 0;
  readonly sunDir: THREE.Vector3;
  readonly sunCol: THREE.Color;

  constructor(private renderer: THREE.WebGLRenderer, private grade: Grade, sunDir: THREE.Vector3, sunCol: THREE.Color) {
    this.sunDir = sunDir.clone().normalize();
    this.sunCol = sunCol.clone();
    const ext = renderer.extensions;
    this.type = ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float") ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(g);
    this.quad.frustumCulled = false;
    this.qScene.add(this.quad);
    this.pre = shader(PREFILTER, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: grade.threshold } });
    this.down = shader(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = shader(UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up.blending = THREE.AdditiveBlending;
    this.up.transparent = true;
  }

  get gfx() { return this.level; }
  get shadowSize() { return LEVELS[this.level].shadow; }

  setLevel(level: Gfx) {
    this.level = level;
    this.build();
  }

  setSize(w: number, h: number) {
    if (w === this.w && h === this.h && this.scene) return;
    this.w = Math.max(1, w); this.h = Math.max(1, h);
    this.build();
  }

  private build() {
    const L = LEVELS[this.level];
    this.scene?.dispose(); this.rays?.dispose(); this.raysSoft?.dispose();
    for (const m of this.mips) m.dispose();
    this.raysMat?.dispose(); this.fin?.dispose();
    const w = this.w, h = this.h;
    const type = L.ldr ? THREE.UnsignedByteType : this.type;
    // 8-bit buffers can't go past white: bloom starts a little lower.
    this.pre.uniforms.uThreshold.value = this.grade.threshold * (type === THREE.UnsignedByteType ? 0.8 : 1);
    this.scene = new THREE.WebGLRenderTarget(w, h, { type, samples: L.samples, depthTexture: new THREE.DepthTexture(w, h) });
    this.rays = new THREE.WebGLRenderTarget(Math.max(1, w >> 2), Math.max(1, h >> 2), { type: THREE.UnsignedByteType, depthBuffer: false });
    this.raysSoft = this.rays.clone();
    this.mips = [];
    for (let i = 0; i < L.mips; i++) {
      const k = L.first << i;
      this.mips.push(new THREE.WebGLRenderTarget(Math.max(1, Math.round(w / k)), Math.max(1, Math.round(h / k)), { type, depthBuffer: false }));
    }
    this.raysMat = shader(RAYS, { tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } }, { SAMPLES: Math.max(1, L.rays) });
    const G = this.grade;
    this.fin = shader(FINAL, {
      tColor: { value: null }, tDepth: { value: null }, tBloom: { value: null }, tRays: { value: null },
      uTexel: { value: new THREE.Vector2(1 / w, 1 / h) }, uRayTexel: { value: new THREE.Vector2(1 / this.rays.width, 1 / this.rays.height) },
      uRay00: { value: new THREE.Vector3() }, uRay10: { value: new THREE.Vector3() }, uRay01: { value: new THREE.Vector3() }, uRay11: { value: new THREE.Vector3() },
      uSunDir: { value: this.sunDir }, uSunCol: { value: this.sunCol },
      uGain: { value: new THREE.Vector3(...G.gain) }, uLift: { value: new THREE.Vector3(...G.lift) },
      uNear: { value: 0.5 }, uFar: { value: 2600 }, uBloom: { value: G.bloom }, uRays: { value: 0 }, uHaze: { value: G.haze },
      uExposure: { value: G.exposure }, uSat: { value: G.saturation }, uContrast: { value: G.contrast }, uVig: { value: G.vignette },
      uAspect: { value: w / h }, uTime: { value: 0 },
    }, { ...(L.fxaa ? { FXAA: 1 } : {}), ...(L.rays ? {} : { NO_RAYS: 1, LITE: 1 }) });
  }

  private pass(mat: THREE.Material, target: THREE.WebGLRenderTarget | null, clear = true) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    if (clear) this.renderer.clear(true, false, false);
    this.renderer.render(this.qScene, this.qCam);
  }

  render(scene: THREE.Scene, cam: THREE.PerspectiveCamera, dt: number) {
    const r = this.renderer;
    this.time += dt;
    const auto = r.autoClear;
    r.setRenderTarget(this.scene);
    r.render(scene, cam);
    r.autoClear = false;
    const depth = this.scene.depthTexture!;

    // God rays, when the sun is in front of us.
    const G = this.grade;
    const facing = this.v.set(0, 0, -1).applyQuaternion(cam.quaternion).dot(this.sunDir);
    const p = this.v.copy(this.sunDir).multiplyScalar(1000).add(cam.position).project(cam);
    const rays = G.rays * Math.max(0, Math.min(1, (facing - 0.1) / 0.35));
    if (rays > 0.001 && LEVELS[this.level].rays) {
      this.raysMat.uniforms.tDepth.value = depth;
      this.raysMat.uniforms.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
      this.raysMat.uniforms.uAspect.value = cam.aspect;
      this.pass(this.raysMat, this.rays);
      // One small blur at quarter size hides the jitter (costs almost nothing).
      this.down.uniforms.tSrc.value = this.rays.texture;
      this.down.uniforms.uTexel.value.set(1.5 / this.rays.width, 1.5 / this.rays.height);
      this.pass(this.down, this.raysSoft);
    }

    // Bloom: keep what's brighter than the threshold, blur it down and back up.
    const src = this.scene.texture;
    this.pre.uniforms.tSrc.value = src;
    this.pre.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
    this.pass(this.pre, this.mips[0]);
    for (let i = 1; i < this.mips.length; i++) {
      this.down.uniforms.tSrc.value = this.mips[i - 1].texture;
      this.down.uniforms.uTexel.value.set(1 / this.mips[i - 1].width, 1 / this.mips[i - 1].height);
      this.pass(this.down, this.mips[i]);
    }
    for (let i = this.mips.length - 1; i > 0; i--) {
      this.up.uniforms.tSrc.value = this.mips[i].texture;
      this.up.uniforms.uTexel.value.set(0.5 / this.mips[i].width, 0.5 / this.mips[i].height);
      this.pass(this.up, this.mips[i - 1], false);
    }

    // Everything together, to the screen.
    const u = this.fin.uniforms;
    u.tColor.value = src; u.tDepth.value = depth; u.tBloom.value = this.mips[0].texture; u.tRays.value = this.raysSoft.texture;
    u.uRays.value = rays;
    u.uNear.value = cam.near; u.uFar.value = cam.far;
    u.uAspect.value = cam.aspect; u.uTime.value = this.time;
    u.uExposure.value = G.exposure * (1 + this.flash);
    u.uTexel.value.set(1 / this.w, 1 / this.h);
    const corner = (x: number, y: number, out: THREE.Vector3) => out.set(x, y, 1).unproject(cam).sub(cam.position);
    corner(-1, -1, u.uRay00.value); corner(1, -1, u.uRay10.value); corner(-1, 1, u.uRay01.value); corner(1, 1, u.uRay11.value);
    this.pass(this.fin, null);
    r.autoClear = auto;
  }

  dispose() {
    this.scene?.dispose(); this.rays?.dispose(); this.raysSoft?.dispose();
    for (const m of this.mips) m.dispose();
    this.raysMat?.dispose(); this.fin?.dispose(); this.pre.dispose(); this.down.dispose(); this.up.dispose();
    this.quad.geometry.dispose();
  }
}
