// The garage's 3D turntable: one car on a lit stage. Drag to spin it; it
// turns slowly on its own. Draws only while the garage is open and visible.
import * as THREE from "three";
import { buildCar, type CarModel } from "./car.ts";
import { itemOf, type Item, type Look } from "../garage.ts";
import { FinishFx, Trail, trailDef, type FinishKind } from "./fx.ts";

export class Preview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.5, 100);
  private car: CarModel | null = null;
  private stage: THREE.Mesh;
  private ring: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private ro: ResizeObserver;
  private raf = 0;
  private yaw = 0.7;
  private spinV = 0.25;
  private drag: { x: number; t: number } | null = null;
  private boostUntil = 0;
  private trail: Trail | null = null;
  private fx = new FinishFx();
  private last = performance.now();

  constructor(host: HTMLElement) {
    const canvas = document.createElement("canvas");
    canvas.className = "hx-preview-canvas";
    host.prepend(canvas);
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight("#cfd8ff", "#2a2140", 1.6));
    const key = new THREE.DirectionalLight("#ffffff", 2.2); key.position.set(4, 7, 5); this.scene.add(key);
    const rim = new THREE.DirectionalLight("#7af7ff", 1.1); rim.position.set(-5, 3, -6); this.scene.add(rim);
    const g = new THREE.CircleGeometry(4.2, 48); g.rotateX(-Math.PI / 2);
    this.stage = new THREE.Mesh(g, new THREE.MeshPhongMaterial({ color: "#1b1833", specular: "#3a3560", shininess: 30 }));
    this.scene.add(this.stage);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(4.1, 4.25, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#7a5cff" }));
    this.ring.position.y = 0.01;
    this.scene.add(this.ring);
    this.scene.add(this.fx.group);
    this.camera.position.set(0, 2.6, 8.2);
    this.camera.lookAt(0, 0.65, 0);

    canvas.addEventListener("pointerdown", this.down);
    window.addEventListener("pointermove", this.move);
    window.addEventListener("pointerup", this.up);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    const loop = (now: number) => { this.raf = requestAnimationFrame(loop); if (!document.hidden) this.frame(now); };
    this.raf = requestAnimationFrame(loop);
  }

  private down = (e: PointerEvent) => { this.drag = { x: e.clientX, t: performance.now() }; this.spinV = 0; };
  private move = (e: PointerEvent) => {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x, now = performance.now();
    this.yaw += dx * 0.01;
    this.spinV = (dx * 0.01) / Math.max(0.016, (now - this.drag.t) / 1000);
    this.drag = { x: e.clientX, t: now };
  };
  private up = () => { this.drag = null; };

  private resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole car (the truck is the longest) in view on narrow screens.
    const narrow = w / h < 1.2;
    this.camera.fov = narrow ? 40 : 34;
    this.camera.position.set(0, narrow ? 3 : 2.6, narrow ? 10.5 : 8.6);
    this.camera.lookAt(0, 0.7, 0);
    this.camera.updateProjectionMatrix();
  }

  setLook(look: Look, mapAccent = "#7af7ff") {
    if (this.car) { this.scene.remove(this.car.root); this.car.dispose(); }
    this.car = buildCar({ look, mapAccent });
    this.scene.add(this.car.root);
    this.trail?.dispose();
    this.trail = new Trail(trailDef(itemOf("trail", look.trail) as Item));
    this.car.root.add(this.trail.mesh);
  }

  /** Shows the boost flame and trail for a moment (when picking a trail). */
  boost() { this.boostUntil = performance.now() + 2200; }

  /** Plays a finish effect around the car. */
  celebrate(kind: string) { this.fx.start(kind as FinishKind, 0, 0, 0, 0.32); }

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.drag) {
      // Spin settles back to a slow turn.
      this.spinV += (0.25 - this.spinV) * Math.min(1, dt * 1.5);
      this.yaw += this.spinV * dt;
    }
    if (this.car) {
      this.car.root.rotation.y = this.yaw;
      this.car.update(0, Math.sin(now / 900) * 0.6, dt);
      const on = now < this.boostUntil;
      this.car.setBoost(on);
      if (this.trail) {
        // In the car's own space: the road "moves" backwards under it.
        this.trail.shift(0, -14 * dt);
        this.trail.update(0, 0.32, -2.3, 1, 0, on ? 1 : 0, dt);
      }
    }
    this.fx.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener("pointerdown", this.down);
    window.removeEventListener("pointermove", this.move);
    window.removeEventListener("pointerup", this.up);
    this.ro.disconnect();
    this.car?.dispose();
    this.trail?.dispose();
    this.fx.dispose();
    for (const m of [this.stage, this.ring]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
