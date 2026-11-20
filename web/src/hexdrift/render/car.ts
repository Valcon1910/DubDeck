// The cars: original, detailed low-poly racers (no real brands), built from
// the garage look. Every body has the same wheels and hitbox.
// Fast to draw: the fixed parts are merged into one mesh per material, and
// the four wheels share their geometry (about 20 draw calls a car).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DEFAULT_LOOK, itemOf, type BodyDef, type Item, type Look, type Profile2D } from "../garage.ts";

export interface CarModel {
  root: THREE.Group;
  /** Tilt/position is set on root; wheels spin and steer; brake lights glow. */
  update(speed: number, steer: number, dt: number, braking?: boolean): void;
  setBoost(on: boolean): void;
  dispose(): void;
}

export interface CarOptions {
  look?: Look;
  /** The map's colour, used when the accent is set to "Map colour". */
  mapAccent?: string;
  /** false: a normal car; "pb": the see-through ghost of your best; "wr": the world record's gold ghost. */
  ghost?: false | "pb" | "wr";
  /** Shown above the world-record ghost. */
  label?: string;
}

/** An outline with rounded corners (u = forward, v = up). */
function rounded(pts: Profile2D, r: number): THREE.Shape {
  const sh = new THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const rr = Math.min(r, la * 0.4, lb * 0.4);
    const p1x = p[0] + (a[0] - p[0]) * (rr / la), p1y = p[1] + (a[1] - p[1]) * (rr / la);
    const p2x = p[0] + (b[0] - p[0]) * (rr / lb), p2y = p[1] + (b[1] - p[1]) * (rr / lb);
    if (i === 0) sh.moveTo(p1x, p1y); else sh.lineTo(p1x, p1y);
    sh.quadraticCurveTo(p[0], p[1], p2x, p2y);
  }
  sh.closePath();
  return sh;
}

/** Extrudes a side outline across the car (half width W) with soft, bevelled edges. */
function body(pts: Profile2D, W: number, r = 0.22, bevel = 0.12): THREE.BufferGeometry {
  const t = Math.min(bevel, W * 0.4);
  const g = new THREE.ExtrudeGeometry(rounded(pts, r), {
    depth: 2 * W - 2 * t, bevelEnabled: true, bevelThickness: t, bevelSize: t * 0.6, bevelSegments: 3, curveSegments: 5,
  });
  g.rotateY(-Math.PI / 2);
  g.translate(W - t, 0, 0);
  return g;
}

/** Height of the outline's top surface at z. */
function topAt(pts: Profile2D, z: number) {
  let y = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
    if (z < lo || z > hi || hi === lo) continue;
    y = Math.max(y, a[1] + (b[1] - a[1]) * ((z - a[0]) / (b[0] - a[0])));
  }
  return y;
}

const colorOf = (slot: "paint" | "accent" | "rims" | "trail", id: string) => (itemOf(slot, id) as Item).color;
const WHEELS: [number, number][] = [[1.08, 1.45], [-1.08, 1.45], [1.1, -1.35], [-1.1, -1.35]];

type Part = "paint" | "accent" | "trim" | "glass" | "lamp" | "tail" | "metal";

/** Wheel parts (built once, shared by every car). */
let wheelKit: { tire: THREE.BufferGeometry; rimR: THREE.BufferGeometry; rimL: THREE.BufferGeometry; disc: THREE.BufferGeometry; caliper: THREE.BufferGeometry } | null = null;
function wheels() {
  if (wheelKit) return wheelKit;
  const tire = (() => {
    // Rounded tyre: a lathe of the cross-section.
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = -Math.PI / 2 + (i / 8) * Math.PI;
      pts.push(new THREE.Vector2(0.4 + Math.cos(a) * 0.08, Math.sin(a) * 0.21));
    }
    const g = new THREE.LatheGeometry(pts, 22);
    g.rotateZ(Math.PI / 2);
    return g;
  })();
  const rim = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const lip = new THREE.TorusGeometry(0.33, 0.035, 6, 22); lip.rotateY(Math.PI / 2); lip.translate(0.16, 0, 0); parts.push(lip);
    const barrel = new THREE.CylinderGeometry(0.32, 0.32, 0.3, 22, 1, true); barrel.rotateZ(Math.PI / 2); barrel.translate(0.02, 0, 0); parts.push(barrel);
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.BoxGeometry(0.05, 0.3, 0.075);
      sp.translate(0, 0.16, 0); sp.rotateX((i / 5) * Math.PI * 2); sp.translate(0.15, 0, 0);
      parts.push(sp);
    }
    const hub = new THREE.CylinderGeometry(0.075, 0.09, 0.08, 10); hub.rotateZ(Math.PI / 2); hub.translate(0.17, 0, 0); parts.push(hub);
    return merge(parts);
  })();
  const rimL = rim.clone(); rimL.scale(-1, 1, 1);
  const disc = new THREE.CylinderGeometry(0.27, 0.27, 0.03, 20); disc.rotateZ(Math.PI / 2);
  const caliper = new THREE.BoxGeometry(0.1, 0.2, 0.14); caliper.translate(0.03, 0.17, -0.12);
  wheelKit = { tire, rimR: rim, rimL, disc, caliper };
  return wheelKit;
}

/** Merges parts into one geometry (positions and normals only). */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== "position" && k !== "normal") n.deleteAttribute(k);
    if (!n.attributes.normal) n.computeVertexNormals();
    if (n !== g) g.dispose();
    return n;
  });
  const out = mergeGeometries(clean, false)!;
  for (const g of clean) g.dispose();
  return out;
}

let roundelTex: THREE.CanvasTexture | null = null;
function roundel() {
  if (roundelTex) return roundelTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  x.fillStyle = "#ffffff"; x.beginPath(); x.arc(32, 32, 30, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#14161f"; x.font = "900 34px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText("7", 32, 34);
  roundelTex = new THREE.CanvasTexture(c);
  roundelTex.colorSpace = THREE.SRGBColorSpace;
  return roundelTex;
}

export function buildCar(opts: CarOptions = {}): CarModel {
  const look = opts.look ?? DEFAULT_LOOK;
  const ghost = opts.ghost ?? false;
  const def = itemOf("body", look.body) as BodyDef;
  const W = def.w, pts = def.pts;
  const front = Math.max(...pts.map((p) => p[0])), rear = Math.min(...pts.map((p) => p[0]));
  const color = colorOf("paint", look.paint) ?? "#e8edf7";
  const accent = colorOf("accent", look.accent) ?? opts.mapAccent ?? "#7af7ff";
  const rimColor = look.rims === "accent" ? accent : colorOf("rims", look.rims) ?? accent;
  const trail = look.trail === "rainbow" ? null : colorOf("trail", look.trail) ?? "#7af7ff";

  const root = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const disposers: (() => void)[] = [];
  const keep = <M extends THREE.Material>(m: M) => { mats.push(m); return m; };

  // Materials. Ghosts are one see-through material (cheap and readable).
  const ghostM = ghost === "pb"
    ? keep(new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#8a93a8", transparent: true, opacity: 0.3, depthWrite: false }))
    : ghost === "wr"
      ? keep(new THREE.MeshPhongMaterial({ color: "#ffd34d", emissive: "#7a4d00", specular: "#fff2b0", shininess: 60, transparent: true, opacity: 0.62, depthWrite: false }))
      : null;
  const chrome = look.paint === "chrome", obsidian = look.paint === "obsidian";
  const M: Record<Part, THREE.Material> = ghostM
    ? { paint: ghostM, accent: ghostM, trim: ghostM, glass: ghostM, lamp: ghostM, tail: ghostM, metal: ghostM }
    : {
      paint: keep(new THREE.MeshPhongMaterial({ color, specular: chrome ? "#ffffff" : "#6a6a6a", shininess: chrome ? 140 : 70, emissive: obsidian ? "#0b0820" : "#000000", side: THREE.DoubleSide })),
      accent: keep(new THREE.MeshPhongMaterial({ color: accent, specular: "#444444", shininess: 40, side: THREE.DoubleSide })),
      trim: keep(new THREE.MeshLambertMaterial({ color: "#16181f", side: THREE.DoubleSide })),
      glass: keep(new THREE.MeshPhongMaterial({ color: "#0d1426", specular: "#cfe3ff", shininess: 120, emissive: "#05070d" })),
      lamp: keep(new THREE.MeshBasicMaterial({ color: "#f4f8ff" })),
      tail: keep(new THREE.MeshBasicMaterial({ color: "#8a1020" })),
      metal: keep(new THREE.MeshPhongMaterial({ color: "#8d94a3", specular: "#ffffff", shininess: 90 })),
    };
  const parts: Record<Part, THREE.BufferGeometry[]> = { paint: [], accent: [], trim: [], glass: [], lamp: [], tail: [], metal: [] };
  const put = (k: Part, g: THREE.BufferGeometry) => parts[k].push(g);
  const box = (k: Part, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    put(k, g);
  };
  const both = (fn: (s: number) => void) => { fn(1); fn(-1); };

  // ── Body ──
  put("paint", body(pts, W));
  // Fenders arching over each wheel.
  for (const [x, z] of WHEELS) {
    const f = new THREE.CylinderGeometry(0.64, 0.64, 0.5, 14, 1, true, 0, Math.PI);
    f.rotateZ(Math.PI / 2); f.translate(x * 0.98, 0.48, z);
    put("paint", f);
  }
  // Side skirts, front splitter, rear diffuser with fins.
  both((s) => box("trim", 0.1, 0.1, front - rear - 1.6, s * (W + 0.02), 0.34, (front + rear) / 2 + 0.05));
  box("trim", W * 2 + 0.1, 0.06, 0.4, 0, 0.28, front - 0.1);
  box("trim", W * 1.6, 0.14, 0.4, 0, 0.36, rear + 0.15);
  for (let i = -2; i <= 2; i++) box("trim", 0.04, 0.22, 0.4, i * 0.3, 0.42, rear + 0.12);
  // Grille and side intakes.
  const noseY = Math.max(0.42, topAt(pts, front - 0.1) - 0.12);
  box("trim", W * 1.1, 0.12, 0.06, 0, Math.min(noseY, 0.5), front + 0.06);
  both((s) => box("trim", 0.03, 0.16, 0.62, s * (W + 0.03), 0.62, -0.55));

  // ── Lights ──
  const hy = topAt(pts, front - 0.25) - 0.06;
  both((s) => {
    box("lamp", 0.42, 0.08, 0.12, s * (W - 0.32), hy, front - 0.12, 0.25);
    box("trim", 0.5, 0.13, 0.1, s * (W - 0.32), hy - 0.02, front - 0.16, 0.25);
  });
  const ty = Math.max(0.55, topAt(pts, rear + 0.1) - 0.14);
  both((s) => box("tail", 0.5, 0.09, 0.05, s * (W - 0.32), ty, rear - 0.07));
  box("tail", W * 0.9, 0.03, 0.04, 0, ty, rear - 0.07);

  // ── Cabin ──
  if (def.cab) {
    const c = def.cab, k = c.s;
    const base = c.y - 0.42 * k, top = c.y + 0.26 * k;
    const Wc = W * 0.74 * k;
    const zr = c.z - 1.0 * k, zf = c.z + 1.15 * k, ztf = c.z + 0.25 * k, ztr = c.z - 0.6 * k;
    // The cabin in body colour...
    put("paint", body([[zr, base], [zf, base], [ztf, top], [ztr, top]], Wc, 0.12, 0.08));
    // ...with side windows set into it (pillars left in paint around them)...
    const inset = 0.11 * k;
    const win: Profile2D = [[zr + inset * 2.2, base + 0.12], [zf - inset * 3.2, base + 0.12], [ztf - inset * 0.4, top - inset * 0.8], [ztr + inset * 0.6, top - inset * 0.8]];
    put("glass", body(win, Wc + 0.012, 0.05, 0.001));
    // ...a raked windscreen and a rear window.
    const slope = (za: number, ya: number, zb: number, yb: number, w: number) => {
      const g = new THREE.BoxGeometry(w, 0.02, Math.hypot(zb - za, yb - ya) * 0.86);
      g.rotateX(-Math.atan2(yb - ya, zb - za));
      g.translate(0, (ya + yb) / 2 + 0.035, (za + zb) / 2);
      put("glass", g);
    };
    slope(zf, base, ztf, top, Wc * 1.62);
    slope(zr, base, ztr, top, Wc * 1.5);
    // Mirrors.
    both((s) => {
      box("trim", 0.22, 0.04, 0.05, s * (W * 0.78 * k + 0.08), base + 0.08, c.z + 0.75 * k);
      box("paint", 0.14, 0.12, 0.2, s * (W * 0.78 * k + 0.2), base + 0.12, c.z + 0.72 * k);
    });
  } else {
    // Boxy cars: windscreen and side windows set into the body.
    const t = topAt(pts, 0);
    box("glass", W * 1.7, 0.42, 0.05, 0, t - 0.32, 0.95, -0.55);
    both((s) => box("glass", 0.03, 0.34, 1.5, s * (W + 0.005), t - 0.3, -0.3));
    both((s) => {
      box("trim", 0.22, 0.04, 0.05, s * (W + 0.1), t - 0.45, 0.7);
      box("paint", 0.14, 0.14, 0.2, s * (W + 0.22), t - 0.42, 0.68);
    });
  }

  // ── Accent: nose stripe and wing ──
  const n0 = topAt(pts, 0.1), n1 = topAt(pts, front - 0.35);
  const len = front - 0.45;
  const stripe = new THREE.BoxGeometry(0.34, 0.025, len);
  stripe.rotateX(-Math.atan2(n1 - n0, len)); stripe.translate(0, (n0 + n1) / 2 + 0.03, 0.1 + len / 2);
  put("accent", stripe);
  const rearTop = topAt(pts, -1.9);
  const wingPlane = (y: number, d: number, tilt: number) => {
    const g = body([[-d / 2, -0.04], [d / 2, -0.03], [d / 2 - 0.05, 0.04], [-d / 2, 0.05]], 1.18, 0.02, 0.03);
    g.rotateX(tilt); g.translate(0, y, -1.95);
    put("accent", g);
    both((s) => box("trim", 0.03, 0.24, 0.52, s * 1.2, y + 0.04, -1.95)); // end plates
  };
  if (look.wing === "high" || look.wing === "twin") {
    const y = rearTop + 0.45;
    wingPlane(y, 0.5, 0.08);
    if (look.wing === "twin") wingPlane(y + 0.28, 0.38, 0.12);
    both((s) => box("trim", 0.05, 0.44, 0.14, s * 0.62, rearTop + 0.2, -1.85));
  } else if (look.wing === "swan") {
    const y = rearTop + 0.72;
    wingPlane(y, 0.55, 0.06);
    both((s) => box("trim", 0.06, 0.78, 0.14, s * 0.5, rearTop + 0.42, -1.72, -0.45));
  } else if (look.wing === "low") {
    box("accent", W * 2, 0.07, 0.3, 0, rearTop + 0.05, rear + 0.12, 0.35);
  }

  // ── Roof extras ──
  const rz = def.cab ? def.cab.z - 0.17 * def.cab.s : 0;
  const roofY = def.cab ? def.cab.y + 0.32 * def.cab.s : topAt(pts, 0) + 0.02;
  if (look.extra === "antenna") {
    const ay = topAt(pts, -1.4);
    const a = new THREE.CylinderGeometry(0.018, 0.03, 1.1, 5); a.rotateX(-0.25); a.translate(0.55, ay + 0.55, -1.5); put("trim", a);
    const tip = new THREE.SphereGeometry(0.07, 8, 6); tip.translate(0.55, ay + 1.08, -1.64); put("accent", tip);
  } else if (look.extra === "lights") {
    box("trim", 1.5, 0.12, 0.22, 0, roofY + 0.08, rz + 0.25);
    for (let i = -2; i <= 2; i++) box("lamp", 0.22, 0.08, 0.04, i * 0.28, roofY + 0.08, rz + 0.37);
  } else if (look.extra === "fin") {
    const fin = body([[-0.9, 0], [0.4, 0], [-0.55, 0.5], [-0.9, 0.45]], 0.035, 0.05, 0.02);
    fin.translate(0, roofY - 0.02, rz - 0.3);
    put("accent", fin);
  } else if (look.extra === "scoop") {
    const sc = body([[-0.5, 0], [0.5, 0], [0.35, 0.3], [-0.2, 0.32]], 0.32, 0.08, 0.05);
    sc.translate(0, roofY - 0.04, rz + 0.05);
    put("paint", sc);
    box("trim", 0.5, 0.2, 0.04, 0, roofY + 0.12, rz + 0.5);
  }

  // Exhaust pipes.
  for (const x of [-0.32, 0.32]) {
    const p = new THREE.CylinderGeometry(0.09, 0.09, 0.3, 10); p.rotateX(Math.PI / 2); p.translate(x, 0.47, rear - 0.05); put("metal", p);
  }

  // Merge each material's parts into one mesh.
  for (const k of Object.keys(parts) as Part[]) {
    if (!parts[k].length) continue;
    const g = merge(parts[k]);
    geos.push(g);
    root.add(new THREE.Mesh(g, M[k]));
  }
  const tailM = M.tail as THREE.MeshBasicMaterial;

  // Race-number roundels on the doors.
  if (!ghost) {
    const rm = keep(new THREE.MeshBasicMaterial({ map: roundel(), transparent: true }));
    const rg = new THREE.PlaneGeometry(0.42, 0.42); geos.push(rg);
    both((s) => {
      const m = new THREE.Mesh(rg, rm);
      m.position.set(s * (W + 0.012), 0.66, 0.15);
      m.rotation.y = s * Math.PI / 2;
      root.add(m);
    });
  }

  // Glowing pipe ends and the boost flames.
  const glowM = keep(new THREE.MeshBasicMaterial({ color: "#ff9a3d", transparent: !!ghost, opacity: ghost ? 0.3 : 1 }));
  const flameM = keep(new THREE.MeshBasicMaterial({ color: trail ?? "#ff5fd2", transparent: true, opacity: ghost ? 0.3 : 0.85, depthWrite: false }));
  const endG = new THREE.CircleGeometry(0.065, 10); endG.rotateY(Math.PI); geos.push(endG);
  const flameG = new THREE.ConeGeometry(0.17, 1.3, 8); flameG.rotateX(-Math.PI / 2); geos.push(flameG);
  const flames: THREE.Mesh[] = [];
  for (const x of [-0.32, 0.32]) {
    const e = new THREE.Mesh(endG, glowM); e.position.set(x, 0.47, rear - 0.21); root.add(e);
    const f = new THREE.Mesh(flameG, flameM); f.position.set(x, 0.47, rear - 0.86); f.visible = false; root.add(f);
    flames.push(f);
  }
  let hue = 0;

  // ── Wheels: tyre, spoked rim and brake disc spin; the caliper doesn't ──
  const kit = wheels();
  const tyreM = ghostM ?? keep(new THREE.MeshLambertMaterial({ color: "#17171c" }));
  const rimM = ghostM ?? (look.rims === "neon"
    ? keep(new THREE.MeshBasicMaterial({ color: rimColor, side: THREE.DoubleSide }))
    : keep(new THREE.MeshPhongMaterial({ color: rimColor, specular: "#ffffff", shininess: 100, side: THREE.DoubleSide })));
  const wheelList: { pivot: THREE.Group; spin: THREE.Group; front: boolean }[] = [];
  for (const [x, z] of WHEELS) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.48, z);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(kit.tire, tyreM));
    spin.add(new THREE.Mesh(x > 0 ? kit.rimR : kit.rimL, rimM));
    if (!ghost) {
      const disc = new THREE.Mesh(kit.disc, M.metal); disc.position.x = x > 0 ? -0.04 : 0.04; spin.add(disc);
      const cal = new THREE.Mesh(kit.caliper, M.accent); cal.position.x = x > 0 ? 0 : -0.06; pivot.add(cal);
    }
    pivot.add(spin);
    root.add(pivot);
    wheelList.push({ pivot, spin, front: z > 0 });
  }

  if (ghost === "wr") {
    // A crown floating over the cockpit: a band with five points.
    const crownM = keep(new THREE.MeshBasicMaterial({ color: "#ffcf3a" }));
    const band = new THREE.CylinderGeometry(0.5, 0.45, 0.28, 10, 1, true); band.translate(0, 2.05, -0.3); geos.push(band);
    root.add(new THREE.Mesh(band, crownM));
    const tip = new THREE.ConeGeometry(0.13, 0.38, 4); geos.push(tip);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const m = new THREE.Mesh(tip, crownM);
      m.position.set(Math.sin(a) * 0.46, 2.36, -0.3 + Math.cos(a) * 0.46);
      root.add(m);
    }
    if (opts.label) {
      const sprite = nameTag(opts.label);
      sprite.position.set(0, 3.1, -0.3);
      root.add(sprite);
      disposers.push(() => { (sprite.material as THREE.SpriteMaterial).map?.dispose(); sprite.material.dispose(); });
    }
  }

  let roll = 0, steerAngle = 0, braking = false;
  return {
    root,
    update(speed, steer, dt, brake = false) {
      roll += (speed / 0.48) * dt;
      steerAngle += (-steer * 0.45 - steerAngle) * Math.min(1, dt * 12);
      for (const w of wheelList) {
        w.spin.rotation.x = roll;
        if (w.front) w.pivot.rotation.y = steerAngle;
      }
      if (!ghost && brake !== braking) { braking = brake; tailM.color.set(brake ? "#ff2a3d" : "#8a1020"); }
    },
    setBoost(on) {
      for (const f of flames) { f.visible = on; f.scale.z = on ? 0.8 + Math.random() * 0.5 : 1; }
      if (on && !trail && !ghost) { hue = (hue + 0.02) % 1; flameM.color.setHSL(hue, 1, 0.6); }
      glowM.color.set(on ? (trail ?? flameM.color.getStyle()) : "#ff9a3d");
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const d of disposers) d();
    },
  };
}

/** "👑 Name · 1:02.345" on a gold pill, always facing the camera. */
function nameTag(text: string): THREE.Sprite {
  const c = document.createElement("canvas");
  const x = c.getContext("2d")!;
  const font = "600 30px system-ui, sans-serif";
  x.font = font;
  const w = Math.min(512, Math.ceil(x.measureText(text).width) + 36);
  c.width = w; c.height = 48;
  x.font = font;
  x.fillStyle = "rgba(40,28,0,0.78)";
  x.beginPath(); x.roundRect(0, 0, w, 48, 24); x.fill();
  x.fillStyle = "#ffd34d";
  x.textBaseline = "middle"; x.textAlign = "center";
  x.fillText(text, w / 2, 25, w - 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set((w / 48) * 0.9, 0.9, 1);
  return s;
}

/** A soft round shadow under the car (a canvas texture, no shadow maps). */
export function blobShadow() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const geo = new THREE.PlaneGeometry(3.4, 5.4);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, dispose() { tex.dispose(); geo.dispose(); mat.dispose(); } };
}
