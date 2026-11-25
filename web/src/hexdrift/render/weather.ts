// Weather around the camera: rain over the city, snow on the glacier, dust
// in the canyon and the desert, wind streaks over the clouds. The whole
// field moves on the graphics card (each drop wraps around a box that
// follows the camera), so it costs no work per frame on the main thread.
import * as THREE from "three";
import type { BiomeId } from "../maps.ts";

export type WeatherKind = "rain" | "snow" | "dust" | "wind";

interface Spec { kind: WeatherKind; count: number; box: [number, number, number]; vel: [number, number, number]; color: string; alpha: number; size: number; len: number }

export const WEATHER: Record<BiomeId, Spec> = {
  city: { kind: "rain", count: 2600, box: [70, 36, 70], vel: [-4, -42, 2], color: "#a9c4ff", alpha: 0.42, size: 0, len: 1.6 },
  glacier: { kind: "snow", count: 1800, box: [70, 34, 70], vel: [1.5, -3.2, 0.8], color: "#ffffff", alpha: 0.95, size: 0.3, len: 0 },
  canyon: { kind: "dust", count: 900, box: [80, 22, 80], vel: [9, 0.4, 3], color: "#ffd2a8", alpha: 0.35, size: 0.32, len: 0 },
  desert: { kind: "dust", count: 1000, box: [80, 18, 80], vel: [11, 0.2, -4], color: "#fff0cc", alpha: 0.38, size: 0.28, len: 0 },
  miami: { kind: "dust", count: 260, box: [90, 24, 90], vel: [2.5, 0.3, 1], color: "#fff0d8", alpha: 0.3, size: 0.18, len: 0 },
  storm: { kind: "rain", count: 3400, box: [70, 36, 70], vel: [-6, -46, 3], color: "#b4c8ff", alpha: 0.45, size: 0, len: 1.8 },
  alpine: { kind: "snow", count: 700, box: [80, 34, 80], vel: [1, -2.4, 0.5], color: "#ffffff", alpha: 0.8, size: 0.22, len: 0 },
  space: { kind: "wind", count: 220, box: [140, 60, 140], vel: [0, 0, 30], color: "#9fe8ff", alpha: 0.18, size: 0, len: 9 },
  baja: { kind: "dust", count: 900, box: [80, 18, 80], vel: [10, 0.3, -3], color: "#f3dcb2", alpha: 0.36, size: 0.3, len: 0 },
  sky: { kind: "wind", count: 160, box: [110, 50, 110], vel: [3, 0, 26], color: "#ffffff", alpha: 0.16, size: 0, len: 7 },
};

const VERT = /* glsl */ `
attribute vec3 seed;
attribute float tail;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec3 uVel;
uniform float uLen;
uniform float uSize;
uniform float uScale;
uniform float uSwirl;
varying float vFade;
void main() {
  vec3 p = seed * uBox + uVel * uTime * (0.75 + seed.y * 0.5);
  p.x += sin(uTime * 0.9 + seed.z * 40.0) * uSwirl;
  p.z += cos(uTime * 0.7 + seed.x * 40.0) * uSwirl;
  // Wrap into a box centred on the camera.
  p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  // Fade towards the edges of the box so nothing pops in.
  vec3 e = abs(p) / (uBox * 0.5);
  vFade = (1.0 - smoothstep(0.7, 1.0, max(e.x, e.z))) * (1.0 - smoothstep(0.75, 1.0, e.y));
  p += uCam;
  p -= normalize(uVel) * uLen * tail;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uScale * projectionMatrix[1][1] / max(0.5, -mv.z);
  vFade *= 1.0 - smoothstep(6.0, 1.0, -mv.z) * 0.6; // not right in your face
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uPoints;
varying float vFade;
void main() {
  float a = uAlpha * vFade;
  if (uPoints > 0.5) {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    a *= 1.0 - smoothstep(0.3, 1.0, d);
  }
  gl_FragColor = vec4(uColor, a);
}`;

export class Weather {
  readonly object: THREE.Object3D;
  private mat: THREE.ShaderMaterial;
  private geo = new THREE.BufferGeometry();
  private t = 0;

  constructor(readonly spec: Spec) {
    const lines = spec.len > 0;
    const n = spec.count * (lines ? 2 : 1);
    const seed = new Float32Array(n * 3), tail = new Float32Array(n);
    for (let i = 0; i < spec.count; i++) {
      const sx = Math.random(), sy = Math.random(), sz = Math.random();
      for (let k = 0; k < (lines ? 2 : 1); k++) {
        const j = lines ? i * 2 + k : i;
        seed[j * 3] = sx; seed[j * 3 + 1] = sy; seed[j * 3 + 2] = sz;
        tail[j] = k;
      }
    }
    // Positions are worked out in the shader; this just gives three.js a size.
    this.geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geo.setAttribute("seed", new THREE.BufferAttribute(seed, 3));
    this.geo.setAttribute("tail", new THREE.BufferAttribute(tail, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: spec.kind === "wind" ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 }, uCam: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(...spec.box) }, uVel: { value: new THREE.Vector3(...spec.vel) },
        uLen: { value: spec.len }, uSize: { value: spec.size }, uScale: { value: 400 },
        uSwirl: { value: spec.kind === "snow" ? 1.6 : spec.kind === "dust" ? 2.5 : 0 },
        uColor: { value: new THREE.Color(spec.color) }, uAlpha: { value: spec.alpha },
        uPoints: { value: lines ? 0 : 1 },
      },
    });
    this.object = lines ? new THREE.LineSegments(this.geo, this.mat) : new THREE.Points(this.geo, this.mat);
    this.object.frustumCulled = false;
    this.object.renderOrder = 3;
  }

  setViewHeight(px: number) { this.mat.uniforms.uScale.value = px / 2; }

  update(dt: number, cam: THREE.Vector3) {
    this.t += dt;
    this.mat.uniforms.uTime.value = this.t;
    (this.mat.uniforms.uCam.value as THREE.Vector3).copy(cam);
  }

  dispose() { this.geo.dispose(); this.mat.dispose(); }
}
