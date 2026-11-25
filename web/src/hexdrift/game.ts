// The running game: fixed 60 Hz simulation, smooth (interpolated) drawing at
// the screen's own rate, chase camera, and a resolution that adapts so slow
// phones keep a steady frame rate. Pauses itself when the tab is hidden.
import * as THREE from "three";
import { BIOMES, trackOf, type MapDef } from "./maps.ts";
import { botInput } from "./sim/bot.ts";
import { COUNTDOWN, formatTime, HZ, newRace, pack, raceTicks, step, type Race } from "./sim/race.ts";
import { CELL, groundAt, key, local } from "./sim/track.ts";
import { propsOf } from "./sim/props.ts";
import { buildWorld, GROUND, type World } from "./render/world.ts";
import { LOOKS, setupScene } from "./render/roadworld.ts";
import { GFX, gradeFor, guessGfx, Post, SunShadow, type Gfx } from "./render/post.ts";
import { Particles } from "./render/particles.ts";
import { Skids } from "./render/skids.ts";
import { Weather, WEATHER } from "./render/weather.ts";
import type { Smash } from "./render/props.ts";
import { NO_GROUND, terrainAt } from "./sim/terrain.ts";
import { blobShadow, buildCar, type CarModel } from "./render/car.ts";
import type { Controls } from "./input.ts";
import { DEFAULT_LOOK, itemOf, type Item, type Look } from "./garage.ts";
import { FinishFx, Trail, trailDef, type FinishKind } from "./render/fx.ts";
import { play } from "./ui/sound.ts";
import { RaceAudio, type Surface } from "./ui/raceaudio.ts";

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
  /** The race-start cutscene: the flyover, the car reveal, then done. */
  onIntro?(stage: IntroStage): void;
}

export type IntroStage = "fly" | "car" | "done";
// The cutscene before the first countdown: a drone flyover of the route
// (with the map's title), a cut to an orbit around your car, then a smooth
// swing into the chase camera. Nothing is simulated meanwhile, so it can't
// affect the run; any key or tap skips it.
const FLY = 3.2, REVEAL = 1.7, BLEND = 0.9;

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
  private castTick = 0;
  private trail: Trail;
  private fx = new FinishFx();
  private trailOn = 0;
  // Effects (none of them touch the physics).
  private smoke: Particles;
  private glow: Particles;
  private skids = new Skids();
  private weather: Weather;
  /** Lightning on stormy maps: two quick flashes every 6-15 s (looks only, not part of the race). */
  private storm: { hemi: THREE.HemisphereLight; base: number; next: number; t: number } | null = null;
  private wrTrail = new Trail({ style: "ribbon", color: "#ffe27a", color2: "#ff9a1a" }, false, 0.75);
  /** What happened in the steps since the last frame. */
  private ev = { hit: 0, land: 0, cp: 0, boost: false };
  private audio: RaceAudio;
  private prevBoost = 0;
  private shake = 0;
  private hitSoundAt = 0;
  private smashes: Smash[] = [];
  private cheer = 0;
  /** After the finish line: the car slides to a handbrake stop in slow motion. */
  private coast: { x: number; y: number; z: number; yaw: number; yaw0: number; dx: number; dz: number; v: number; v0: number; dec: number; spin: number } | null = null;
  private slow = 1;
  private flash: HTMLDivElement;
  private boostClass = false;
  private camLift = 0;
  private biomeId: MapDef["biome"];
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
  private post: Post;
  private sun: SunShadow;
  private gfxAuto = true;
  private camDir = new THREE.Vector3();
  private resAt = 0;
  private hudCache = { time: "", speed: "", cps: "", count: "", split: "" };
  /** Your best run (splits are against this one). */
  private ghost: Ghost | null = null;
  /** The world record, in gold (only when someone else holds it). */
  private wr: Ghost | null = null;
  private splitText = "";
  private splitClass = "";
  private splitUntil = 0;
  private introT = -1;
  private finishAt = 0;
  private introStage: IntroStage = "done";
  private route: THREE.Vector3[] = [];
  private skip = (e: Event) => {
    if (this.introT < 0 || this.paused) return;
    if (e instanceof KeyboardEvent && (e.repeat || e.key === "Escape")) return;
    if (this.introT < FLY + REVEAL) this.introT = FLY + REVEAL;
  };
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
    intro = false,
  ) {
    const biome = BIOMES[map.biome];
    const track = trackOf(map);
    // A fresh canvas per game: a WebGL context can't be reused after it's released.
    const canvas = document.createElement("canvas");
    canvas.className = "hx-canvas";
    host.prepend(canvas);
    this.canvas = canvas;
    this.race = newRace(track);
    this.audio = new RaceAudio(look.body, map.biome);
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
    // No canvas multisampling: frames are drawn into the HDR buffer (which has its own) and finished in render/post.ts.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(CAMS[this.cam].fov, 1, 0.5, 2600);

    const lit = setupScene(this.scene, biome, map.biome, !!track.road);
    const L = track.road ? LOOKS[map.biome] : undefined;
    this.post = new Post(this.renderer, gradeFor(map.biome, L), lit.sun.position, lit.sun.color.clone().multiplyScalar(L ? 1 : 0.9));
    this.sun = new SunShadow(lit.sun, this.scene);
    if (map.biome === "storm" && lit.hemi) this.storm = { hemi: lit.hemi, base: lit.hemi.intensity, next: 4 + Math.random() * 6, t: -1 };

    this.world = buildWorld(track, biome, map.biome);
    this.scene.add(this.world.group);
    // Everything takes the sun's shadow; the scenery casts it (not the land, sky or sea).
    this.world.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || o.name === "sky") return;
      m.receiveShadow = true;
      m.castShadow = !["terrain", "water", "road"].includes(o.name);
    });
    this.car = buildCar({ look, mapAccent: biome.accent, env: biome });
    
    this.scene.add(this.car.root);
    this.scene.add(this.shadow.mesh);
    this.trail = new Trail(trailDef(itemOf("trail", look.trail) as Item));
    this.scene.add(this.trail.mesh);
    this.scene.add(this.fx.group);
    this.biomeId = map.biome;
    this.smoke = new Particles(900, false, this.scene.fog as THREE.Fog);
    this.glow = new Particles(500, true, this.scene.fog as THREE.Fog);
    this.weather = new Weather(WEATHER[map.biome]);
    this.scene.add(this.skids.mesh, this.smoke.points, this.glow.points, this.weather.object, this.wrTrail.mesh);
    this.flash = document.createElement("div");
    this.flash.className = "hx-flash";
    host.append(this.flash);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    document.addEventListener("visibilitychange", this.onVis);
    // A smoothed copy of the route for the flyover.
    const ln = track.line;
    for (let i = 0; i < ln.length; i++) {
      let x = 0, y = 0, z = 0, k = 0;
      for (let j = Math.max(0, i - 4); j <= Math.min(ln.length - 1, i + 4); j++) { x += ln[j].x; y = Math.max(y || -1e9, ln[j].y); z += ln[j].z; k++; }
      this.route.push(new THREE.Vector3(x / k, y, z / k));
    }
    if (intro && this.route.length > 20) {
      this.introT = 0;
      window.addEventListener("keydown", this.skip);
      window.addEventListener("pointerdown", this.skip);
    }
    this.updateHud();
  }

  /** True while the race-start cutscene is playing. */
  get inIntro() { return this.introT >= 0; }

  /** Ends the cutscene now (no blend). */
  endIntro() {
    if (this.introT < 0) return;
    this.introT = -1;
    this.camInit = false;
    this.setIntroStage("done");
    window.removeEventListener("keydown", this.skip);
    window.removeEventListener("pointerdown", this.skip);
  }

  private setIntroStage(s: IntroStage) {
    if (this.introStage === s) return;
    this.introStage = s;
    if (s === "car") play("reveal");
    this.events.onIntro?.(s);
  }

  private resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.post.setSize(this.canvas.width, this.canvas.height);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const px = this.canvas.height || h;
    this.smoke.setViewHeight(px); this.glow.setViewHeight(px); this.weather.setViewHeight(px);
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
    this.audio.setPaused(p);
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
    this.wr = inputs ? this.makeGhost(inputs, ticks, "wr", `${name} · ${formatTime(ticks)}`) : null;
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
    this.endIntro();
    this.restart();
    while (this.race.phase === "countdown") this.tick(0);
    for (const b of inputs) { this.tick(b); if (this.race.phase !== "running") break; }
    this.prev = this.cur;
    this.camYaw = this.race.car.yaw;
    this.camInit = false;
    this.ev = { hit: 0, land: 0, cp: 0, boost: false };
    this.prevBoost = this.race.car.boosting;
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
    const car = this.race.car;
    if (car.hit > this.ev.hit) this.ev.hit = car.hit;
    if (car.land > this.ev.land) this.ev.land = car.land;
    if (this.race.splits.length > before) this.ev.cp++;
    if (car.boosting === 39 && this.prevBoost < 38) this.ev.boost = true;
    this.prevBoost = car.boosting;
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
      const c = this.race.car;
      this.fx.start(itemOf("finish", this.look.finish).id as FinishKind, c.x, c.y, c.z);
      this.startCoast();
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
    this.endIntro();
    this.race = newRace(this.race.track);
    for (const g of [this.ghost, this.wr]) {
      if (!g) continue;
      g.race = newRace(this.race.track);
      g.prev = g.cur = snap(g.race);
    }
    this.splitText = "";
    this.splitUntil = 0;
    this.trail.reset();
    this.fx.stop();
    this.wrTrail.reset();
    this.smoke.clear(); this.glow.clear(); this.skids.clear();
    this.world.breakables.reset();
    this.coast = null; this.slow = 1; this.shake = 0; this.cheer = 0;
    this.ev = { hit: 0, land: 0, cp: 0, boost: false };
    this.prevBoost = 0;
    this.flash.classList.remove("on");
    this.prev = this.cur = snap(this.race);
    this.camYaw = this.race.car.yaw;
    this.camInit = false;
    this.finished = false;
    this.finishAt = 0;
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
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.frameMs += ((dt * 1000) - this.frameMs) * 0.05;
    this.controls.pollPad();

    if (!this.paused && this.introT >= 0) {
      if (this.introT === 0) this.setIntroStage("fly");
      this.introT += dt;
      if (this.introT >= FLY && this.introStage === "fly") this.setIntroStage("car");
      if (this.introT >= FLY + REVEAL + BLEND) this.endIntro();
    } else if (!this.paused) {
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
  private tmpV = new THREE.Vector3();

  private draw(alpha: number, dt: number) {
    const a = this.prev, b = this.cur;
    const jump = (a.x - b.x) ** 2 + (a.z - b.z) ** 2 > 400; // respawned
    const t = jump ? 1 : alpha;
    let x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
    let dyaw = b.yaw - a.yaw;
    if (dyaw > Math.PI) dyaw -= Math.PI * 2;
    if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    let yaw = a.yaw + dyaw * t;
    const car = this.race.car;

    // Slow motion just after the finish (only the pictures; the run is over).
    if (this.coast) {
      this.slow = Math.min(1, this.slow + dt * (this.slow < 0.3 ? 0.06 : 1.1));
    }
    const sdt = dt * this.slow;
    if (this.coast) ({ x, y, z, yaw } = this.coastStep(sdt));

    this.pose(this.car, this.smoothN, b, jump, x, y, z, yaw, dt);
    const steer = this.race.inputs.length ? ((this.race.inputs[this.race.inputs.length - 1] & 15) - 7) / 7 : 0;
    const lastIn = this.race.inputs[this.race.inputs.length - 1] ?? 0;
    const shownSpeed = this.coast ? this.coast.v * 0.15 : car.speed;
    this.car.update(shownSpeed * this.slow, this.coast ? 0 : steer, dt, (lastIn & 32) !== 0 || this.coast !== null);
    this.car.setBoost(car.boosting > 0 && !this.coast);

    // The trail: bright while boosting, softer while drifting or flying.
    const glow = this.coast ? 0 : car.boosting > 0 ? 1 : Math.abs(car.slip) > 4 && car.grounded ? 0.55 : !car.grounded && Math.abs(car.speed) > 20 ? 0.35 : 0;
    this.trailOn += (glow - this.trailOn) * Math.min(1, dt * (glow > this.trailOn ? 12 : 4));
    if (jump) { this.trail.reset(); this.skids.lift(); }
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    this.trail.update(x - sy * 2.3, y + 0.32, z - cy * 2.3, cy, -sy, this.trailOn, sdt);
    this.fx.update(sdt);

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
        const gx = p.x + (q.x - p.x) * tt, gyy = p.y + (q.y - p.y) * tt, gz = p.z + (q.z - p.z) * tt, gyaw = p.yaw + gy * tt;
        this.pose(gh.model, gh.n, q, gj, gx, gyy, gz, gyaw, dt);
        const gi = gh.race.inputs;
        gh.model.update(gh.race.car.speed, gi.length ? ((gi[gi.length - 1] & 15) - 7) / 7 : 0, dt);
        gh.model.setBoost(gh.race.car.boosting > 0);
        if (gh === this.wr) {
          // The record holder leaves a golden trail and a little glitter.
          if (gj) this.wrTrail.reset();
          const s2 = Math.sin(gyaw), c2 = Math.cos(gyaw);
          const on = Math.min(1, Math.abs(gh.race.car.speed) / 15) * 0.9;
          this.wrTrail.update(gx - s2 * 2.3, gyy + 0.45, gz - c2 * 2.3, c2, -s2, on, sdt);
          if (on > 0.3 && Math.random() < dt * 40) {
            this.glow.emit({ x: gx - s2 * 2.2, y: gyy + 0.6 + Math.random() * 0.6, z: gz - c2 * 2.2, vy: 0.6, spread: 1.2, color: Math.random() < 0.5 ? "#ffe27a" : "#fff6d0", size: 0.22, life: 0.8, alpha: 0.9 });
          }
        }
      } else if (gh === this.wr) this.wrTrail.update(0, -1e4, 0, 1, 0, 0, sdt);
    }
    this.wrTrail.mesh.visible = this.wr !== null;

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
      // With real sun shadows the blob stays as a soft contact shadow.
      (this.shadow.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - (y - gh) / 25) * (this.post.shadowSize ? 0.55 : 1);
    } else this.shadow.mesh.visible = false;
    // The car's Blender body arrives after loading (and changes in the garage): keep it casting.
    if ((this.castTick = (this.castTick + 1) % 30) === 0 && this.post.shadowSize) {
      this.car.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !m.castShadow && !(m.material as THREE.Material).transparent) { m.castShadow = true; m.receiveShadow = true; } });
    }

    this.effects(x, y, z, yaw, road, dt, sdt);
    this.sound(road, dt);

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
      // The finish shot: a low sweep beside the car that cranes up and out
      // into a slow orbit while the celebration plays.
      if (!this.finishAt) this.finishAt = performance.now();
      const k = Math.min(1, (performance.now() - this.finishAt) / 2600);
      const e = 1 - (1 - k) ** 3;
      const o = yaw + Math.PI * 0.35 + (performance.now() - this.finishAt) / 4200;
      const rr = 5.5 + 6 * e;
      this.camPos.set(x + Math.sin(o) * rr, y + 2.1 + 5.5 * e, z + Math.cos(o) * rr);
      this.camLook.set(x, y + 1 - 0.2 * e, z);
    }

    if (this.introT >= 0) this.introCamera(x, y, z, yaw);
    this.camera.position.copy(this.camPos);
    this.tmpV.copy(this.camLook);
    if (this.introT < 0) {
      // Never inside a grandstand, a tower or a rock: rise over it instead.
      const need = this.camClear(this.camPos);
      this.camLift += (need - this.camLift) * Math.min(1, dt * (need > this.camLift ? 10 : 2));
      this.camera.position.y += this.camLift;
      if (this.shake > 0.002) {
        // A short, sharp shake for hits and hard landings.
        const k = this.shake;
        this.camera.position.x += (Math.random() - 0.5) * k; this.camera.position.y += (Math.random() - 0.5) * k * 0.7; this.camera.position.z += (Math.random() - 0.5) * k;
        this.tmpV.x += (Math.random() - 0.5) * k * 0.4; this.tmpV.y += (Math.random() - 0.5) * k * 0.4;
      }
    }
    this.shake *= Math.exp(-dt * 7);
    this.camera.lookAt(this.tmpV);
    // Tall (portrait) screens get a wider view so the road ahead stays visible.
    const tall = Math.max(0, 1.3 - this.camera.aspect) * 30;
    const fov = Math.min(100, c.fov + tall + Math.min(14, sp * 0.16) + (car.boosting > 0 ? 6 : 0));
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
    }
    const sky = this.world.group.getObjectByName("sky");
    if (sky) sky.position.copy(this.camera.position);
    this.weather.update(dt, this.camera.position);
    if (this.storm) this.lightning(dt);

    this.camera.getWorldDirection(this.camDir);
    this.sun.update(this.vx.set(x, y, z), this.camDir, this.post.sunDir);
    this.post.render(this.scene, this.camera, dt);
    this.updateHud();
  }

  /** The engine, tyres, wind and the world's own sound, from the car as it is now. */
  private sound(road: ReturnType<typeof groundAt>, dt: number) {
    const car = this.race.car, r = this.race;
    const lastIn = r.inputs[r.inputs.length - 1] ?? 0;
    // On the grid the gas still revs the engine (the race ignores it).
    const gas = r.phase === "countdown" ? this.introT < 0 && !this.autopilot && this.controls.read().gas : (lastIn & 16) !== 0;
    let surface: Surface = "asphalt";
    if (car.offroad) {
      const b = this.map.biome;
      surface = b === "baja" || b === "desert" || b === "canyon" || b === "miami" ? "sand" : b === "glacier" ? "ice" : "grass";
    } else {
      const sg = (road as { seg?: { surf?: string } } | null)?.seg;
      const sf = sg?.surf;
      surface = sf === "dirt" || sf === "ice" || sf === "metal" || sf === "sand" ? sf : road?.ice ? "ice" : "asphalt";
    }
    const sp = this.race.track.spawn;
    const fromStart = Math.min(Math.hypot(car.x - sp.x, car.z - sp.z), this.finished ? 0 : 1e9);
    this.audio.update({
      speed: this.coast ? this.coast.v : car.speed, slip: this.coast ? 0 : car.slip,
      gas, brake: (lastIn & 32) !== 0, grounded: this.coast ? true : car.grounded, boosting: car.boosting > 0,
      surface, phase: this.coast || this.finished ? "finished" : r.phase, fromStart,
    }, dt);
  }

  /** Smoke, dust, tyre marks, sparks, breakables, the crowd: everything that's only for show. */
  private effects(x: number, y: number, z: number, yaw: number, road: ReturnType<typeof groundAt>, dt: number, sdt: number) {
    const car = this.race.car;
    const ev = this.ev;
    const running = this.race.phase === "running";
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const sp = this.coast ? this.coast.v : Math.abs(car.speed);
    const pal = GROUND[this.biomeId];
    // Hits: sparks off the bodywork, a thump and a shake.
    if (ev.hit > 4 && running) {
      const k = Math.min(1, ev.hit / 35);
      const side = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0; i < 6 + k * 26; i++) {
        this.glow.emit({ x: x + rx * side * 1.0 + fx * (Math.random() * 3 - 1), y: y + 0.5, z: z + rz * side * 1.0 + fz * (Math.random() * 3 - 1), vx: car.vx * 0.4 + rx * side * 4, vy: 3 + Math.random() * 5, vz: car.vz * 0.4 + rz * side * 4, spread: 9, color: Math.random() < 0.6 ? "#ffcf6a" : "#ff7a2a", size: 0.16, life: 0.45 + Math.random() * 0.3, gravity: 22, drag: 1 });
      }
      this.shake = Math.max(this.shake, 0.25 + k * 0.6);
      const now = performance.now();
      if (now - this.hitSoundAt > 140) { play("impact", k); this.hitSoundAt = now; }
    }
    // Hard landings: a puff of whatever is underfoot.
    if (ev.land > 7 && running) {
      const k = Math.min(1, ev.land / 30);
      const col = car.offroad ? pal.flat : this.biomeId === "city" ? "#9a98b8" : "#d8d0c4";
      for (let i = 0; i < 10 + k * 16; i++) {
        const a = Math.random() * Math.PI * 2;
        this.smoke.emit({ x: x + Math.cos(a) * 1.2, y: y + 0.3, z: z + Math.sin(a) * 1.6, vx: Math.cos(a) * (3 + 5 * k), vy: 0.8, vz: Math.sin(a) * (3 + 5 * k), color: col, size: 0.9, grow: 3, life: 0.9 + k * 0.6, alpha: 0.4 + 0.2 * k, drag: 2.2 });
      }
      this.shake = Math.max(this.shake, 0.15 + k * 0.45);
      play("land", k);
    }
    // Checkpoints: a ring of light from the arch and a chime.
    if (ev.cp) {
      const acc = BIOMES[this.map.biome].accent;
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        this.glow.emit({ x: x + fx * 3, y: y + 4.5 + Math.sin(a) * 4, z: z + fz * 3, vx: rx * Math.cos(a) * 9 + car.vx * 0.6, vy: Math.sin(a) * 9, vz: rz * Math.cos(a) * 9 + car.vz * 0.6, color: i % 3 ? acc : "#ffffff", size: 0.34, life: 0.6, drag: 2.5 });
      }
      play("checkpoint");
      const chip = this.hud.cps?.parentElement;
      if (chip) { chip.classList.remove("hx-cp-flash"); void chip.offsetWidth; chip.classList.add("hx-cp-flash"); }
    }
    if (ev.boost) play("boost");
    this.ev = { hit: 0, land: 0, cp: 0, boost: false };
    const boosting = car.boosting > 0 && running;
    if (boosting !== this.boostClass) { this.boostClass = boosting; this.canvas.parentElement?.classList.toggle("hx-boosting", boosting); }
    if (boosting && Math.random() < dt * 50) {
      this.glow.emit({ x: x - fx * 2.5 + (Math.random() - 0.5), y: y + 0.5, z: z - fz * 2.5 + (Math.random() - 0.5), vx: car.vx * 0.5, vy: 1, vz: car.vz * 0.5, spread: 3, color: "#ffb84a", size: 0.14, life: 0.35 });
    }

    // Tyres on the surface: marks, smoke, dust, spray.
    const grounded = this.coast ? true : car.grounded;
    if (grounded && (running || this.coast)) {
      const off = !this.coast && car.offroad;
      const ice = !off && road?.ice === true;
      const slipK = this.coast ? Math.min(1, this.coast.v / 20) : Math.max(0, Math.min(1, (Math.abs(car.slip) - 2.5) / 6));
      const lastIn = this.race.inputs[this.race.inputs.length - 1] ?? 0;
      const brakeK = (lastIn & 32) && car.speed > 10 ? 0.7 : 0;
      const driftK = car.drift > 0.4 && sp > 12 ? car.drift * 0.8 : 0;
      const k = this.coast ? slipK : Math.max(slipK, brakeK, driftK);
      const wheels: [number, number][] = off ? [[-0.85, -1.35], [0.85, -1.35], [-0.85, 1.35], [0.85, 1.35]] : [[-0.85, -1.35], [0.85, -1.35]];
      const rain = this.biomeId === "city";
      wheels.forEach(([u, w], n) => {
        const wx = x + rx * u + fx * w, wz = z + rz * u + fz * w;
        if (off) {
          const deep = Math.min(1, sp / 20) * 0.45 + slipK * 0.35;
          this.skids.mark(n, wx, y, wz, rx, rz, 0.42, deep, pal.bank);
          if (n < 2 && sp > 5 && Math.random() < dt * 30 * Math.min(1, sp / 25)) {
            this.smoke.emit({ x: wx, y: y + 0.3, z: wz, vx: car.vx * 0.25, vy: 1.4, vz: car.vz * 0.25, spread: 2.5, color: this.biomeId === "glacier" ? "#ffffff" : pal.flat, size: 0.9, grow: 3.2, life: 1.1, alpha: 0.35 + 0.25 * Math.min(1, sp / 30), drag: 1.6 });
          }
        } else if (ice) {
          this.skids.mark(n, wx, y, wz, rx, rz, 0.22, k * 0.5, "#e8f6ff");
          if (k > 0.2 && Math.random() < dt * 40) this.glow.emit({ x: wx, y: y + 0.2, z: wz, vx: -fx * 3 + car.vx * 0.3, vy: 2.5, vz: -fz * 3 + car.vz * 0.3, spread: 4, color: "#e8f8ff", size: 0.16, life: 0.5, gravity: 9 });
        } else {
          this.skids.mark(n, wx, y, wz, rx, rz, 0.32, k * 0.6, "#0b0b0e");
          if (k > 0.25 && Math.random() < dt * 34 * k) {
            this.smoke.emit({ x: wx, y: y + 0.35, z: wz, vx: car.vx * 0.15, vy: 0.9, vz: car.vz * 0.15, spread: 1.2, color: rain ? "#a8a9c4" : "#dcdce2", size: 0.9, grow: 3.6, life: 1.5, alpha: 0.32 * k + 0.08, drag: 1.4 });
          }
          // Spray off wet roads.
          if (rain && sp > 18 && Math.random() < dt * 22) this.smoke.emit({ x: wx - fx * 0.5, y: y + 0.3, z: wz - fz * 0.5, vx: car.vx * 0.5, vy: 1.2, vz: car.vz * 0.5, spread: 2, color: "#b9c6e6", size: 0.6, grow: 2.4, life: 0.55, alpha: 0.2 });
        }
      });
    } else {
      this.skids.lift();
    }
    // Raindrops splashing on the road around you.
    if (this.biomeId === "city") {
      for (let i = 0; i < 3; i++) {
        if (Math.random() > dt * 60) continue;
        const px = x + (Math.random() - 0.5) * 26 + fx * 8, pz = z + (Math.random() - 0.5) * 26 + fz * 8;
        const g = groundAt(this.race.track, px, y + 4, pz, 8);
        if (g) this.glow.emit({ x: px, y: g.h + 0.05, z: pz, vy: 1.8, spread: 1.6, color: "#9fb4e8", size: 0.1, life: 0.22, gravity: 14, alpha: 0.5 });
      }
    }

    // Knocking things over (only your own car, never the ghosts).
    if (running || this.coast) {
      const vx = this.coast ? this.coast.dx * this.coast.v : car.vx, vz = this.coast ? this.coast.dz * this.coast.v : car.vz;
      this.smashes.length = 0;
      this.world.breakables.hit(x, y, z, vx, vz, this.smashes);
      for (const s of this.smashes) {
        for (let i = 0; i < 10 + s.hard * 14; i++) this.smoke.emit({ x: s.x, y: s.y, z: s.z, vx: vx * 0.35, vy: 3 + Math.random() * 4, vz: vz * 0.35, spread: 7, color: s.color, size: 0.22, life: 0.9, alpha: 0.95, gravity: 18, drag: 0.8 });
        if (s.sound === "snow") this.smoke.burst(10, { x: s.x, y: s.y, z: s.z, vx: vx * 0.2, vy: 1.5, vz: vz * 0.2, spread: 4, color: "#ffffff", size: 1, grow: 2.5, life: 1, alpha: 0.5, drag: 2 });
        if (s.sound === "metal") this.glow.burst(12, { x: s.x, y: s.y + 1, z: s.z, vy: 3, spread: 8, color: "#dff1ff", size: 0.14, life: 0.4, gravity: 20 });
        play(`smash-${s.sound}`, s.hard);
        this.shake = Math.max(this.shake, 0.12 + s.hard * 0.25);
      }
    }
    this.world.breakables.update(sdt);
    // The crowd jumps at the start and goes wild at the finish.
    const want = this.race.phase === "finished" ? 1 : this.race.phase === "countdown" || (running && this.race.tick - COUNTDOWN < 150) ? 0.45 : 0;
    this.cheer = want;
    this.world.update(sdt, this.cheer, this.camera);
    this.smoke.update(sdt);
    this.glow.update(sdt);
    this.skids.update();
  }

  /** How far the camera must rise to be clear of any solid prop it's in (0 when clear). */
  private camClear(p: THREE.Vector3): number {
    const list = propsOf(this.race.track).cells.get(key(Math.round(p.x / CELL), Math.round(p.z / CELL)));
    if (!list) return 0;
    let lift = 0;
    for (const s of list) {
      let dx = p.x - s.x, dz = p.z - s.z;
      const m = 1.2;
      if (s.fx !== undefined && s.fz !== undefined) { const lx = dx * s.fz - dz * s.fx; dz = dx * s.fx + dz * s.fz; dx = lx; }
      const inside = s.box ? Math.abs(dx) < s.a + m && Math.abs(dz) < s.b + m : (dx / (s.a + m)) ** 2 + (dz / (s.b + m)) ** 2 < 1;
      if (inside && p.y < s.top + 1.5 && s.top - p.y < 14) lift = Math.max(lift, s.top + 1.5 - p.y);
    }
    return lift;
  }

  /** The car's last moments after the line: it slides sideways to a stop before the road ends. */
  private startCoast() {
    const car = this.race.car;
    const v = Math.sqrt(car.vx * car.vx + car.vz * car.vz);
    if (v < 0.5) return;
    const tr = this.race.track;
    let room: number;
    if (tr.road) {
      // Whatever's left of the road past the line.
      const f = tr.road.finish;
      const past = (car.x - f.x) * f.fx + (car.z - f.z) * f.fz;
      room = Math.max(6, tr.road.runout - past - 6);
    } else {
      const fin = tr.pieces[tr.pieces.length - 1];
      room = Math.max(4, CELL / 2 - 4 - local(fin, car.x, car.z).w);
    }
    this.coast = {
      x: car.x, y: car.y, z: car.z, yaw: car.yaw, yaw0: car.yaw,
      dx: car.vx / v, dz: car.vz / v, v, v0: v, dec: (v * v) / (2 * room),
      spin: car.slip !== 0 ? (car.slip > 0 ? -1 : 1) : Math.random() < 0.5 ? -1 : 1,
    };
    this.slow = 0.22;
    this.flash.classList.remove("on"); void this.flash.offsetWidth; this.flash.classList.add("on");
    this.shake = 0.35;
    play("finish");
  }

  private coastStep(dt: number) {
    const c = this.coast!;
    c.v = Math.max(0, c.v - c.dec * dt);
    c.x += c.dx * c.v * dt; c.z += c.dz * c.v * dt;
    const g = groundAt(this.race.track, c.x, c.y + 1, c.z, 1.5);
    if (g) c.y = g.h;
    const k = 1 - c.v / c.v0;
    const e = k * k * (3 - 2 * k);
    c.yaw = c.yaw0 + c.spin * 1.25 * e;
    return { x: c.x, y: c.y, z: c.z, yaw: c.yaw };
  }

  /**
   * The cutscene camera. The flyover follows the road's own centre line well
   * above the arches (scenery never stands within a cell of the road), so it
   * can't pass through anything; the reveal orbits inside the road's width.
   */
  private introCamera(x: number, y: number, z: number, yaw: number) {
    const t = this.introT;
    const ease = (u: number) => u * u * (3 - 2 * u);
    if (t < FLY) {
      const n = this.route.length;
      const u = ease(Math.min(1, t / FLY));
      // From partway down the route back toward the start, looking the way it flies.
      const s0 = Math.min(n - 10, Math.max(30, n * 0.45)), s1 = 6;
      const s = s0 + (s1 - s0) * u;
      const at = (q: number, out: THREE.Vector3) => {
        const i = Math.max(0, Math.min(n - 2, Math.floor(q)));
        return out.copy(this.route[i]).lerp(this.route[i + 1], Math.max(0, Math.min(1, q - i)));
      };
      at(s, this.camPos);
      const h = 15 - 3 * u;
      this.camPos.y += h;
      const g = terrainAt(this.race.track, this.camPos.x, this.camPos.z).h;
      if (this.camPos.y < g + 6) this.camPos.y = g + 6;
      at(s - 8, this.camLook);
      this.camLook.y += 2;
      return;
    }
    // The reveal: a low orbit from the front corner round to behind the car.
    const k = Math.min(1, (t - FLY) / (REVEAL + BLEND));
    const a = yaw + Math.PI * 0.3 + Math.PI * 0.7 * ease(k);
    const r = 6, hgt = 1.6 + 1.2 * k;
    const ox = x + Math.sin(a) * r, oz = z + Math.cos(a) * r;
    // this.vy still holds where the chase camera wants to be this frame.
    const chaseX = this.vy.x, chaseY = this.vy.y, chaseZ = this.vy.z;
    const lookX = this.camLook.x, lookY = this.camLook.y, lookZ = this.camLook.z;
    // Then hand over smoothly to the chase camera (already worked out above).
    const b = t > FLY + REVEAL ? ease(Math.min(1, (t - FLY - REVEAL) / BLEND)) : 0;
    this.camPos.set(ox + (chaseX - ox) * b, y + hgt + (chaseY - y - hgt) * b, oz + (chaseZ - oz) * b);
    this.camLook.set(x + (lookX - x) * b, y + 0.8 + (lookY - y - 0.8) * b, z + (lookZ - z) * b);
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
    set("speed", h.speed, String(Math.round(Math.abs(this.coast ? this.coast.v : r.car.speed) * 3.6)));
    set("cps", h.cps, `${r.cps.size}/${r.track.checkpoints}`);
    let count = "";
    if (this.introT >= 0) count = "";
    else if (r.phase === "countdown") count = String(Math.ceil((COUNTDOWN - r.tick) / HZ));
    else if (r.phase === "running" && r.tick - COUNTDOWN < 40) count = "GO!";
    if (count !== cache.count && count && this.raf) play(count === "GO!" ? "go" : "count");
    set("count", h.count, count);
    if (h.count && h.count.dataset.n !== count) { h.count.dataset.n = count; h.count.classList.remove("pop"); void h.count.offsetWidth; h.count.classList.add("pop"); }
    const split = r.tick < this.splitUntil ? this.splitText : "";
    set("split", h.split, split);
    if (h.split && h.split.dataset.kind !== this.splitClass) h.split.dataset.kind = this.splitClass;
  }

  /** Lowers or raises the render resolution to keep frames fast. */
  private adaptResolution(now: number) {
    if (now - this.resAt < 2000) return;
    this.resAt = now;
    let r = this.ratio;
    // Slow frames: first a lighter graphics level (when it's on Auto), then fewer pixels.
    const lv = GFX.indexOf(this.post.gfx);
    if (this.frameMs > 21 && this.gfxAuto && lv > 0) { this.applyGfx(GFX[lv - 1]); this.frameMs = 16; return; }
    // Few, big steps; and once it has had to step down twice, it stays put.
    if (this.frameMs > 21 && r > this.minRatio) { r = Math.max(this.minRatio, r - 0.35); this.lowered++; }
    else if (this.frameMs < 12 && r < this.maxRatio && this.lowered < 2) r = Math.min(this.maxRatio, r + 0.25);
    if (r !== this.ratio) {
      this.ratio = r;
      this.renderer.setPixelRatio(r);
      this.resize();
    }
  }

  /** Graphics: "auto" picks a level for the device and steps down if frames get slow. */
  setGraphics(mode: Gfx | "auto") {
    this.gfxAuto = mode === "auto";
    this.applyGfx(mode === "auto" ? guessGfx() : mode);
  }

  get graphics(): Gfx { return this.post.gfx; }

  private applyGfx(level: Gfx) {
    this.post.setLevel(level);
    this.sun.setLevel(this.post.shadowSize);
  }

  private lightning(dt: number) {
    const s = this.storm!;
    if (s.t < 0) {
      s.next -= dt;
      if (s.next <= 0) { s.t = 0; s.next = 6 + Math.random() * 9; this.audio.thunder(0.6 + Math.random() * 0.4); }
      return;
    }
    s.t += dt;
    // A bright strike, a short gap, a weaker second strike, then fade.
    const t = s.t;
    const f = t < 0.08 ? 1 : t < 0.16 ? 0.15 : t < 0.24 ? 0.7 : t < 0.7 ? 0.7 * (1 - (t - 0.24) / 0.46) : 0;
    s.hemi.intensity = s.base * (1 + f * 2.2);
    this.post.flash = f * 0.35;
    if (t >= 0.7) { s.t = -1; s.hemi.intensity = s.base; this.post.flash = 0; }
  }

  dispose() {
    this.audio.dispose();
    this.endIntro();
    this.post.dispose();
    this.stop();
    this.ro.disconnect();
    document.removeEventListener("visibilitychange", this.onVis);
    this.world.dispose();
    this.car.dispose();
    this.setGhost(null);
    this.setRecordGhost(null);
    this.shadow.dispose();
    this.trail.dispose();
    this.fx.dispose();
    this.wrTrail.dispose();
    this.smoke.dispose(); this.glow.dispose(); this.skids.dispose(); this.weather.dispose();
    this.flash.remove();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
