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
      // The column: a six-sided prism of dark glass, a flat face to the
      // front, lit edges and a glowing cap in the medal colour. Seen a little
      // from above, so its top and both front sides catch the light.
      const R = 1.85, ap = R * Math.cos(Math.PI / 6);
      const body = new THREE.CylinderGeometry(R, R, h, 6, 1).rotateY(Math.PI / 6).translate(0, h / 2, 0);
      const bm = new THREE.MeshStandardMaterial({ color: "#1d1a3a", metalness: 0.55, roughness: 0.3, emissive: col, emissiveIntensity: 0.08, flatShading: true });
      const edges = new THREE.EdgesGeometry(body, 20);
      const em = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.85 });
      const cap = new THREE.CylinderGeometry(R + 0.08, R + 0.08, 0.16, 6, 1).rotateY(Math.PI / 6).translate(0, h + 0.08, 0);
      const cm = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.25, flatShading: true });
      const glow = new THREE.RingGeometry(R + 0.1, R + 0.7, 6, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 6);
      const gm = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, depthWrite: false });
      const fs = Math.min(1.4, h * 0.8);
      const front = new THREE.PlaneGeometry(fs, fs).translate(0, Math.max(h * 0.46, Math.min(h * 0.55, h - 0.8)), ap + 0.01);
      const tex = numberTexture(p.place, `#${col.getHexString()}`);
      const fm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      const pillar = new THREE.Group();
      pillar.add(new THREE.Mesh(body, bm), new THREE.LineSegments(edges, em), new THREE.Mesh(cap, cm), new THREE.Mesh(glow, gm), new THREE.Mesh(front, fm));
      pillar.position.x = x;
      this.group.add(pillar);
      this.bits.geo.push(body, edges, cap, glow, front); this.bits.mat.push(bm, em, cm, gm, fm); this.bits.tex.push(tex);
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

  private clear() {
    for (const c of this.cars) { this.scene.remove(c.m.root); c.m.dispose(); }
    this.cars = [];
    this.group.clear();
    for (const g of this.bits.geo) g.dispose();
    for (const m of this.bits.mat) m.dispose();
    for (const t of this.bits.tex) t.dispose();
    this.bits = { geo: [], mat: [], tex: [] };
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
