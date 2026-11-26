// The studio's 3D view: the map's world (road, terrain, sky) with the free
// parts and placed objects drawn one by one, so each can be picked and moved.
// Orbit with the mouse, move, turn and resize with the handles. Only the
// pictures live here: every change goes back to the studio as a new map.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { CustomMap } from "../sim/custom.ts";
import { THEMES } from "../sim/custom.ts";
import { KITS } from "../sim/kit.ts";
import { buildParts as simParts, type PartDef } from "../sim/parts.ts";
import { roadTerrain, type Road } from "../sim/road.ts";
import { buildRoadTrack, type Spot, type Track } from "../sim/track.ts";
import { BIOMES } from "../maps.ts";
import { mapDefOf } from "../mymaps.ts";
import { LOOKS, setupScene } from "./roadworld.ts";
import { lookWith } from "./env.ts";
import { buildWorld, type World } from "./world.ts";
import { MAT_COLOR } from "./parts.ts";
import { kitShapes } from "./kit.ts";

export type Pick = { kind: "part" | "obj"; i: number };
export type Tool = "select" | "move" | "rotate" | "scale" | "terrain";

export interface StudioEvents {
  /** A click on a part or object (or on nothing); `add` with Shift or Ctrl held. */
  pick(p: Pick | null, add: boolean): void;
  /** A handle drag ended: the part or object's new place. */
  moved(p: Pick, pos: [number, number, number], rot: [number, number, number], size: [number, number, number] | null): void;
  /** The terrain brush: pressed (start), dragged, released (end), at a ground point. */
  brush(phase: "start" | "move" | "end", x: number, z: number): void;
}

const DEG = Math.PI / 180;

function wedge() {
  const v = [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [-1, 1, 1], [1, 1, 1]];
  const tri = [[0, 2, 1], [0, 3, 2], [3, 4, 5], [3, 5, 2], [0, 4, 3], [1, 2, 5], [0, 1, 5], [0, 5, 4]];
  const pos: number[] = [];
  for (const t of tri) for (const i of t) pos.push(...v[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** World key: what, when changed, means the world itself must be built again. */
const worldKey = (m: CustomMap) => JSON.stringify([m.theme, m.pieces, m.terrain ?? null, m.env ?? null, m.scenery ?? true]);

export class StudioView {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private scene = new THREE.Scene();
  private orbit: OrbitControls;
  private gizmo: TransformControls;
  private world: World | null = null;
  private lights: THREE.Object3D[] = [];
  private key = "";
  private track: Track | null = null;
  private partsG = new THREE.Group();
  private objsG = new THREE.Group();
  private selG = new THREE.Group();
  private brushRing: THREE.Mesh;
  private geo: Record<string, THREE.BufferGeometry>;
  private mats = new Map<string, THREE.Material>();
  private shapes: Map<string, THREE.BufferGeometry> | null = null;
  private kitName = "";
  private kitMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
  private map: CustomMap | null = null;
  private sel: Pick[] = [];
  private tool: Tool = "select";
  private ro: ResizeObserver;
  private ray = new THREE.Raycaster();
  private dragging = false;
  private brushing = false;
  private brushR = 16;
  private down: { x: number; y: number; t: number } | null = null;
  private alive = true;
  private pending = 0;

  constructor(private host: HTMLElement, private ev: StudioEvents) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const cv = this.renderer.domElement;
    cv.className = "hx-st-canvas";
    host.prepend(cv);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 2600);
    this.camera.position.set(-60, 70, -60);
    this.orbit = new OrbitControls(this.camera, cv);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.15;
    this.orbit.screenSpacePanning = false;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.maxDistance = 1500;
    this.orbit.minDistance = 4;
    this.gizmo = new TransformControls(this.camera, cv);
    this.gizmo.setSize(0.9);
    this.gizmo.addEventListener("dragging-changed", (e) => {
      this.dragging = !!(e as unknown as { value: boolean }).value;
      this.orbit.enabled = !this.dragging;
      if (!this.dragging) this.dragEnd();
    });
    this.gizmo.addEventListener("objectChange", () => this.followSel());
    this.scene.add(this.gizmo.getHelper());
    this.geo = { box: new THREE.BoxGeometry(2, 2, 2), wedge: wedge(), ramp: wedge(), cyl: new THREE.CylinderGeometry(1, 1, 2, 24), ball: new THREE.SphereGeometry(1, 20, 14) };
    this.scene.add(this.partsG, this.objsG, this.selG);
    this.brushRing = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, depthTest: false, fog: false }));
    this.brushRing.renderOrder = 10;
    this.brushRing.visible = false;
    this.scene.add(this.brushRing);

    cv.addEventListener("pointerdown", this.onDown);
    cv.addEventListener("pointermove", this.onMove);
    cv.addEventListener("pointerup", this.onUp);
    cv.addEventListener("pointerleave", () => { if (!this.brushing) this.brushRing.visible = false; });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    if (!this.alive || document.hidden) return;
    this.orbit.update();
    const sky = this.world?.group.getObjectByName("sky");
    if (sky) sky.position.copy(this.camera.position);
    this.world?.update(1 / 60, 0, this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  /** Shows a map: the world is built again only when the road, terrain or sky changed. */
  setMap(m: CustomMap) {
    const first = !this.map;
    this.map = m;
    const k = worldKey(m);
    if (k !== this.key) {
      this.key = k;
      clearTimeout(this.pending);
      // Rebuilt once a slider or brush has settled, not on every step.
      if (first) { this.buildWorld(m); this.home(); }
      else this.pending = window.setTimeout(() => { if (this.alive && this.map) this.buildWorld(this.map); }, 120);
    }
    const kit = THEMES[m.theme].kit;
    if (kit !== this.kitName) {
      this.kitName = kit;
      this.shapes = null;
      void kitShapes(kit).then((s) => { if (this.alive && this.kitName === kit) { this.shapes = s; if (this.map) this.syncObjs(this.map); } });
    }
    if (!this.dragging) { this.syncParts(m); this.syncObjs(m); this.syncSel(); }
  }

  private buildWorld(m: CustomMap) {
    if (this.world) { this.scene.remove(this.world.group); this.world.dispose(); }
    for (const l of this.lights) this.scene.remove(l);
    // Parts and objects are drawn by the studio itself (so each can be picked).
    const def = mapDefOf({ ...m, parts: undefined, objs: undefined });
    let track: Track;
    // Built here, not through the game's track cache (the studio builds a new one on every change).
    try { track = buildRoadTrack(def.road!, def.biome); } catch { this.world = null; this.track = null; return; }
    this.track = track;
    const biome = BIOMES[def.biome];
    const E = lookWith(def.biome, LOOKS[def.biome] ?? LOOKS.miami!, biome, m.env);
    const before = new Set(this.scene.children);
    setupScene(this.scene, E.biome, def.biome, true, 1, 1, E.look);
    this.lights = this.scene.children.filter((o) => !before.has(o));
    this.world = buildWorld(track, E.biome, def.biome, E.look);
    this.world.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name !== "sky") o.userData.ground = true; });
    this.scene.add(this.world.group);
  }

  get road(): Road | null { return this.track?.road ?? null; }

  /** Looks at the start from behind and above. */
  home() {
    const p = this.road?.strands[0].pts[0];
    if (!p) return;
    this.orbit.target.set(p.x, p.y, p.z);
    this.camera.position.set(p.x - p.dx * 50, p.y + 40, p.z - p.dz * 50);
  }

  focus(x: number, y: number, z: number, dist = 30) {
    const d = this.camera.position.clone().sub(this.orbit.target).setLength(dist);
    this.orbit.target.set(x, y, z);
    this.camera.position.set(x + d.x, y + d.y, z + d.z);
  }

  private matFor(d: PartDef) {
    const m = d.m ?? "solid";
    const c = m === "solid" && d.c ? d.c : MAT_COLOR[m];
    const k = `${m}${c}`;
    let mat = this.mats.get(k);
    if (!mat) {
      mat = m === "boost" || m === "kill"
        ? new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 })
        : new THREE.MeshStandardMaterial({ color: c, roughness: m === "ice" ? 0.15 : 0.55, metalness: 0.15 });
      this.mats.set(k, mat);
    }
    return mat;
  }

  private syncParts(m: CustomMap) {
    const defs = m.parts ?? [];
    const sim = simParts(defs).list;
    const G = this.partsG;
    while (G.children.length > defs.length) G.remove(G.children[G.children.length - 1]);
    defs.forEach((d, i) => {
      let mesh = G.children[i] as THREE.Mesh | undefined;
      if (!mesh) { mesh = new THREE.Mesh(); G.add(mesh); }
      mesh.geometry = this.geo[d.s];
      mesh.material = this.matFor(d);
      const p = sim[i];
      mesh.position.set(d.p[0], d.p[1], d.p[2]);
      const r = d.r ?? [0, 0, 0];
      mesh.rotation.set(r[1] * DEG, r[0] * DEG, r[2] * DEG, "YXZ");
      mesh.scale.set(p.hx, p.hy, p.hz);
      mesh.userData.pick = { kind: "part", i } satisfies Pick;
    });
  }

  /** Ground height for an object (as the scenery composer puts it). */
  groundY(x: number, z: number) {
    const r = this.road;
    if (!r) return 0;
    const h = roadTerrain(r, x, z).h;
    return h < -1e7 ? r.strands[0].pts[0].y : h;
  }

  private syncObjs(m: CustomMap) {
    const defs = m.objs ?? [];
    const kit = KITS[THEMES[m.theme].kit] ?? {};
    const G = this.objsG;
    while (G.children.length > defs.length) G.remove(G.children[G.children.length - 1]);
    defs.forEach((d, i) => {
      let mesh = G.children[i] as THREE.Mesh | undefined;
      if (!mesh) { mesh = new THREE.Mesh(); G.add(mesh); }
      const shape = this.shapes?.get(d.o);
      const k = kit[d.o];
      if (shape) { mesh.geometry = shape; mesh.material = this.kitMat; mesh.scale.set(1, 1, 1); }
      else {
        // Not loaded yet (or no model): its footprint as a box.
        mesh.geometry = this.geo.box;
        mesh.material = this.matFor({ s: "box", p: [0, 0, 0], z: [1, 1, 1], c: "#c8ccd8" });
        mesh.scale.set(k?.a ?? 2, (k?.h ?? 4) / 2, k?.b ?? 2);
      }
      const y = this.groundY(d.p[0], d.p[1]) - 0.3 + (d.y ?? 0);
      mesh.position.set(d.p[0], shape ? y : y + (k?.h ?? 4) / 2, d.p[1]);
      mesh.rotation.set(0, (d.r ?? 0) * DEG, 0);
      mesh.userData.pick = { kind: "obj", i } satisfies Pick;
      mesh.userData.base = shape ? 0 : (k?.h ?? 4) / 2;
    });
  }

  private meshOf(p: Pick) {
    return (p.kind === "part" ? this.partsG : this.objsG).children[p.i] as THREE.Mesh | undefined;
  }

  setSel(sel: Pick[]) { this.sel = sel; this.syncSel(); }

  private syncSel() {
    for (const c of [...this.selG.children]) { this.selG.remove(c); (c as THREE.BoxHelper).geometry.dispose(); }
    for (const p of this.sel) {
      const m = this.meshOf(p);
      if (m) this.selG.add(new THREE.BoxHelper(m, p === this.sel[this.sel.length - 1] ? "#ffd23d" : "#7fd8ff"));
    }
    const last = this.sel[this.sel.length - 1];
    const mesh = last && this.meshOf(last);
    const mode = this.tool === "move" ? "translate" : this.tool === "rotate" ? "rotate" : this.tool === "scale" ? "scale" : null;
    if (mesh && mode && !(last.kind === "obj" && mode === "scale")) {
      this.gizmo.attach(mesh);
      this.gizmo.setMode(mode);
      // Objects stand on the ground: they turn about the vertical only.
      const obj = last.kind === "obj";
      this.gizmo.showX = !(obj && mode === "rotate");
      this.gizmo.showZ = !(obj && mode === "rotate");
      this.gizmo.showY = true;
      this.gizmo.setSpace(mode === "scale" ? "local" : "world");
    } else this.gizmo.detach();
  }

  private followSel() { for (const h of this.selG.children) (h as THREE.BoxHelper).update(); }

  setTool(t: Tool) {
    this.tool = t;
    this.brushRing.visible = false;
    this.syncSel();
  }

  setSnap(move: number, turn: number) {
    this.gizmo.setTranslationSnap(move > 0 ? move : null);
    this.gizmo.setRotationSnap(turn > 0 ? turn * DEG : null);
    this.gizmo.setScaleSnap(null);
  }

  setBrush(r: number) { this.brushR = r; this.brushRing.scale.setScalar(r); }

  private dragEnd() {
    const p = this.sel[this.sel.length - 1];
    const mesh = p && this.meshOf(p);
    if (!p || !mesh) return;
    const round = (v: number, s = 100) => Math.round(v * s) / s;
    const e = new THREE.Euler().setFromQuaternion(mesh.quaternion, "YXZ");
    const rot: [number, number, number] = [round(e.y / DEG, 10), round(e.x / DEG, 10), round(e.z / DEG, 10)];
    if (p.kind === "part") {
      const size: [number, number, number] = [round(mesh.scale.x * 2), round(mesh.scale.y * 2), round(mesh.scale.z * 2)];
      this.ev.moved(p, [round(mesh.position.x), round(mesh.position.y), round(mesh.position.z)], rot, this.tool === "scale" ? size : null);
    } else {
      const x = round(mesh.position.x), z = round(mesh.position.z);
      const lift = round(mesh.position.y - (mesh.userData.base as number) - (this.groundY(x, z) - 0.3));
      this.ev.moved(p, [x, lift, z], rot, null);
    }
  }

  /** A screen point (client coordinates) as a ray. */
  private rayAt(cx: number, cy: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera);
    return this.ray;
  }

  /** The part or object under a screen point. */
  pickAt(cx: number, cy: number): Pick | null {
    const hit = this.rayAt(cx, cy).intersectObjects([...this.partsG.children, ...this.objsG.children], false)[0];
    return hit ? (hit.object.userData.pick as Pick) : null;
  }

  /** The ground (land, road or water) under a screen point. */
  groundAt(cx: number, cy: number): [number, number, number] | null {
    const ray = this.rayAt(cx, cy);
    if (this.world) {
      const meshes: THREE.Object3D[] = [];
      this.world.group.traverse((o) => { if (o.userData.ground && ["terrain", "road", "water"].includes(o.name)) meshes.push(o); });
      const hit = ray.intersectObjects(meshes, false)[0];
      if (hit) return [hit.point.x, hit.point.y, hit.point.z];
    }
    // Nothing hit (open sky): the level of the start.
    const y = this.road?.strands[0].pts[0].y ?? 0;
    const o = ray.ray.origin, d = ray.ray.direction;
    if (Math.abs(d.y) < 1e-4) return null;
    const t = (y - o.y) / d.y;
    if (t < 0 || t > 3000) return null;
    return [o.x + d.x * t, y, o.z + d.z * t];
  }

  /** Where the camera looks (for placing new things). */
  target(): [number, number, number] { const t = this.orbit.target; return [t.x, t.y, t.z]; }

  /** The road point nearest where the camera looks: a place to start driving from. */
  spotHere(): Spot | null {
    const pts = this.road?.strands[0].pts;
    if (!pts) return null;
    const t = this.orbit.target;
    let best = pts[0], bd = Infinity;
    for (const p of pts) { const d = (p.x - t.x) ** 2 + (p.z - t.z) ** 2; if (d < bd) { bd = d; best = p; } }
    return { x: best.x, y: best.y, z: best.z, yaw: best.yaw };
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (this.tool === "terrain" && !e.altKey) {
      const g = this.groundAt(e.clientX, e.clientY);
      if (!g) return;
      this.brushing = true;
      this.orbit.enabled = false;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      this.ev.brush("start", g[0], g[2]);
    }
  };

  private onMove = (e: PointerEvent) => {
    if (this.tool !== "terrain") return;
    const g = this.groundAt(e.clientX, e.clientY);
    if (!g) { this.brushRing.visible = false; return; }
    this.brushRing.visible = true;
    this.brushRing.position.set(g[0], g[1] + 0.3, g[2]);
    this.brushRing.scale.setScalar(this.brushR);
    if (this.brushing) this.ev.brush("move", g[0], g[2]);
  };

  private onUp = (e: PointerEvent) => {
    if (this.brushing) {
      this.brushing = false;
      this.orbit.enabled = true;
      const g = this.groundAt(e.clientX, e.clientY);
      this.ev.brush("end", g?.[0] ?? 0, g?.[2] ?? 0);
      return;
    }
    const d = this.down;
    this.down = null;
    if (!d || this.dragging || this.tool === "terrain") return;
    // A click (not an orbit drag) picks.
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
    this.ev.pick(this.pickAt(e.clientX, e.clientY), e.shiftKey || e.ctrlKey || e.metaKey);
  };

  dispose() {
    this.alive = false;
    clearTimeout(this.pending);
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.world?.dispose();
    for (const g of Object.values(this.geo)) g.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.kitMat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
