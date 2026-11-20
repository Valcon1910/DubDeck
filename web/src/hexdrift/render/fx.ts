// Visual effects: the trail ribbon behind the car (boost, drifts, big air)
// and the celebration when you cross the finish line. Each is one small mesh
// rebuilt from a ring buffer, so they cost about one draw call each.
import * as THREE from "three";

export type TrailStyle = "ribbon" | "twin" | "flame" | "lightning" | "rainbow" | "galaxy";
export interface TrailDef { style: TrailStyle; color: string; color2?: string }

const N = 56; // samples kept per ribbon

// Soft across the ribbon: bright core, fading edges.
let softTex: THREE.CanvasTexture | null = null;
function soft() {
  if (softTex) return softTex;
  const c = document.createElement("canvas");
  c.width = 64; c.height = 4;
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(0.5, "rgba(255,255,255,1)"); g.addColorStop(0.65, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 4);
  softTex = new THREE.CanvasTexture(c);
  return softTex;
}

/** A glowing ribbon left behind the car. */
export class Trail {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.MeshBasicMaterial;
  private pts: { x: number; y: number; z: number; rx: number; rz: number; on: number; age: number; j: number }[] = [];
  private lastX = NaN; private lastZ = NaN;
  private pos: Float32Array; private col: Float32Array;
  private ribbons: number;
  private c1: THREE.Color; private c2: THREE.Color;
  private hue = 0;
  private tmp = new THREE.Color();

  constructor(private def: TrailDef, ghost = false) {
    this.ribbons = def.style === "twin" ? 2 : 1;
    this.c1 = new THREE.Color(def.color);
    this.c2 = new THREE.Color(def.color2 ?? def.color);
    const verts = this.ribbons * N * 2;
    this.pos = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 3);
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(verts * 2);
    for (let i = 0; i < verts; i++) uv[i * 2] = i % 2;
    this.geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const idx: number[] = [];
    for (let r = 0; r < this.ribbons; r++) {
      const o = r * N * 2;
      for (let i = 0; i < N - 1; i++) {
        const a = o + i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.geo.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({ map: soft(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: ghost ? 0.35 : 1 });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
  }

  /**
   * Adds the car's position (rear centre, its right vector) and ages the
   * trail. `on` (0..1) is how strongly it glows right now.
   */
  update(x: number, y: number, z: number, rx: number, rz: number, on: number, dt: number) {
    for (const p of this.pts) p.age += dt;
    const moved = (x - this.lastX) ** 2 + (z - this.lastZ) ** 2;
    if (!(moved < 0.36)) {
      const jit = this.def.style === "lightning" ? (Math.random() - 0.5) * 0.9 : 0;
      this.pts.unshift({ x, y, z, rx, rz, on, age: 0, j: jit });
      if (this.pts.length > N) this.pts.pop();
      this.lastX = x; this.lastZ = z;
    } else if (this.pts.length) {
      // Standing still: keep the head glued to the car.
      const h = this.pts[0];
      h.x = x; h.y = y; h.z = z; h.rx = rx; h.rz = rz; h.on = Math.max(h.on, on);
    }
    this.hue = (this.hue + dt * 0.6) % 1;
    this.rebuild();
  }

  /** Moves every sample (the garage preview, where the car stands still). */
  shift(dx: number, dz: number) {
    for (const p of this.pts) { p.x += dx; p.z += dz; }
    this.lastX += dx; this.lastZ += dz;
  }

  /** Clears the trail (respawn, restart). */
  reset() { this.pts.length = 0; this.lastX = this.lastZ = NaN; this.rebuild(); }

  private rebuild() {
    const life = this.def.style === "flame" ? 0.45 : 0.9;
    const { pos, col } = this;
    pos.fill(0); col.fill(0);
    for (let r = 0; r < this.ribbons; r++) {
      const side = this.ribbons === 2 ? (r ? 0.95 : -0.95) : 0;
      const half = this.ribbons === 2 ? 0.22 : this.def.style === "flame" ? 0.55 : 0.4;
      for (let i = 0; i < Math.min(N, this.pts.length); i++) {
        const p = this.pts[i];
        const along = i / (N - 1);
        const fade = Math.max(0, 1 - p.age / life) * p.on * (1 - along) * 0.85;
        const w = half * (this.def.style === "flame" ? 1 - along * 0.8 : 1 - along * 0.5);
        const cx = p.x + p.rx * (side + p.j), cz = p.z + p.rz * (side + p.j);
        const o = (r * N * 2 + i * 2) * 3;
        const lift = this.def.style === "flame" ? along * 0.5 : 0;
        pos[o] = cx - p.rx * w; pos[o + 1] = p.y + lift; pos[o + 2] = cz - p.rz * w;
        pos[o + 3] = cx + p.rx * w; pos[o + 4] = p.y + lift; pos[o + 5] = cz + p.rz * w;
        const c = this.tmp;
        if (this.def.style === "rainbow") c.setHSL((this.hue + along * 1.5) % 1, 1, 0.55);
        else if (this.def.style === "galaxy") c.copy(this.c1).lerp(this.c2, (Math.sin(i * 1.7 + this.hue * 40) + 1) / 2);
        else c.copy(this.c1).lerp(this.c2, along);
        const k = fade * (this.def.style === "lightning" && Math.random() < 0.15 ? 1.6 : 1);
        col[o] = col[o + 3] = c.r * k; col[o + 1] = col[o + 4] = c.g * k; col[o + 2] = col[o + 5] = c.b * k;
      }
    }
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

// ── Finish celebrations ─────────────────────────────────────────────────────
export type FinishKind = "confetti" | "fireworks" | "sparkles" | "shockwave" | "lightning" | "vortex";

const MAXP = 520;
let dotTex: THREE.CanvasTexture | null = null;
function dot() {
  if (dotTex) return dotTex;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.4, "rgba(255,255,255,0.8)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 32, 32);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

const PALETTES: Record<FinishKind, string[]> = {
  confetti: ["#ff3d6e", "#ffd23d", "#3dd6ff", "#7cff5a", "#b06bff", "#ffffff"],
  fireworks: ["#ff5a3c", "#ffd23d", "#5fd2ff", "#ff6fd8", "#8cff5a"],
  sparkles: ["#ffe9a0", "#ffd24a", "#fff6d8"],
  shockwave: ["#7af7ff", "#ffffff", "#5f8bff"],
  lightning: ["#d8f0ff", "#8fd4ff", "#ffffff"],
  vortex: ["#a46bff", "#ff5fd2", "#5fd2ff"],
};

/** A burst of particles (and a ring or bolts for some kinds) at the finish. */
export class FinishFx {
  readonly group = new THREE.Group();
  private geo = new THREE.BufferGeometry();
  private mat: THREE.PointsMaterial;
  private pos = new Float32Array(MAXP * 3);
  private col = new Float32Array(MAXP * 3);
  private base = new Float32Array(MAXP * 3);
  private vel = new Float32Array(MAXP * 3);
  private life = new Float32Array(MAXP);
  private born = new Float32Array(MAXP);
  private n = 0;
  private t = 0;
  private dur = 0;
  private kind: FinishKind = "confetti";
  private origin = new THREE.Vector3();
  private ring: THREE.Mesh;
  private bolts: THREE.LineSegments;
  private boltPos = new Float32Array(3 * 2 * 3 * 14);

  constructor() {
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.PointsMaterial({ size: 0.7, map: dot(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(this.geo, this.mat);
    pts.frustumCulled = false;
    this.group.add(pts);
    const rg = new THREE.RingGeometry(0.85, 1, 48); rg.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: "#7af7ff", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.group.add(this.ring);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(this.boltPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.bolts = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: "#d8f0ff", transparent: true, blending: THREE.AdditiveBlending }));
    this.bolts.frustumCulled = false;
    this.group.add(this.bolts);
    this.group.visible = false;
  }

  start(kind: FinishKind, x: number, y: number, z: number, scale = 1) {
    this.group.scale.setScalar(scale);
    this.kind = kind; this.t = 0; this.dur = kind === "fireworks" ? 3.4 : 2.8;
    this.origin.set(x, y, z);
    this.group.visible = true;
    this.mat.size = (kind === "confetti" ? 0.55 : kind === "sparkles" ? 0.45 : 0.7) * scale;
    this.mat.blending = kind === "confetti" ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.mat.needsUpdate = true;
    const pal = PALETTES[kind].map((c) => new THREE.Color(c));
    const R = Math.random;
    this.n = kind === "fireworks" ? 480 : kind === "confetti" ? 360 : 260;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      let px = x, py = y + 1, pz = z, vx = 0, vy = 0, vz = 0, born = 0, life = 1.6 + R();
      if (kind === "confetti") {
        const a = R() * Math.PI * 2, s = 3 + R() * 7;
        vx = Math.cos(a) * s; vz = Math.sin(a) * s; vy = 9 + R() * 11; life = 2.2 + R() * 0.6;
      } else if (kind === "fireworks") {
        const burst = Math.floor(i / 120);
        born = burst * 0.55;
        const bx = Math.sin(burst * 2.4) * 9, bz = Math.cos(burst * 2.4) * 9;
        px = x + bx; py = y + 14 + burst * 2; pz = z + bz;
        // A sphere of sparks.
        const u = R() * 2 - 1, a = R() * Math.PI * 2, s = 8 + R() * 2, rr = Math.sqrt(1 - u * u);
        vx = rr * Math.cos(a) * s; vy = u * s; vz = rr * Math.sin(a) * s; life = 1.5 + R() * 0.4;
        const c = new THREE.Color(PALETTES.fireworks[burst % 5]);
        this.col[o] = c.r; this.col[o + 1] = c.g; this.col[o + 2] = c.b;
      } else if (kind === "sparkles") {
        const a = R() * Math.PI * 2, r = 1.5 + R() * 2.5;
        px = x + Math.cos(a) * r; pz = z + Math.sin(a) * r; py = y + R() * 1.5;
        vx = -Math.sin(a) * 2; vz = Math.cos(a) * 2; vy = 2 + R() * 4; born = R() * 1.2; life = 1.2 + R() * 0.8;
      } else if (kind === "shockwave") {
        const a = R() * Math.PI * 2, s = 14 + R() * 12;
        vx = Math.cos(a) * s; vz = Math.sin(a) * s; vy = 1 + R() * 3; py = y + 0.4; life = 1 + R() * 0.6;
      } else if (kind === "lightning") {
        const a = R() * Math.PI * 2, s = 4 + R() * 10;
        vx = Math.cos(a) * s; vz = Math.sin(a) * s; vy = 4 + R() * 9; born = Math.floor(R() * 3) * 0.3; life = 0.8 + R() * 0.6;
      } else {
        const a = R() * Math.PI * 2, r = 6 + R() * 4;
        px = x + Math.cos(a) * r; pz = z + Math.sin(a) * r; py = y + R() * 2;
        vx = a; vz = r; vy = 3 + R() * 6; born = R() * 0.8; life = 1.8 + R() * 0.6; // spiral: angle and radius in vx/vz
      }
      this.base[o] = px; this.base[o + 1] = py; this.base[o + 2] = pz;
      this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
      this.born[i] = born; this.life[i] = life;
      if (kind !== "fireworks") {
        const c = pal[i % pal.length];
        this.col[o] = c.r; this.col[o + 1] = c.g; this.col[o + 2] = c.b;
      }
    }
    for (let i = this.n; i < MAXP; i++) { this.pos[i * 3 + 1] = -1e5; }
    this.update(0);
  }

  stop() { this.group.visible = false; this.dur = 0; }

  update(dt: number) {
    if (!this.group.visible) return;
    this.t += dt;
    if (this.t > this.dur) { this.stop(); return; }
    const { kind, t } = this;
    const g = kind === "confetti" ? 14 : kind === "fireworks" ? 5 : kind === "sparkles" ? -1 : kind === "vortex" ? 0 : 10;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      const age = t - this.born[i];
      if (age < 0 || age > this.life[i]) { this.pos[o + 1] = -1e5; continue; }
      if (kind === "vortex") {
        const a = this.vel[o] + age * 4, r = this.vel[o + 2] * Math.max(0.1, 1 - age / this.life[i]);
        this.pos[o] = this.origin.x + Math.cos(a) * r; this.pos[o + 2] = this.origin.z + Math.sin(a) * r;
        this.pos[o + 1] = this.base[o + 1] + this.vel[o + 1] * age;
        continue;
      }
      // Drag for confetti and sparks.
      const drag = kind === "confetti" ? Math.exp(-age * 1.6) : kind === "shockwave" ? Math.exp(-age * 2.5) : 1;
      const k = kind === "confetti" || kind === "shockwave" ? (1 - drag) / (kind === "confetti" ? 1.6 : 2.5) : age;
      this.pos[o] = this.base[o] + this.vel[o] * k;
      this.pos[o + 1] = this.base[o + 1] + this.vel[o + 1] * k - 0.5 * g * age * age * (kind === "confetti" ? 0.35 : 1);
      this.pos[o + 2] = this.base[o + 2] + this.vel[o + 2] * k;
      if (kind === "confetti") this.pos[o] += Math.sin(age * 7 + i) * 0.15; // flutter
    }
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    const fade = Math.min(1, (this.dur - t) / 0.8);
    this.mat.opacity = fade;
    // The expanding ring.
    const ringOn = kind === "shockwave" || kind === "vortex";
    this.ring.visible = ringOn;
    if (ringOn) {
      const s = kind === "shockwave" ? 2 + t * 30 : 10 * Math.max(0.05, 1 - t / 1.5);
      this.ring.scale.set(s, 1, s);
      this.ring.position.set(this.origin.x, this.origin.y + 0.15, this.origin.z);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t / 1.4);
      (this.ring.material as THREE.MeshBasicMaterial).color.set(kind === "vortex" ? "#a46bff" : "#7af7ff");
    }
    // Lightning bolts from the sky, flickering.
    this.bolts.visible = kind === "lightning" && t < 1.1 && Math.random() < 0.75;
    if (this.bolts.visible) {
      let w = 0;
      for (let b = 0; b < 3; b++) {
        let px = this.origin.x + (b - 1) * 2.5, py = this.origin.y + 30, pz = this.origin.z + (Math.random() - 0.5) * 3;
        for (let s = 0; s < 7; s++) {
          const nx = this.origin.x + (b - 1) * 0.6 + (Math.random() - 0.5) * 3 * (1 - s / 7);
          const ny = this.origin.y + 30 - (30 * (s + 1)) / 7;
          const nz = this.origin.z + (Math.random() - 0.5) * 3 * (1 - s / 7);
          this.boltPos.set([px, py, pz, nx, ny, nz], w); w += 6;
          px = nx; py = ny; pz = nz;
        }
      }
      (this.bolts.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose() {
    this.geo.dispose(); this.mat.dispose();
    this.ring.geometry.dispose(); (this.ring.material as THREE.Material).dispose();
    this.bolts.geometry.dispose(); (this.bolts.material as THREE.Material).dispose();
  }
}

/** The trail settings for a garage item. */
export function trailDef(it: { style?: string; color?: string; color2?: string }): TrailDef {
  return { style: (it.style ?? "ribbon") as TrailStyle, color: it.color ?? "#ffffff", color2: it.color2 };
}
