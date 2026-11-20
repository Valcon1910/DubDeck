// The car: an original low-poly wedge racer (no real brands). Same hitbox for
// every look; skins come later. A few meshes, shared geometry.
import * as THREE from "three";

export interface CarModel {
  root: THREE.Group;
  /** Tilt/position is set on root; wheels spin and steer. */
  update(speed: number, steer: number, dt: number): void;
  setBoost(on: boolean): void;
  dispose(): void;
}

function wedge(): THREE.BufferGeometry {
  // Profile from the side (z forward, y up), extruded across x.
  const W = 1.05; // half width
  const pts: [number, number][] = [
    [-2.1, 0.35], [2.25, 0.3], [2.3, 0.55], [0.7, 0.85], [-1.6, 0.95], [-2.15, 0.85],
  ];
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  // sides
  for (const s of [1, -1]) {
    for (let i = 1; i < pts.length - 1; i++) {
      const [a, b, c] = [pts[0], pts[i], pts[i + 1]];
      const tri = [[s * W, a[1], a[0]], [s * W, b[1], b[0]], [s * W, c[1], c[0]]];
      if (s > 0) pos.push(...tri[0], ...tri[2], ...tri[1]);
      else pos.push(...tri[0], ...tri[1], ...tri[2]);
    }
  }
  // around the outline
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    quad([W, a[1], a[0]], [W, b[1], b[0]], [-W, b[1], b[0]], [-W, a[1], a[0]]);
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function buildCar(color: string, accent: string, ghost = false): CarModel {
  const root = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const mat = (c: string, emissive = "#000000") => {
    const m = ghost
      ? new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#8a93a8", transparent: true, opacity: 0.32, depthWrite: false, flatShading: true })
      : new THREE.MeshLambertMaterial({ color: c, emissive, flatShading: true, side: THREE.DoubleSide });
    mats.push(m);
    return m;
  };

  const body = wedge(); geos.push(body);
  root.add(new THREE.Mesh(body, mat(color)));

  // Cockpit canopy.
  const cab = new THREE.CylinderGeometry(0.0, 0.75, 1.5, 4, 1);
  cab.rotateY(Math.PI / 4); cab.scale(1, 0.55, 1.6); cab.translate(0, 1.15, -0.45);
  geos.push(cab);
  root.add(new THREE.Mesh(cab, mat("#14161f")));

  // Rear wing.
  const wing = new THREE.BoxGeometry(2.3, 0.08, 0.5); wing.translate(0, 1.35, -1.95); geos.push(wing);
  const strut = new THREE.BoxGeometry(0.1, 0.45, 0.25); geos.push(strut);
  const wingM = mat(accent);
  root.add(new THREE.Mesh(wing, wingM));
  for (const x of [-0.7, 0.7]) { const s = new THREE.Mesh(strut, wingM); s.position.set(x, 1.1, -1.9); root.add(s); }

  // Stripe on the nose.
  const stripe = new THREE.BoxGeometry(0.35, 0.02, 2.2); stripe.translate(0, 0.86, 0.9); stripe.rotateX(-0.12);
  geos.push(stripe);
  root.add(new THREE.Mesh(stripe, wingM));

  // Glowing exhaust (brighter while boosting).
  const glowM = new THREE.MeshBasicMaterial({ color: "#ff9a3d" }); mats.push(glowM);
  const ex = new THREE.BoxGeometry(0.5, 0.18, 0.06); ex.translate(0, 0.55, -2.14); geos.push(ex);
  const exhaust = new THREE.Mesh(ex, glowM);
  root.add(exhaust);
  const flameG = new THREE.ConeGeometry(0.28, 1.6, 6); flameG.rotateX(-Math.PI / 2); flameG.translate(0, 0.55, -2.95); geos.push(flameG);
  const flameM = new THREE.MeshBasicMaterial({ color: "#7af7ff", transparent: true, opacity: 0.85 }); mats.push(flameM);
  const flame = new THREE.Mesh(flameG, flameM);
  if (ghost) { glowM.transparent = true; glowM.opacity = 0.3; flameM.opacity = 0.3; }
  flame.visible = false;
  root.add(flame);

  // Wheels.
  const wg = new THREE.CylinderGeometry(0.48, 0.48, 0.42, 10); wg.rotateZ(Math.PI / 2); geos.push(wg);
  const wm = mat("#1a1a1f");
  const hubG = new THREE.CylinderGeometry(0.22, 0.22, 0.44, 6); hubG.rotateZ(Math.PI / 2); geos.push(hubG);
  const hm = mat(accent);
  const wheels: { pivot: THREE.Group; spin: THREE.Group; front: boolean }[] = [];
  for (const [x, z] of [[1.08, 1.45], [-1.08, 1.45], [1.1, -1.35], [-1.1, -1.35]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.48, z);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(wg, wm));
    const hub = new THREE.Mesh(hubG, hm); spin.add(hub);
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin, front: z > 0 });
  }

  let roll = 0, steerAngle = 0;
  return {
    root,
    update(speed, steer, dt) {
      roll += (speed / 0.48) * dt;
      steerAngle += (-steer * 0.45 - steerAngle) * Math.min(1, dt * 12);
      for (const w of wheels) {
        w.spin.rotation.x = roll;
        if (w.front) w.pivot.rotation.y = steerAngle;
      }
    },
    setBoost(on) {
      flame.visible = on;
      flame.scale.z = on ? 0.8 + Math.random() * 0.5 : 1;
      glowM.color.set(on ? "#7af7ff" : "#ff9a3d");
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
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
