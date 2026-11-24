// Tyre marks left on the ground: black rubber on the road when you drift or
// brake hard, pale scratches on ice, and ruts in sand, snow, dirt and grass
// whenever you drive on them. One mesh, a ring of quads; the oldest marks
// are reused when it fills up.
import * as THREE from "three";

const SEGS = 1400;

interface Wheel { x: number; y: number; z: number; on: boolean }

export class Skids {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(SEGS * 4 * 3);
  private col = new Float32Array(SEGS * 4 * 4);
  private next = 0;
  private wheels: Wheel[] = [];
  private dirty = false;
  private c = new THREE.Color();

  constructor() {
    const idx = new Uint32Array(SEGS * 6);
    for (let i = 0; i < SEGS; i++) {
      const a = i * 4;
      idx.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i * 6);
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /**
   * Marks for wheel n at (x, y, z), sideways vector (rx, rz), this wide.
   * strength 0 lifts the wheel (the mark ends there).
   */
  mark(n: number, x: number, y: number, z: number, rx: number, rz: number, width: number, strength: number, color: THREE.ColorRepresentation) {
    const w = (this.wheels[n] ??= { x, y, z, on: false });
    if (strength <= 0.02) { w.on = false; return; }
    const d2 = (x - w.x) ** 2 + (z - w.z) ** 2;
    if (!w.on || d2 > 36) { w.x = x; w.y = y; w.z = z; w.on = true; return; }
    if (d2 < 0.36) return;
    const i = this.next;
    this.next = (this.next + 1) % SEGS;
    const h = width / 2;
    const p = this.pos, o = i * 12;
    const lift = 0.04;
    p[o] = w.x - rx * h; p[o + 1] = w.y + lift; p[o + 2] = w.z - rz * h;
    p[o + 3] = w.x + rx * h; p[o + 4] = w.y + lift; p[o + 5] = w.z + rz * h;
    p[o + 6] = x - rx * h; p[o + 7] = y + lift; p[o + 8] = z - rz * h;
    p[o + 9] = x + rx * h; p[o + 10] = y + lift; p[o + 11] = z + rz * h;
    this.c.set(color);
    const a = Math.min(1, strength);
    for (let v = 0; v < 4; v++) {
      const q = i * 16 + v * 4;
      this.col[q] = this.c.r; this.col[q + 1] = this.c.g; this.col[q + 2] = this.c.b; this.col[q + 3] = a;
    }
    w.x = x; w.y = y; w.z = z;
    this.dirty = true;
  }

  /** Ends every mark (respawn: don't draw a line across the map). */
  lift() { for (const w of this.wheels) if (w) w.on = false; }

  clear() {
    this.col.fill(0);
    this.lift();
    this.dirty = true;
  }

  update() {
    if (!this.dirty) return;
    this.dirty = false;
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
