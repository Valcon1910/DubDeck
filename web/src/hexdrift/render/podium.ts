// Record pillars: a row of lit hexagonal podium columns with each record holder's car
// turning slowly on top. Used for a map's top 3 and the title screen's top 5
// medal holders. An orthographic camera keeps every pillar at an exact,
// even spacing, so the names and times under it (plain HTML columns) line up.
import * as THREE from "three";
import { buildCar, type CarModel } from "./car.ts";
import type { Look } from "../garage.ts";

export interface Place { place: number; look: Look | null }

const COLOURS: Record<number, string> = { 1: "#ffcf3d", 2: "#cfd8e6", 3: "#d98a4e", 4: "#7a5cff", 5: "#23e5ff" };
const HEIGHT: Record<number, number> = { 1: 3.1, 2: 2.35, 3: 1.75, 4: 1.3, 5: 1.0 };
export const SPACING = 4.6;

import { podiumOrder } from "./podiumOrder.ts";
export { podiumOrder };

function numberTexture(n: number, colour: string) {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "italic 800 96px 'Space Grotesk Variable', system-ui, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = colour; g.shadowBlur = 18;
  g.fillStyle = "#ffffff";
  g.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let fade: THREE.Texture | null = null;
/** Bright at the bottom, gone at the top: for the light beams (shared, never disposed). */
function fadeTexture() {
  if (fade) return fade;
  const c = document.createElement("canvas");
  c.width = 4; c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, "#000"); gr.addColorStop(0.7, "#444"); gr.addColorStop(1, "#fff");
  g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
  return (fade = new THREE.CanvasTexture(c));
}

export class Podium {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private canvas: HTMLCanvasElement;
  private ro: ResizeObserver;
  private raf = 0;
  private last = performance.now();
  private cars: { m: CarModel; spin: number; y: number; born: number }[] = [];
  private bits: { geo: THREE.BufferGeometry[]; mat: THREE.Material[]; tex: THREE.Texture[] } = { geo: [], mat: [], tex: [] };
  private group = new THREE.Group();
  private count = 0;
  private caps: THREE.MeshStandardMaterial[] = [];

  constructor(host: HTMLElement) {
    const canvas = document.createElement("canvas");
    canvas.className = "hx-podium-canvas";
    host.prepend(canvas);
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight("#d6dcff", "#1a1430", 1.5));
    const key = new THREE.DirectionalLight("#ffffff", 2.4); key.position.set(3, 8, 6); this.scene.add(key);
    const rim = new THREE.DirectionalLight("#7af7ff", 1.2); rim.position.set(-6, 4, -5); this.scene.add(rim);
    this.scene.add(this.group);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    const loop = (now: number) => { this.raf = requestAnimationFrame(loop); if (!document.hidden) this.frame(now); };
    this.raf = requestAnimationFrame(loop);
  }

  private resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    // Exactly the row's width, so HTML columns under it line up with the pillars.
    const half = (Math.max(1, this.count) * SPACING) / 2;
    const vh = (half * 2 * h) / w;
    this.camera.left = -half; this.camera.right = half;
    this.camera.top = vh * 0.62; this.camera.bottom = -vh * 0.38;
    this.camera.position.set(0, 8, 14);
    this.camera.lookAt(0, 2.1, 0);
    this.camera.updateProjectionMatrix();
  }

  /** Shows these places (missing places simply have no pillar). */
  set(places: Place[]) {
    this.clear();
    const row = podiumOrder(places);
    this.count = row.length;
    row.forEach((p, i) => {
      const x = (i - (row.length - 1) / 2) * SPACING;
      const h = HEIGHT[p.place] ?? 1;
      const col = new THREE.Color(COLOURS[p.place] ?? "#7a5cff");
      const pillar = this.pillar(p.place, h, col);
      pillar.position.x = x;
      this.group.add(pillar);
      if (p.look) {
        const m = buildCar({ look: p.look });
        m.root.scale.setScalar(0.62);
        m.root.position.set(x, h + 0.16, 0);
        this.scene.add(m.root);
        this.cars.push({ m, spin: 0.6 + i * 0.9, y: h + 0.16, born: performance.now() + i * 120 });
      }
    });
    this.resize();
  }


  /** Keeps a geometry and material for disposal, and returns the mesh. */
  private mesh(g: THREE.BufferGeometry, m: THREE.Material) {
    this.bits.geo.push(g); this.bits.mat.push(m);
    return new THREE.Mesh(g, m);
  }

  /**
   * One pillar: a stepped plinth, a dark glass hex column with lit edges and
   * glowing grooves down the side faces, a metal collar, a glowing cap with a
   * soft beam above it, the place number on the front and a pool of light
   * on the floor. All flat, cheap materials: one draw per part, no shadows.
   */
  private pillar(place: number, h: number, col: THREE.Color) {
    const g = new THREE.Group();
    const R = 1.85, ap = R * Math.cos(Math.PI / 6), T = Math.PI / 6;
    const hex = (r: number, hh: number, y: number, r2 = r) => new THREE.CylinderGeometry(r2, r, hh, 6, 1).rotateY(T).translate(0, y + hh / 2, 0);
    const dark = new THREE.Color("#1d1a3a");
    // Floor glow and the two-step plinth.
    g.add(this.mesh(new THREE.CircleGeometry(R + 1.3, 6).rotateX(-Math.PI / 2).rotateY(T).translate(0, 0.005, 0),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.1, depthWrite: false })));
    const plinthM = new THREE.MeshStandardMaterial({ color: "#14122a", metalness: 0.7, roughness: 0.35, flatShading: true });
    g.add(this.mesh(hex(R + 0.45, 0.16, 0, R + 0.35), plinthM));
    g.add(this.mesh(hex(R + 0.22, 0.12, 0.16, R + 0.16), plinthM));
    const y0 = 0.28, bh = Math.max(0.4, h - y0 - 0.34);
    // The column.
    const body = hex(R, bh, y0);
    g.add(this.mesh(body, new THREE.MeshStandardMaterial({ color: dark, metalness: 0.55, roughness: 0.3, emissive: col, emissiveIntensity: 0.07, flatShading: true })));
    const edges = new THREE.EdgesGeometry(body, 20);
    g.add(new THREE.LineSegments(edges, this.keep(new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.85 }), edges)));
    // A glowing groove down the middle of each of the three faces in view.
    const grooveM = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, depthWrite: false });
    for (const k of [-1, 1]) {
      const a = k * (Math.PI / 3);
      const strip = new THREE.PlaneGeometry(0.07, bh * 0.82).translate(0, y0 + bh / 2, ap + 0.012).rotateY(a);
      g.add(this.mesh(strip, grooveM));
    }
    // Metal collar and the glowing cap.
    g.add(this.mesh(hex(R + 0.05, 0.12, y0 + bh), new THREE.MeshStandardMaterial({ color: "#c9d3e2", metalness: 0.9, roughness: 0.25, flatShading: true })));
    const capM = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.25, flatShading: true });
    g.add(this.mesh(hex(R + 0.1, 0.2, y0 + bh + 0.12, R - 0.05), capM));
    this.caps.push(capM);
    g.add(this.mesh(new THREE.RingGeometry(R + 0.12, R + 0.6, 6, 1).rotateX(-Math.PI / 2).rotateY(T).translate(0, h + 0.005, 0),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, depthWrite: false })));
    // A soft beam of light rising from the cap (taller for higher places).
    const beamH = 2.2 + (6 - Math.min(5, place)) * 0.35;
    const beam = new THREE.CylinderGeometry(R * 1.05, R * 0.9, beamH, 6, 1, true).rotateY(T).translate(0, h + beamH / 2, 0);
    const beamM = new THREE.MeshBasicMaterial({ color: col, alphaMap: fadeTexture(), transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    beamM.forceSinglePass = true;
    g.add(this.mesh(beam, beamM));
    // The place number on the front face, in a lit frame.
    const fs = Math.min(1.3, bh * 0.75);
    const fy = y0 + Math.max(bh * 0.46, Math.min(bh * 0.55, bh - 0.7));
    g.add(this.mesh(new THREE.PlaneGeometry(fs + 0.24, fs + 0.24).translate(0, fy, ap + 0.008),
      new THREE.MeshBasicMaterial({ color: dark.clone().lerp(col, 0.18) })));
    const tex = numberTexture(place, `#${col.getHexString()}`);
    this.bits.tex.push(tex);
    g.add(this.mesh(new THREE.PlaneGeometry(fs, fs).translate(0, fy, ap + 0.016), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })));
    return g;
  }

  private keep<M extends THREE.Material>(m: M, geo: THREE.BufferGeometry) { this.bits.geo.push(geo); this.bits.mat.push(m); return m; }

  private clear() {
    for (const c of this.cars) { this.scene.remove(c.m.root); c.m.dispose(); }
    this.cars = [];
    this.group.clear();
    for (const g of this.bits.geo) g.dispose();
    for (const m of this.bits.mat) m.dispose();
    for (const t of this.bits.tex) t.dispose();
    this.bits = { geo: [], mat: [], tex: [] };
    this.caps = [];
  }

  private frame(now: number) {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    for (const c of this.cars) {
      c.spin += dt * 0.5;
      c.m.root.rotation.y = c.spin;
      // Drop in from above, once.
      const k = Math.min(1, Math.max(0, (now - c.born) / 600));
      c.m.root.position.y = c.y + (1 - (1 - (1 - k) ** 3)) * 3;
      c.m.update(0, 0, dt);
    }
    // The caps breathe gently.
    const glow = 0.5 + Math.sin(now / 700) * 0.12;
    for (const m of this.caps) m.emissiveIntensity = glow;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
