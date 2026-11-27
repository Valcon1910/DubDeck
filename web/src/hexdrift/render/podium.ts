// Record pillars: a row of lit hexagonal podium columns with each record holder's car
// turning slowly on top. Used for a map's top 3 and the title screen's top 5
// medal holders. An orthographic camera keeps every pillar at an exact,
// even spacing, so the names and times under it (plain HTML columns) line up.
import * as THREE from "three";
import { buildCar, type CarModel } from "./car.ts";
import type { Look } from "../garage.ts";

export interface Place { place: number; look: Look | null }

const COLOURS: Record<number, string> = { 1: "#ffcf3d", 2: "#cfd8e6", 3: "#d98a4e", 4: "#7a5cff", 5: "#23e5ff" };
const HEIGHT: Record<number, number> = { 1: 3.3, 2: 2.55, 3: 1.95, 4: 1.5, 5: 1.25 };
export const SPACING = 4.6;
const BEAM = 1.8;
const CROWN_Y = 2.2;

import { podiumOrder } from "./podiumOrder.ts";
export { podiumOrder };

function numberTexture(n: number, colour: string) {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "italic 800 96px 'Space Grotesk Variable', system-ui, sans-serif";
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.shadowColor = colour; g.shadowBlur = 18;
  g.fillStyle = "#ffffff";
  // Centre the glyph's own ink (italic digits lean, so the box is measured).
  const m = g.measureText(String(n));
  const x = 64 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 + m.actualBoundingBoxLeft;
  const y = 64 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  g.fillText(String(n), x, y);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let dot: THREE.Texture | null = null;
/** A soft round dot for the sparkles (shared, never disposed). */
function dotTexture() {
  if (dot) return dot;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.6)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return (dot = new THREE.CanvasTexture(c));
}

let burstTex: THREE.Texture | null = null;
/** Soft rays from a bright centre: the glory behind the crown (shared). */
function burstTexture() {
  if (burstTex) return burstTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.translate(64, 64);
  for (let i = 0; i < 16; i++) {
    g.rotate(Math.PI / 8);
    const gr = g.createLinearGradient(0, 0, 0, -64);
    gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    const w = i % 2 ? 3 : 6;
    g.beginPath(); g.moveTo(-w, 0); g.lineTo(0, -64); g.lineTo(w, 0); g.fill();
  }
  const core = g.createRadialGradient(0, 0, 0, 0, 0, 40);
  core.addColorStop(0, "rgba(255,255,255,0.8)"); core.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = core; g.fillRect(-64, -64, 128, 128);
  return (burstTex = new THREE.CanvasTexture(c));
}

let pool: THREE.Texture | null = null;
/** Bright in the middle, gone at the edge: for the floor light (shared). */
function poolTexture() {
  if (pool) return pool;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "#fff"); gr.addColorStop(0.55, "#666"); gr.addColorStop(1, "#000");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (pool = new THREE.CanvasTexture(c));
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
  private heights: number[] = [];
  private fx: { kind: "rise" | "spread" | "sheen"; o: THREE.Object3D; m: THREE.MeshBasicMaterial; t: number; rate: number; base: number; span: number; peak: number }[] = [];
  private orbits: { pos: THREE.BufferAttribute; orb: { a: number; r: number; y: number; w: number }[] }[] = [];
  private bursts: THREE.Object3D[] = [];
  private caps: THREE.MeshStandardMaterial[] = [];
  private spinners: { o: THREE.Object3D; w: number; bob?: number }[] = [];
  private sparks: { pos: THREE.BufferAttribute; speed: number[]; lo: number; hi: number }[] = [];

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
    const w = this.canvas.clientWidth || 1;
    // Exactly the row's width, so HTML columns under it line up with the pillars,
    // and exactly as tall as the tallest pillar with its beam and crown, so
    // nothing is cut off: the stage takes the height that needs.
    const half = (Math.max(1, this.count) * SPACING) / 2;
    this.camera.position.set(0, 8, 14);
    this.camera.lookAt(0, 2.1, 0);
    this.camera.updateMatrixWorld();
    const tallest = Math.max(1, ...this.heights);
    const inv = this.camera.matrixWorldInverse, v = new THREE.Vector3();
    let lo = Infinity, hi = -Infinity;
    const R = SPACING * 0.48;
    for (const [y, z] of [[0, R], [0, -R], [tallest + BEAM, R], [tallest + BEAM, -R], [tallest + CROWN_Y + 1.85, 0]]) {
      v.set(0, y, z).applyMatrix4(inv);
      lo = Math.min(lo, v.y); hi = Math.max(hi, v.y);
    }
    const pad = 0.3;
    this.camera.left = -half; this.camera.right = half;
    this.camera.top = hi + pad; this.camera.bottom = lo - pad;
    this.camera.updateProjectionMatrix();
    const h = Math.round((w * (hi - lo + pad * 2)) / (half * 2));
    const stage = this.canvas.parentElement;
    if (stage && this.count && stage.style.height !== `${h}px`) stage.style.height = `${h}px`;
    this.renderer.setSize(w, h || 1, false);
  }

  /** Shows these places (missing places simply have no pillar). */
  set(places: Place[]) {
    this.clear();
    const row = podiumOrder(places);
    this.count = row.length;
    this.heights = row.map((p) => HEIGHT[p.place] ?? 1);
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
        m.root.position.set(x, h + 0.04, 0);
        this.scene.add(m.root);
        this.cars.push({ m, spin: 0.6 + i * 0.9, y: h + 0.04, born: performance.now() + i * 120 });
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
   * One pillar, built to look like a trophy plinth: a soft pool of light and
   * light pool on the floor, a three-step base, a dark glass hex column with
   * metal corner pilasters, inset face panels and glowing grooves, bands of
   * light on the column, a metal collar and crown moulding, a glowing
   * cap, a short fading light beam with sparkles
   * drifting up. The place number sits in a medal on the front, and first
   * place gets a floating crown. Flat, cheap materials only: no shadows.
   */
  private pillar(place: number, h: number, col: THREE.Color) {
    const g = new THREE.Group();
    const R = 1.5, ap = R * Math.cos(Math.PI / 6), T = Math.PI / 6;
    const hex = (r: number, hh: number, y: number, r2 = r) => new THREE.CylinderGeometry(r2, r, hh, 6, 1).rotateY(T).translate(0, y + hh / 2, 0);
    const dark = new THREE.Color("#1a1735");
    const glowMat = (o: number, add = true) => {
      const m = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
      m.forceSinglePass = true;
      return m;
    };
    const metal = new THREE.MeshStandardMaterial({ color: col.clone().lerp(new THREE.Color("#e8edf7"), 0.55), metalness: 0.95, roughness: 0.22, flatShading: true });
    const steel = new THREE.MeshStandardMaterial({ color: "#c9d3e2", metalness: 0.9, roughness: 0.25, flatShading: true });
    this.bits.mat.push(metal, steel);

    // Floor: a soft round pool of light, inside this pillar's own slot.
    g.add(this.mesh(new THREE.CircleGeometry(SPACING * 0.48, 40).rotateX(-Math.PI / 2).translate(0, 0.004, 0),
      new THREE.MeshBasicMaterial({ color: col, alphaMap: poolTexture(), transparent: true, opacity: 0.35, depthWrite: false })));

    // Three-step base with a lit seam on each step.
    const plinthM = new THREE.MeshStandardMaterial({ color: "#121027", metalness: 0.75, roughness: 0.35, flatShading: true });
    this.bits.mat.push(plinthM);
    const seam = glowMat(0.8);
    let y = 0;
    for (const [r, hh] of [[R + 0.55, 0.14], [R + 0.32, 0.12], [R + 0.14, 0.1]] as const) {
      g.add(this.mesh(hex(r, hh, y, r - 0.06), plinthM));
      g.add(this.mesh(hex(r - 0.055, 0.025, y + hh), seam));
      y += hh;
    }
    const y0 = y, bh = Math.max(0.5, h - y0 - 0.42);

    // The column, its lit edges, inset panels and grooves.
    const body = hex(R, bh, y0);
    g.add(this.mesh(body, new THREE.MeshStandardMaterial({ color: dark, metalness: 0.6, roughness: 0.28, emissive: col, emissiveIntensity: 0.06, flatShading: true })));
    const edges = new THREE.EdgesGeometry(body, 20);
    g.add(new THREE.LineSegments(edges, this.keep(new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.7 }), edges)));
    const panelM = new THREE.MeshStandardMaterial({ color: dark.clone().multiplyScalar(0.6), metalness: 0.4, roughness: 0.5, emissive: col, emissiveIntensity: 0.04 });
    this.bits.mat.push(panelM);
    const grooveM = glowMat(0.75);
    const side = R; // face width of a regular hexagon
    for (let k = -1; k <= 1; k++) {
      const a = k * (Math.PI / 3);
      // Inset panel (the front one frames the medal).
      g.add(this.mesh(new THREE.PlaneGeometry(side * 0.72, bh * 0.78).translate(0, y0 + bh / 2, ap + 0.006).rotateY(a), panelM));
      if (k !== 0) for (const dx of [-0.22, 0.22]) g.add(this.mesh(new THREE.PlaneGeometry(0.05, bh * 0.7).translate(dx, y0 + bh / 2, ap + 0.012).rotateY(a), grooveM));
    }
    // Corner pilasters: metal posts on the corners in view.
    for (let k = -2; k <= 1; k++) {
      const a = T + k * (Math.PI / 3) + Math.PI / 3;
      const post = new THREE.BoxGeometry(0.16, bh + 0.04, 0.16).translate(0, y0 + bh / 2, 0);
      const m = this.mesh(post, metal);
      m.position.set(Math.sin(a) * (R + 0.02), 0, Math.cos(a) * (R + 0.02));
      m.rotation.y = a;
      g.add(m);
    }
    // Bands of light climbing the column, one more for each place up.
    const bands = Math.max(1, 4 - Math.min(3, place - 1));
    for (let i = 0; i < bands; i++) {
      const by = y0 + bh * (0.12 + (0.76 * i) / Math.max(1, bands)) ;
      if (Math.abs(by - (y0 + bh * 0.5)) < Math.min(0.78, bh * 0.4) + 0.3) continue; // keep the medal clear
      g.add(this.mesh(hex(R + 0.025, 0.035, by), glowMat(0.55)));
    }

    // Collar, crown moulding and the glowing cap.
    g.add(this.mesh(hex(R + 0.06, 0.1, y0 + bh), steel));
    g.add(this.mesh(hex(R + 0.18, 0.12, y0 + bh + 0.1, R + 0.06), metal));
    const capM = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, metalness: 0.35, roughness: 0.2, flatShading: true });
    this.bits.mat.push(capM);
    this.caps.push(capM);
    g.add(this.mesh(hex(R + 0.18, 0.2, y0 + bh + 0.22, R + 0.02), capM));

    // The beam: a short fading shaft of light.
    const beamH = BEAM;
    const beamM = new THREE.MeshBasicMaterial({ color: col, alphaMap: fadeTexture(), transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    beamM.forceSinglePass = true;
    g.add(this.mesh(new THREE.CylinderGeometry(R * 1.02, R * 0.92, beamH, 24, 1, true).translate(0, h + beamH / 2, 0), beamM));
    // Sparkles drifting up through the beam (more for higher places).
    const n = [0, 60, 40, 30, 20, 16][place] ?? 16;
    const pos = new Float32Array(n * 3), seedArr: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R * 0.95;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 2] = Math.sin(a) * r; pos[i * 3 + 1] = h + Math.random() * beamH;
      seedArr.push(0.3 + Math.random() * 0.6);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pm = new THREE.PointsMaterial({ color: col.clone().lerp(new THREE.Color("#ffffff"), 0.5), size: 0.16, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.bits.geo.push(pg); this.bits.mat.push(pm);
    const pts = new THREE.Points(pg, pm); pts.frustumCulled = false;
    g.add(pts);
    this.sparks.push({ pos: pg.getAttribute("position") as THREE.BufferAttribute, speed: seedArr, lo: h, hi: h + beamH });

    // Hexagons of light rising up the beam, fading in and out.
    for (let i = 0; i < 3; i++) {
      const m = glowMat(0);
      const ring = this.mesh(new THREE.RingGeometry(R * 0.9, R * 0.97, 6, 1).rotateX(-Math.PI / 2).rotateY(T), m);
      g.add(ring);
      this.fx.push({ kind: "rise", o: ring, m, t: i / 3, rate: 0.32, base: h, span: beamH * 0.95, peak: 0.6 });
    }
    // Hexagons expanding out over the floor from the base, like a pulse.
    for (let i = 0; i < 2; i++) {
      const m = glowMat(0);
      const ring = this.mesh(new THREE.RingGeometry(0.9, 1, 6, 1).rotateX(-Math.PI / 2).rotateY(T).translate(0, 0.02, 0), m);
      g.add(ring);
      this.fx.push({ kind: "spread", o: ring, m, t: i / 2, rate: 0.4, base: R + 0.4, span: SPACING * 0.47 - (R + 0.4), peak: 0.9 });
    }
    // A sheen sweeping up the front face now and then.
    {
      const m = glowMat(0);
      const sheen = this.mesh(new THREE.PlaneGeometry(R * 0.95, 0.35).translate(0, 0, ap + 0.03), m);
      g.add(sheen);
      this.fx.push({ kind: "sheen", o: sheen, m, t: Math.random(), rate: 0.22, base: y0, span: bh, peak: 0.28 });
    }
    // Motes orbiting the column.
    {
      const k = 14 + (6 - Math.min(5, place)) * 4;
      const op = new Float32Array(k * 3), orb: { a: number; r: number; y: number; w: number }[] = [];
      for (let i = 0; i < k; i++) orb.push({ a: Math.random() * Math.PI * 2, r: R + 0.35 + Math.random() * 0.25, y: 0.3 + Math.random() * (h - 0.2), w: (0.4 + Math.random() * 0.5) * (i % 2 ? 1 : -1) });
      const og = new THREE.BufferGeometry();
      og.setAttribute("position", new THREE.BufferAttribute(op, 3));
      const om = new THREE.PointsMaterial({ color: col.clone().lerp(new THREE.Color("#ffffff"), 0.35), size: 0.11, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      this.bits.geo.push(og); this.bits.mat.push(om);
      const pts = new THREE.Points(og, om); pts.frustumCulled = false;
      g.add(pts);
      this.orbits.push({ pos: og.getAttribute("position") as THREE.BufferAttribute, orb });
    }
    // Floating diamonds circling just above the cap.
    {
      const ring = new THREE.Group();
      const dm = new THREE.MeshStandardMaterial({ color: col.clone().lerp(new THREE.Color("#ffffff"), 0.4), emissive: col, emissiveIntensity: 0.8, metalness: 0.5, roughness: 0.15, flatShading: true });
      this.bits.mat.push(dm);
      const dg = new THREE.OctahedronGeometry(0.1).scale(0.8, 1.4, 0.8);
      this.bits.geo.push(dg);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2, d = new THREE.Mesh(dg, dm);
        d.position.set(Math.sin(a) * (R + 0.15), 0.35 + (i % 2) * 0.15, Math.cos(a) * (R + 0.15));
        ring.add(d);
      }
      ring.position.y = h;
      g.add(ring);
      this.spinners.push({ o: ring, w: 0.6 });
    }

    // The place number in a medal on the front.
    const md = Math.min(0.78, bh * 0.4);
    const my = y0 + bh * 0.5;
    g.add(this.mesh(new THREE.CircleGeometry(md + 0.12, 32).translate(0, my, ap + 0.014), metal));
    g.add(this.mesh(new THREE.RingGeometry(md + 0.16, md + 0.22, 32).translate(0, my, ap + 0.016), glowMat(0.9)));
    g.add(this.mesh(new THREE.CircleGeometry(md, 32).translate(0, my, ap + 0.018), new THREE.MeshBasicMaterial({ color: dark.clone().lerp(col, 0.22) })));
    const tex = numberTexture(place, `#${col.getHexString()}`);
    this.bits.tex.push(tex);
    g.add(this.mesh(new THREE.PlaneGeometry(md * 1.7, md * 1.7).translate(0, my, ap + 0.022), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })));

    // First place: a crown floating over the car.
    if (place === 1) {
      // A slowly turning starburst behind the crown.
      const sm = new THREE.MeshBasicMaterial({ color: "#ffd24a", map: burstTexture(), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
      const burst = this.mesh(new THREE.PlaneGeometry(2.4, 2.4), sm);
      burst.position.set(0, h + CROWN_Y + 0.3, -0.4);
      burst.lookAt(0, h + CROWN_Y + 8, 14); // face the camera (see resize)
      g.add(burst);
      this.bursts.push(burst);
    }
    if (place === 1) { const crown = this.crown(); crown.position.y = h + CROWN_Y; g.add(crown); this.spinners.push({ o: crown, w: 0.7, bob: h + CROWN_Y }); }
    return g;
  }


  /**
   * A solid gold crown: a closed band with a lit rim, five points tipped with
   * pearls, a ruby on the front and a velvet cap inside. Every part is closed
   * or two-sided, so nothing disappears as it turns.
   */
  private crown() {
    const c = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({ color: "#ffcf3d", emissive: "#ff9d00", emissiveIntensity: 0.35, metalness: 0.95, roughness: 0.18, flatShading: true, side: THREE.DoubleSide });
    const pearl = new THREE.MeshStandardMaterial({ color: "#fff6e0", emissive: "#fff0c0", emissiveIntensity: 0.4, roughness: 0.3 });
    const velvet = new THREE.MeshStandardMaterial({ color: "#a0122f", roughness: 0.9 });
    const ruby = new THREE.MeshStandardMaterial({ color: "#ff2a55", emissive: "#ff1040", emissiveIntensity: 0.7, metalness: 0.2, roughness: 0.1, flatShading: true });
    const sapphire = new THREE.MeshStandardMaterial({ color: "#3dc8ff", emissive: "#2090ff", emissiveIntensity: 0.6, roughness: 0.1, flatShading: true });
    this.bits.mat.push(gold, pearl, velvet, ruby, sapphire);
    // Band: a thick ring with a top and bottom rim.
    c.add(this.mesh(new THREE.CylinderGeometry(0.62, 0.56, 0.34, 40, 1, true), gold));
    c.add(this.mesh(new THREE.TorusGeometry(0.57, 0.05, 8, 40).rotateX(Math.PI / 2).translate(0, -0.17, 0), gold));
    c.add(this.mesh(new THREE.TorusGeometry(0.63, 0.045, 8, 40).rotateX(Math.PI / 2).translate(0, 0.17, 0), gold));
    // Velvet cap inside.
    c.add(this.mesh(new THREE.SphereGeometry(0.55, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.05, 0), velvet));
    // Five points with pearls, and gems between them on the band.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const pt = this.mesh(new THREE.ConeGeometry(0.15, 0.42, 4).translate(0, 0.38, 0), gold);
      pt.position.set(Math.sin(a) * 0.6, 0, Math.cos(a) * 0.6);
      pt.rotation.y = a;
      c.add(pt);
      const p = this.mesh(new THREE.SphereGeometry(0.075, 12, 8), pearl);
      p.position.set(Math.sin(a) * 0.6, 0.63, Math.cos(a) * 0.6);
      c.add(p);
      const b = a + Math.PI / 5;
      const gem = this.mesh(new THREE.OctahedronGeometry(i === 0 ? 0.11 : 0.075).scale(1, 1.3, 0.6), i === 0 ? ruby : sapphire);
      gem.position.set(Math.sin(b) * 0.63, 0, Math.cos(b) * 0.63);
      gem.rotation.y = b;
      c.add(gem);
    }
    // An orb on top.
    c.add(this.mesh(new THREE.SphereGeometry(0.1, 16, 10).translate(0, 0.5, 0), gold));
    c.scale.setScalar(1.25);
    c.traverse((o) => { o.frustumCulled = false; });
    return c;
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
    this.caps = []; this.spinners = []; this.fx = []; this.orbits = []; this.bursts = []; this.sparks = [];
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
    for (const s of this.spinners) {
      s.o.rotation.y += s.w * dt;
      if (s.bob !== undefined) s.o.position.y = s.bob + Math.sin(now / 600) * 0.12;
    }
    for (const f of this.fx) {
      f.t = (f.t + dt * f.rate) % 1;
      const fade = Math.sin(f.t * Math.PI);
      if (f.kind === "rise") { f.o.position.y = f.base + f.t * f.span; f.m.opacity = f.peak * fade; }
      else if (f.kind === "spread") { f.o.scale.setScalar(f.base + f.t * f.span); f.m.opacity = f.peak * (1 - f.t) ** 1.5; }
      else { // the sheen runs in the first third of its cycle, then rests
        const k = Math.min(1, f.t * 3);
        f.o.position.y = f.base + k * f.span;
        f.m.opacity = f.t < 1 / 3 ? f.peak * Math.sin(k * Math.PI) : 0;
      }
    }
    for (const ob of this.orbits) {
      const a = ob.pos.array as Float32Array;
      ob.orb.forEach((o, i) => {
        o.a += o.w * dt;
        a[i * 3] = Math.sin(o.a) * o.r; a[i * 3 + 1] = o.y + Math.sin(now / 900 + i) * 0.08; a[i * 3 + 2] = Math.cos(o.a) * o.r;
      });
      ob.pos.needsUpdate = true;
    }
    for (const b of this.bursts) b.rotateZ(dt * 0.25);
    for (const sp of this.sparks) {
      const a = sp.pos.array as Float32Array;
      for (let i = 0; i < sp.speed.length; i++) {
        let y = a[i * 3 + 1] + sp.speed[i] * dt;
        if (y > sp.hi) y = sp.lo;
        a[i * 3 + 1] = y;
      }
      sp.pos.needsUpdate = true;
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
