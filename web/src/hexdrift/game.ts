// The running game: fixed 60 Hz simulation, smooth (interpolated) drawing at
// the screen's own rate, chase camera, and a resolution that adapts so slow
// phones keep a steady frame rate. Pauses itself when the tab is hidden.
import * as THREE from "three";
import { BIOMES, trackOf, type MapDef } from "./maps.ts";
import { botInput } from "./sim/bot.ts";
import { COUNTDOWN, formatTime, HZ, newRace, pack, raceTicks, step, type Race } from "./sim/race.ts";
import { groundAt } from "./sim/track.ts";
import { buildWorld, type World } from "./render/world.ts";
import { NO_GROUND, terrainAt } from "./sim/terrain.ts";
import { blobShadow, buildCar, type CarModel } from "./render/car.ts";
import type { Controls } from "./input.ts";
import { DEFAULT_LOOK, type Look } from "./garage.ts";

export interface HudRefs {
  time: HTMLElement | null;
  speed: HTMLElement | null;
  cps: HTMLElement | null;
  count: HTMLElement | null;
  /** "+0.42" / "−0.18" against the ghost at each checkpoint. */
  split: HTMLElement | null;
}

export interface GameEvents {
  onFinish(ticks: number, inputs: number[], splits: number[]): void;
  onHidden(): void;
}

const CAMS = [
  { dist: 9.5, height: 3.6, look: 1.3, fov: 68 },
  { dist: 15, height: 6.5, look: 1.0, fov: 62 },
  { dist: -0.2, height: 1.45, look: 1.25, fov: 78 },
];

interface Snap { x: number; y: number; z: number; yaw: number; nx: number; ny: number; nz: number }
/** The best run replayed next to you: see-through, no collisions. */
interface Ghost {
  inputs: Uint8Array;
  race: Race;
  splits: number[];
  finish: number;
  model: CarModel;
  prev: Snap;
  cur: Snap;
  n: THREE.Vector3;
}

const snap = (r: Race): Snap => ({ x: r.car.x, y: r.car.y, z: r.car.z, yaw: r.car.yaw, nx: r.car.nx, ny: r.car.ny, nz: r.car.nz });

export class Game {
  race: Race;
  autopilot = false;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private car: CarModel;
  private shadow = blobShadow();
  private raf = 0;
  private last = 0;
  private acc = 0;
  private prev: Snap;
  private cur: Snap;
  private paused = false;
  private finished = false;
  private cam = 0;
  private camYaw: number;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private respawnHeld = false;
  private botAt = { i: 0 };
  private ratio: number;
  private maxRatio: number;
  private minRatio: number;
  private lowered = 0;
  private frameMs = 16;
  private resAt = 0;
  private hudCache = { time: "", speed: "", cps: "", count: "", split: "" };
  /** Your best run (splits are against this one). */
  private ghost: Ghost | null = null;
  /** The world record, in gold (only when someone else holds it). */
  private wr: Ghost | null = null;
  private splitText = "";
  private splitClass = "";
  private splitUntil = 0;
  private onVis = () => { if (document.hidden && !this.paused && !this.finished) this.events.onHidden(); };
  private ro: ResizeObserver;

  private canvas: HTMLCanvasElement;

  constructor(
    host: HTMLElement,
    readonly map: MapDef,
    private hud: HudRefs,
    private events: GameEvents,
    private controls: Controls,
    camMode = 0,
    private look: Look = DEFAULT_LOOK,
  ) {
    const biome = BIOMES[map.biome];
    const track = trackOf(map);
    // A fresh canvas per game: a WebGL context can't be reused after it's released.
    const canvas = document.createElement("canvas");
    canvas.className = "hx-canvas";
    host.prepend(canvas);
    this.canvas = canvas;
    this.race = newRace(track);
    this.prev = this.cur = snap(this.race);
    this.camYaw = this.race.car.yaw;
    this.cam = camMode;

    // Sharp on every screen: smoothed edges always, and the resolution never
    // drops below one pixel per screen point (it only trims the extra detail
    // of high-density screens when frames get slow).
    const dpr = window.devicePixelRatio || 1;
    this.maxRatio = Math.min(dpr, 2);
    this.minRatio = Math.min(dpr, 1);
    this.ratio = this.maxRatio;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(CAMS[this.cam].fov, 1, 0.5, 2600);

    this.scene.fog = new THREE.Fog(biome.fog, biome.fogNear, biome.fogFar);
    this.scene.background = new THREE.Color(biome.fog);
    this.scene.add(new THREE.HemisphereLight(biome.sky, biome.ground, 1.5));
    const sun = new THREE.DirectionalLight("#ffffff", 1.7);
    sun.position.set(0.45, 1, 0.3);
    this.scene.add(sun);

    this.world = buildWorld(track, biome, map.biome);
    this.scene.add(this.world.group);
    this.car = buildCar({ look, mapAccent: biome.accent });
    this.scene.add(this.car.root);
    this.scene.add(this.shadow.mesh);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    document.addEventListener("visibilitychange", this.onVis);
    this.updateHud();
  }

  private resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.last = performance.now();
    this.acc = 0;
  }

  /**
   * Shows a ghost replaying these inputs. Replays it once first: if it no
   * longer finishes in the same time (physics changed), there's no ghost.
   */
  setGhost(inputs: Uint8Array | null, ticks = 0): boolean {
    this.drop(this.ghost);
    this.ghost = inputs ? this.makeGhost(inputs, ticks, "pb") : null;
    return this.ghost !== null;
  }

  /** The world-record ghost: gold, with a crown and "name · time" above it. */
  setRecordGhost(inputs: Uint8Array | null, ticks = 0, name = ""): boolean {
    this.drop(this.wr);
    this.wr = inputs ? this.makeGhost(inputs, ticks, "wr", `👑 ${name} · ${formatTime(ticks)}`) : null;
    return this.wr !== null;
  }

  private drop(g: Ghost | null) {
    if (g) { this.scene.remove(g.model.root); g.model.dispose(); }
  }

  private makeGhost(inputs: Uint8Array, ticks: number, kind: "pb" | "wr", label = ""): Ghost | null {
    const check = newRace(this.race.track);
    while (check.phase === "countdown") step(check, 0);
    for (const b of inputs) { step(check, b); if (check.phase === "finished") break; }
    if (check.phase !== "finished" || check.finishTicks !== ticks) return null;
    const model = buildCar({ look: kind === "pb" ? this.look : undefined, ghost: kind, label });
    model.root.visible = false;
    this.scene.add(model.root);
    const race = newRace(this.race.track);
    const g: Ghost = { inputs, race, splits: check.splits.slice(), finish: check.finishTicks, model, prev: snap(race), cur: snap(race), n: new THREE.Vector3(0, 1, 0) };
    // Catch up with the race if it has already started.
    for (let i = 0; i < this.race.tick; i++) this.stepGhost(g);
    return g;
  }

  get hasGhost() { return this.ghost !== null || this.wr !== null; }


  /**
   * Rebuilds a run from its inputs (after a reload). Same inputs, same
   * physics: the car ends up exactly where it was.
   */
  restore(inputs: Uint8Array) {
    this.restart();
    while (this.race.phase === "countdown") this.tick(0);
    for (const b of inputs) { this.tick(b); if (this.race.phase !== "running") break; }
    this.prev = this.cur;
    this.camYaw = this.race.car.yaw;
    this.camInit = false;
  }

  private stepGhost(g: Ghost | null) {
    if (!g) return;
    g.prev = g.cur;
    const r = g.race;
    step(r, r.phase === "running" ? g.inputs[r.inputs.length] ?? 0 : 0);
    g.cur = snap(r);
  }

  /** One simulation step for the race (and the ghost alongside it). */
  private tick(byte: number) {
    this.prev = this.cur;
    const before = this.race.splits.length;
    step(this.race, byte);
    this.cur = snap(this.race);
    this.stepGhost(this.ghost);
    this.stepGhost(this.wr);
    const g = this.ghost;
    if (g && this.race.splits.length > before) {
      const i = this.race.splits.length - 1;
      if (g.splits[i] !== undefined) this.showSplit(this.race.splits[i] - g.splits[i]);
    }
    if (this.race.phase === "finished" && !this.finished) {
      this.finished = true;
      if (g) this.showSplit(this.race.finishTicks - g.finish);
      this.events.onFinish(this.race.finishTicks, this.race.inputs.slice(), this.race.splits.slice());
    }
  }

  private showSplit(d: number) {
    const sign = d < 0 ? "−" : d > 0 ? "+" : "±";
    this.splitText = `${sign}${(Math.abs(d) / HZ).toFixed(3)}`;
    this.splitClass = d < 0 ? "ahead" : d > 0 ? "behind" : "";
    this.splitUntil = this.race.tick + HZ * 2.5;
  }

  /** Back to the start line (keeps the world, so it's instant). */
  restart() {
    this.race = newRace(this.race.track);
    for (const g of [this.ghost, this.wr]) {
      if (!g) continue;
      g.race = newRace(this.race.track);
      g.prev = g.cur = snap(g.race);
    }
    this.splitText = "";
    this.splitUntil = 0;
    this.prev = this.cur = snap(this.race);
    this.camYaw = this.race.car.yaw;
    this.camInit = false;
    this.finished = false;
    this.botAt = { i: 0 };
    this.acc = 0;
    this.last = performance.now();
    this.paused = false;
    this.updateHud();
  }

  cycleCamera() {
    this.cam = (this.cam + 1) % CAMS.length;
    this.camInit = false;
    return this.cam;
  }

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.frameMs += ((dt * 1000) - this.frameMs) * 0.05;
    this.controls.pollPad();

    if (!this.paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= 1 / HZ && n < 6) {
        this.acc -= 1 / HZ;
        n++;
        this.tick(this.input());
      }
      if (n === 6) this.acc = 0; // way behind (tab was busy): don't spiral
    }
    // Resize before drawing: resizing clears the picture, and doing it after
    // the draw showed a black frame (the dark flicker).
    this.adaptResolution(now);
    this.draw(this.paused ? 1 : this.acc * HZ, dt);
  }

  private input(): number {
    if (this.race.phase !== "running") return 0;
    if (this.autopilot) return botInput(this.race, this.botAt);
    const i = this.controls.read();
    // Respawn only on the press, not every step it's held.
    const r = i.respawn && !this.respawnHeld;
    this.respawnHeld = i.respawn;
    return pack({ ...i, respawn: r });
  }

  private tmpM = new THREE.Matrix4();
  private vx = new THREE.Vector3();
  private vy = new THREE.Vector3();
  private vz = new THREE.Vector3();
  private smoothN = new THREE.Vector3(0, 1, 0);

  private draw(alpha: number, dt: number) {
    const a = this.prev, b = this.cur;
    const jump = (a.x - b.x) ** 2 + (a.z - b.z) ** 2 > 400; // respawned
    const t = jump ? 1 : alpha;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
    let dyaw = b.yaw - a.yaw;
    if (dyaw > Math.PI) dyaw -= Math.PI * 2;
    if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const yaw = a.yaw + dyaw * t;
    const car = this.race.car;

    this.pose(this.car, this.smoothN, b, jump, x, y, z, yaw, dt);
    const steer = this.race.inputs.length ? ((this.race.inputs[this.race.inputs.length - 1] & 15) - 7) / 7 : 0;
    const lastIn = this.race.inputs[this.race.inputs.length - 1] ?? 0;
    this.car.update(car.speed, steer, dt, (lastIn & 32) !== 0);
    this.car.setBoost(car.boosting > 0);

    // The ghosts.
    for (const gh of [this.ghost, this.wr]) {
      if (!gh) continue;
      const show = gh.race.phase === "running";
      gh.model.root.visible = show;
      if (show) {
        const p = gh.prev, q = gh.cur;
        const gj = (p.x - q.x) ** 2 + (p.z - q.z) ** 2 > 400;
        const tt = gj ? 1 : t;
        let gy = q.yaw - p.yaw;
        if (gy > Math.PI) gy -= Math.PI * 2;
        if (gy < -Math.PI) gy += Math.PI * 2;
        this.pose(gh.model, gh.n, q, gj, p.x + (q.x - p.x) * tt, p.y + (q.y - p.y) * tt, p.z + (q.z - p.z) * tt, p.yaw + gy * tt, dt);
        const gi = gh.race.inputs;
        gh.model.update(gh.race.car.speed, gi.length ? ((gi[gi.length - 1] & 15) - 7) / 7 : 0, dt);
        gh.model.setBoost(gh.race.car.boosting > 0);
      }
    }

    // Shadow on the road or the ground below.
    const road = groundAt(this.race.track, x, y + 0.5, z, 0.5);
    const ter = terrainAt(this.race.track, x, z).h;
    const gh = Math.max(road ? road.h : NO_GROUND, ter <= y + 0.5 ? ter : NO_GROUND);
    if (gh > NO_GROUND && y - gh < 25) {
      this.shadow.mesh.visible = true;
      this.shadow.mesh.position.set(x, gh + 0.09, z);
      this.shadow.mesh.rotation.y = yaw;
      const s = 1 + (y - gh) * 0.06;
      this.shadow.mesh.scale.set(s, 1, s);
      (this.shadow.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - (y - gh) / 25);
    } else this.shadow.mesh.visible = false;

    // Chase camera.
    const c = CAMS[this.cam];
    let dy = yaw - this.camYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.camYaw += dy * Math.min(1, dt * (this.cam === 2 ? 30 : 7));
    if (jump) this.camYaw = yaw;
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const sp = Math.abs(car.speed);
    const dist = c.dist + (this.cam === 2 ? 0 : sp * 0.025);
    const want = this.vy.set(x - fx * dist, y + c.height, z - fz * dist);
    if (!this.camInit || jump) { this.camPos.copy(want); this.camInit = true; }
    else this.camPos.lerp(want, Math.min(1, dt * (this.cam === 2 ? 40 : 12)));
    if (this.cam === 2) this.camPos.copy(want);
    this.camLook.set(x + fx * 6, y + c.look, z + fz * 6);
    if (this.race.phase === "finished") {
      // Slow orbit around the car at the finish.
      const o = performance.now() / 4000;
      this.camPos.set(x + Math.sin(o) * 12, y + 5, z + Math.cos(o) * 12);
      this.camLook.set(x, y + 1, z);
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    // Tall (portrait) screens get a wider view so the road ahead stays visible.
    const tall = Math.max(0, 1.3 - this.camera.aspect) * 30;
    const fov = Math.min(100, c.fov + tall + Math.min(14, sp * 0.16) + (car.boosting > 0 ? 6 : 0));
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
    }
    const sky = this.world.group.getObjectByName("sky");
    if (sky) sky.position.copy(this.camPos);

    this.renderer.render(this.scene, this.camera);
    this.updateHud();
  }

  /** Places a car model: forward along yaw, up along the (smoothed) road normal. */
  private pose(model: CarModel, n: THREE.Vector3, b: Snap, jump: boolean, x: number, y: number, z: number, yaw: number, dt: number) {
    n.lerp(this.vy.set(b.nx, b.ny, b.nz), Math.min(1, dt * 10)).normalize();
    if (jump) n.set(b.nx, b.ny, b.nz);
    this.vz.set(Math.sin(yaw), 0, Math.cos(yaw));
    this.vx.crossVectors(n, this.vz).normalize();
    this.vz.crossVectors(this.vx, n).normalize();
    this.tmpM.makeBasis(this.vx, n, this.vz).setPosition(x, y, z);
    model.root.matrixAutoUpdate = false;
    model.root.matrix.copy(this.tmpM);
    model.root.matrixWorldNeedsUpdate = true;
  }

  private updateHud() {
    const r = this.race, h = this.hud, cache = this.hudCache;
    const set = (k: keyof typeof cache, el: HTMLElement | null, v: string) => {
      if (el && cache[k] !== v) { el.textContent = v; cache[k] = v; }
    };
    set("time", h.time, formatTime(raceTicks(r)));
    set("speed", h.speed, String(Math.round(Math.abs(r.car.speed) * 3.6)));
    set("cps", h.cps, `${r.cps.size}/${r.track.checkpoints}`);
    let count = "";
    if (r.phase === "countdown") count = String(Math.ceil((COUNTDOWN - r.tick) / HZ));
    else if (r.phase === "running" && r.tick - COUNTDOWN < 40) count = "GO!";
    set("count", h.count, count);
    const split = r.tick < this.splitUntil ? this.splitText : "";
    set("split", h.split, split);
    if (h.split && h.split.dataset.kind !== this.splitClass) h.split.dataset.kind = this.splitClass;
  }

  /** Lowers or raises the render resolution to keep frames fast. */
  private adaptResolution(now: number) {
    if (now - this.resAt < 2000) return;
    this.resAt = now;
    let r = this.ratio;
    // Few, big steps; and once it has had to step down twice, it stays put.
    if (this.frameMs > 21 && r > this.minRatio) { r = Math.max(this.minRatio, r - 0.35); this.lowered++; }
    else if (this.frameMs < 12 && r < this.maxRatio && this.lowered < 2) r = Math.min(this.maxRatio, r + 0.25);
    if (r !== this.ratio) {
      this.ratio = r;
      this.renderer.setPixelRatio(r);
      this.resize();
    }
  }

  dispose() {
    this.stop();
    this.ro.disconnect();
    document.removeEventListener("visibilitychange", this.onVis);
    this.world.dispose();
    this.car.dispose();
    this.setGhost(null);
    this.setRecordGhost(null);
    this.shadow.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
