// The spectator camera: a drone that glides along a map's route for the map
// screens (live view on hover and on the map's page) and takes the still
// pictures used as map icons.
//
// One WebGL renderer is shared by all of it: its canvas moves into whichever
// card or panel is showing, and built maps are cached (a few at a time), so
// browsing maps never piles up graphics memory on phones.
//
// The drone never goes through anything: it flies along the road's own
// centre line (scenery is always at least a cell away from the road), well
// above the checkpoint arches, and never lower than the ground under it.
import * as THREE from "three";
import { BIOMES, trackOf, type MapDef } from "../maps.ts";
import { terrainAt } from "../sim/terrain.ts";
import type { Track } from "../sim/track.ts";
import { buildWorld, type World } from "./world.ts";

/** Height above the road: the checkpoint arches are 9 tall. */
const ABOVE = 12.5;
const SPEED = 16; // units a second along the route

interface Built { world: World; scene: THREE.Scene; path: THREE.Vector3[]; low: number[]; track: Track; used: number }

/** A smoothed copy of the route, and how low the drone may go at each point. */
function routeOf(track: Track) {
  const pts = track.line;
  const n = pts.length;
  const path: THREE.Vector3[] = [];
  const low: number[] = [];
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0, z = 0, k = 0, top = -Infinity;
    for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) {
      x += pts[j].x; y += pts[j].y; z += pts[j].z; k++;
      if (pts[j].y > top) top = pts[j].y;
    }
    path.push(new THREE.Vector3(x / k, y / k, z / k));
    // Never below the highest road nearby (ramps, slopes) plus the clearance.
    low.push(top + ABOVE);
  }
  return { path, low };
}

class Stage {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 2600);
  private built = new Map<string, Built>();
  private cur: { map: MapDef; b: Built; s: number; host: HTMLElement } | null = null;
  private raf = 0;
  private last = 0;
  private ro: ResizeObserver;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private fade = 1;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "hx-spec-canvas";
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas);
  }

  private resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private get(map: MapDef): Built {
    let b = this.built.get(map.id);
    if (!b) {
      const biome = BIOMES[map.biome];
      const track = trackOf(map);
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(biome.fog, biome.fogNear * 1.4, biome.fogFar * 1.5);
      scene.background = new THREE.Color(biome.fog);
      scene.add(new THREE.HemisphereLight(biome.sky, biome.ground, 1.5));
      const sun = new THREE.DirectionalLight("#ffffff", 1.7);
      sun.position.set(0.45, 1, 0.3);
      scene.add(sun);
      const world = buildWorld(track, biome, map.biome);
      scene.add(world.group);
      b = { world, scene, track, used: 0, ...routeOf(track) };
      this.built.set(map.id, b);
      // Keep only the three most recently used maps.
      if (this.built.size > 3) {
        const old = [...this.built.entries()].filter(([id]) => id !== map.id && id !== this.cur?.map.id).sort((a, c) => a[1].used - c[1].used)[0];
        if (old) { old[1].world.dispose(); this.built.delete(old[0]); }
      }
    }
    b.used = performance.now();
    return b;
  }

  /** Where the drone is at route position s (in points along the route). */
  private place(b: Built, s: number, side: number, out: THREE.Vector3, look: THREE.Vector3) {
    const n = b.path.length;
    const at = (q: number) => {
      const i = Math.max(0, Math.min(n - 1, Math.floor(q)));
      const j = Math.min(n - 1, i + 1), f = Math.max(0, Math.min(1, q - i));
      return this.tmp.copy(b.path[i]).lerp(b.path[j], f);
    };
    const i = Math.max(0, Math.min(n - 1, Math.floor(s)));
    const ahead = at(s + 7).clone();
    const p = at(s).clone();
    const dx = ahead.x - p.x, dz = ahead.z - p.z, l = Math.hypot(dx, dz) || 1;
    // A gentle sideways drift (inside the road's free corridor).
    out.set(p.x + (-dz / l) * side, Math.max(p.y + ABOVE, b.low[i]), p.z + (dx / l) * side);
    // And never below the ground under it.
    const g = terrainAt(b.track, out.x, out.z).h;
    if (out.y < g + 6) out.y = g + 6;
    look.set(ahead.x, ahead.y + 1.5, ahead.z);
  }

  /** Shows a map's live spectator view inside host (replacing any other). */
  show(host: HTMLElement, map: MapDef) {
    const b = this.get(map);
    if (this.canvas.parentElement !== host) host.prepend(this.canvas);
    const start = this.cur?.map.id === map.id ? this.cur.s : Math.min(b.path.length * 0.08, 10);
    this.cur = { map, b, s: start, host };
    this.fade = 0;
    this.canvas.style.opacity = "0";
    this.resize();
    if (!this.raf) {
      this.last = performance.now();
      const loop = (now: number) => { this.raf = requestAnimationFrame(loop); if (!document.hidden) this.frame(now); };
      this.raf = requestAnimationFrame(loop);
    }
  }

  /** Stops the live view if it's in this host. */
  hide(host?: HTMLElement) {
    if (host && this.cur?.host !== host) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.cur = null;
    this.canvas.remove();
  }

  private frame(now: number) {
    const c = this.cur;
    if (!c) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const n = c.b.path.length;
    const pts = n / (c.b.track.line.length ? 1 : 1);
    c.s += (SPEED / 5) * dt;
    // Fade out near the end of the route, then start over.
    const left = pts - 8 - c.s;
    if (left < 0) { c.s = 2; }
    const want = left < 1.2 ? Math.max(0, left / 1.2) : 1;
    this.fade += (want - this.fade) * Math.min(1, dt * 5);
    this.canvas.style.opacity = this.fade.toFixed(3);
    this.place(c.b, c.s, Math.sin(now / 3100) * 4, this.pos, this.look);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    const sky = c.b.world.group.getObjectByName("sky");
    if (sky) sky.position.copy(this.pos);
    this.renderer.render(c.b.scene, this.camera);
  }

  /**
   * A still of the whole map from high above one corner (for map icons).
   * Returns a small JPEG data URL; the live view (if any) keeps running.
   */
  still(map: MapDef, w = 480, h = 300): string {
    const b = this.get(map);
    const box = new THREE.Box3();
    for (const p of b.path) box.expandByPoint(p);
    const mid = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z) * 0.62 + 30;
    const cam = new THREE.PerspectiveCamera(45, w / h, 1, 3000);
    cam.position.set(mid.x + r * 0.62, mid.y + r * 0.78, mid.z - r * 0.62);
    cam.lookAt(mid.x, mid.y - 4, mid.z);
    const was = this.renderer.getPixelRatio();
    const parent = this.canvas.parentElement;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    const sky = b.world.group.getObjectByName("sky");
    if (sky) sky.position.copy(cam.position);
    const fog = b.scene.fog as THREE.Fog;
    const far = fog.far;
    fog.far = far * 2.5;
    this.renderer.render(b.scene, cam);
    const url = this.canvas.toDataURL("image/jpeg", 0.82);
    fog.far = far;
    this.renderer.setPixelRatio(was);
    if (parent) this.resize();
    return url;
  }
}

let stage: Stage | null = null;
/** The shared spectator stage (created on first use; null without WebGL). */
export function spectator(): Stage | null {
  if (stage) return stage;
  try { stage = new Stage(); } catch { stage = null; }
  return stage;
}

const stills = new Map<string, string>();
const waiting: { map: MapDef; done: (url: string) => void }[] = [];
let busy = false;
/** The map's icon picture, made one at a time while the page is idle. */
export function mapStill(map: MapDef): Promise<string> {
  const have = stills.get(map.id);
  if (have) return Promise.resolve(have);
  return new Promise((resolve) => {
    waiting.push({ map, done: resolve });
    pump();
  });
}
function pump() {
  if (busy || !waiting.length) return;
  busy = true;
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback
    ?? ((f: () => void) => setTimeout(f, 30));
  idle(() => {
    const job = waiting.shift()!;
    let url = stills.get(job.map.id) ?? "";
    if (!url) {
      try { url = spectator()?.still(job.map) ?? ""; } catch { url = ""; }
      if (url) stills.set(job.map.id, url);
    }
    // Everyone waiting on the same map gets it too.
    for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].map.id === job.map.id) { waiting[i].done(url); waiting.splice(i, 1); }
    job.done(url);
    busy = false;
    pump();
  }, { timeout: 400 });
}
