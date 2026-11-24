// A pool of soft round particles for smoke, dust, snow spray, sparks, chips
// and glitter: one draw call per pool, each particle with its own colour,
// size, fade and motion. Only for show; nothing here touches the physics.
import * as THREE from "three";

export interface Emit {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  /** Random spread added to the velocity. */
  spread?: number;
  color: THREE.ColorRepresentation;
  size: number; grow?: number;
  life: number;
  alpha?: number;
  gravity?: number;
  drag?: number;
}

const VERT = /* glsl */ `
attribute vec3 color;
attribute float size;
attribute float alpha;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
varying float vDepth;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uScale * projectionMatrix[1][1] / max(0.5, -mv.z);
  vColor = color;
  vAlpha = alpha;
  vDepth = -mv.z;
}`;

const FRAG = /* glsl */ `
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform float uSoft;
varying vec3 vColor;
varying float vAlpha;
varying float vDepth;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float a = vAlpha * (1.0 - smoothstep(uSoft, 1.0, d));
  float f = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(vColor, uFog, f), a * (1.0 - f));
}`;

export class Particles {
  readonly points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private pos: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private vel: Float32Array; private base: Float32Array; private born: Float32Array; private life: Float32Array;
  private grow: Float32Array; private a0: Float32Array; private grav: Float32Array; private drag: Float32Array;
  private next = 0;
  private live = 0;
  private c = new THREE.Color();

  constructor(private max: number, additive: boolean, fog?: THREE.Fog | null) {
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.base = new Float32Array(max);
    this.born = new Float32Array(max); this.life = new Float32Array(max);
    this.grow = new Float32Array(max); this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    const dyn = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", dyn(this.pos, 3));
    this.geo.setAttribute("color", dyn(this.col, 3));
    this.geo.setAttribute("size", dyn(this.size, 1));
    this.geo.setAttribute("alpha", dyn(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uScale: { value: 400 },
        uFog: { value: new THREE.Color(fog?.color ?? "#000000") },
        uFogNear: { value: fog?.near ?? 1e4 }, uFogFar: { value: fog?.far ?? 2e4 },
        uSoft: { value: additive ? 0.1 : 0.35 },
      },
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** Point sizes are in world units: tell it the canvas height in pixels. */
  setViewHeight(px: number) { this.mat.uniforms.uScale.value = px / 2; }

  emit(e: Emit) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const o = i * 3, s = e.spread ?? 0;
    this.pos[o] = e.x; this.pos[o + 1] = e.y; this.pos[o + 2] = e.z;
    this.vel[o] = (e.vx ?? 0) + (Math.random() - 0.5) * s;
    this.vel[o + 1] = (e.vy ?? 0) + (Math.random() - 0.5) * s;
    this.vel[o + 2] = (e.vz ?? 0) + (Math.random() - 0.5) * s;
    this.c.set(e.color);
    this.col[o] = this.c.r; this.col[o + 1] = this.c.g; this.col[o + 2] = this.c.b;
    this.base[i] = e.size; this.size[i] = e.size; this.grow[i] = e.grow ?? 0;
    this.life[i] = e.life; this.born[i] = 0;
    this.a0[i] = e.alpha ?? 1; this.alpha[i] = this.a0[i];
    this.grav[i] = e.gravity ?? 0; this.drag[i] = e.drag ?? 0;
    this.live = Math.max(this.live, 1);
  }

  /** A quick burst of n particles. */
  burst(n: number, e: Emit) { for (let k = 0; k < n; k++) this.emit(e); }

  update(dt: number) {
    if (!this.live) return;
    let any = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const t = (this.born[i] += dt);
      const k = t / this.life[i];
      if (k >= 1) { this.life[i] = 0; this.alpha[i] = 0; this.size[i] = 0; continue; }
      any++;
      const o = i * 3;
      const f = this.drag[i] ? Math.exp(-this.drag[i] * dt) : 1;
      this.vel[o] *= f; this.vel[o + 1] = this.vel[o + 1] * f - this.grav[i] * dt; this.vel[o + 2] *= f;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.size[i] = this.base[i] + this.grow[i] * t;
      // In fast, out slowly.
      this.alpha[i] = this.a0[i] * Math.min(1, k * 8) * (1 - k) * (1 - k);
    }
    this.live = any;
    for (const n of ["position", "color", "size", "alpha"]) (this.geo.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.life.fill(0); this.alpha.fill(0); this.size.fill(0); this.live = 0;
    (this.geo.getAttribute("alpha") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("size") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.mat.dispose(); }
}
