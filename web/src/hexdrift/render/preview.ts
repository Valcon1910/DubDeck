// The 3D car viewer (garage and title screen): one car floating in the light. Drag
// to turn it any way you like, around any axis and as far as you like (it
// keeps spinning with your flick, then settles into a slow turn). Draws only
// while it's on screen.
import * as THREE from "three";
import { buildCar, type CarModel } from "./car.ts";
import { itemOf, type Item, type Look } from "../garage.ts";
import { FinishFx, Trail, trailDef, type FinishKind } from "./fx.ts";

const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);

export class Preview {
  private tmpV = new THREE.Vector3();
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.5, 100);
  private car: CarModel | null = null;
  private canvas: HTMLCanvasElement;
  private ro: ResizeObserver;
  private raf = 0;
  /** The car's orientation, and its spin (radians/s around world Y and X). */
  private q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);
  private wy = 0.25;
  private wx = 0;
  private drag: { x: number; y: number; t: number; id: number } | null = null;
  private qa = new THREE.Quaternion();
  private visible = true;
  private io: IntersectionObserver | null = null;
  private boostUntil = 0;
  private trail: Trail | null = null;
  private fx = new FinishFx();
  private last = performance.now();
  private lookKey = "";
  private warm = 0;

  /** "hero": framed wider, for the title screen's big car. */
  constructor(host: HTMLElement, private framing: "garage" | "hero" = "garage") {
    const canvas = document.createElement("canvas");
    canvas.className = "hx-preview-canvas";
    host.prepend(canvas);
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    // A plain car at a low resolution first; full detail once it is ready (see setLook).
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight("#cfd8ff", "#2a2140", 1.6));
    const key = new THREE.DirectionalLight("#ffffff", 2.2); key.position.set(4, 7, 5); this.scene.add(key);
    const rim = new THREE.DirectionalLight("#7af7ff", 1.1); rim.position.set(-5, 3, -6); this.scene.add(rim);
    this.scene.add(this.fx.group);
    this.camera.position.set(0, 2.6, 8.2);
    this.camera.lookAt(0, 0.65, 0);

    canvas.addEventListener("pointerdown", this.down);
    window.addEventListener("pointermove", this.move);
    window.addEventListener("pointerup", this.up);
    window.addEventListener("pointercancel", this.up);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    if (typeof IntersectionObserver !== "undefined") {
      this.io = new IntersectionObserver((es) => { this.visible = es[es.length - 1].isIntersecting; });
      this.io.observe(canvas);
    }
    this.resize();
    const loop = (now: number) => { this.raf = requestAnimationFrame(loop); if (!document.hidden && this.visible) this.frame(now); else this.last = now; };
    this.raf = requestAnimationFrame(loop);
  }

  private down = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    this.wy = 0; this.wx = 0;
    this.canvas.setPointerCapture?.(e.pointerId);
  };
  private move = (e: PointerEvent) => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y, now = performance.now();
    this.turn(dx * 0.01, dy * 0.01);
    const dt = Math.max(0.016, (now - this.drag.t) / 1000);
    this.wy = (dx * 0.01) / dt; this.wx = (dy * 0.01) / dt;
    this.drag = { ...this.drag, x: e.clientX, y: e.clientY, t: now };
  };
  private up = (e: PointerEvent) => { if (this.drag && e.pointerId === this.drag.id) this.drag = null; };

  /** Turns the car around the screen's up axis and its sideways axis (trackball). */
  private turn(ay: number, ax: number) {
    if (ay) this.q.premultiply(this.qa.setFromAxisAngle(Y, ay));
    if (ax) this.q.premultiply(this.qa.setFromAxisAngle(X, ax));
    this.q.normalize();
  }

  private resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole car (the truck is the longest) in view on narrow screens.
    const narrow = w / h < 1.2;
    const k = this.framing === "hero" ? 1.18 : 1;
    this.camera.fov = narrow ? 40 : 34;
    this.camera.position.set(0, (narrow ? 3 : 2.6) * k, (narrow ? 10.5 : 8.6) * k);
    this.camera.lookAt(0, 0.7, 0);
    this.camera.updateProjectionMatrix();
  }

  setLook(look: Look, mapAccent = "#7af7ff") {
    const key = JSON.stringify(look) + mapAccent;
    if (this.car && key === this.lookKey) return;
    this.lookKey = key;
    if (this.car) { this.scene.remove(this.car.root); this.car.dispose(); }
    const car = this.car = buildCar({ look, mapAccent });
    this.scene.add(car.root);
    this.trail?.dispose();
    this.trail = new Trail(trailDef(itemOf("trail", look.trail) as Item));
    car.root.add(this.trail.mesh);
    // Show the basic shape at once, then the details once their shaders are
    // built (in parallel where the browser can), so the menu never stalls.
    car.setDetail(2);
    const id = ++this.warm;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (id !== this.warm || this.car !== car) return;
      car.setDetail(0);
      const ready = this.renderer.compileAsync(this.scene, this.camera);
      car.setDetail(2);
      void ready.catch(() => undefined).then(() => {
        if (id !== this.warm || this.car !== car) return;
        car.setDetail(0);
        const full = Math.min(window.devicePixelRatio || 1, this.framing === "hero" ? 1.5 : 2);
        if (this.renderer.getPixelRatio() !== full) { this.renderer.setPixelRatio(full); this.resize(); }
      });
    }));
  }

  /** Shows the boost flame and trail for a moment (when picking a trail). */
  boost() { this.boostUntil = performance.now() + 2200; }

  /** Plays a finish effect around the car. */
  celebrate(kind: string) { this.fx.start(kind as FinishKind, 0, 0, 0, 0.32); }

  private frame(now: number) {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!this.drag) {
      // The flick carries on, then settles into a slow turn.
      const k = Math.min(1, dt * 1.2);
      this.wy += (0.25 - this.wy) * k;
      this.wx += (0 - this.wx) * k;
      this.turn(this.wy * dt, this.wx * dt);
    }
    if (this.car) {
      // Turn around the car's middle (not its wheels) so flips look right.
      this.car.root.quaternion.copy(this.q);
      this.car.root.position.set(0, 0.7, 0).sub(this.tmpV.set(0, 0.7, 0).applyQuaternion(this.q));
      this.car.update(0, Math.sin(now / 900) * 0.6, dt);
      const on = now < this.boostUntil;
      this.car.setBoost(on);
      if (this.trail) {
        // Only while showing it off: the ribbon is drawn in the car's own space.
        this.trail.mesh.visible = now < this.boostUntil + 1200;
        // In the car's own space: the road "moves" backwards under it.
        this.trail.shift(0, -14 * dt);
        this.trail.update(0, 0.32, -2.3, 1, 0, on ? 1 : 0, dt);
      }
    }
    this.fx.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.warm++;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener("pointerdown", this.down);
    window.removeEventListener("pointermove", this.move);
    window.removeEventListener("pointerup", this.up);
    window.removeEventListener("pointercancel", this.up);
    this.ro.disconnect();
    this.io?.disconnect();
    this.car?.dispose();
    this.trail?.dispose();
    this.fx.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
