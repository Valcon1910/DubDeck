// Packs a scenery kit exported from Blender (scripts/hexdrift-kit): each
// object as it is, plus a far-away version ("name~far", simplified), with
// positions as 16-bit integers, normals as 8-bit, triangles reordered for
// the graphics card and everything meshopt-compressed.
//
//   node scripts/hexdrift-pack-kit.mjs in.glb out.glb [far keep 0..1]
import { readFileSync, writeFileSync } from "node:fs";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const [src, dst, keepArg] = process.argv.slice(2);
const farKeep = keepArg ? Number(keepArg) : 0.22;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

// ── Read the glb ──
const file = readFileSync(src);
const jsonLen = file.readUInt32LE(12);
const json = JSON.parse(file.toString("utf8", 20, 20 + jsonLen));
const binAt = 20 + jsonLen;
const bin = file.subarray(binAt + 8, binAt + 8 + file.readUInt32LE(binAt));
const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function read(i) {
  const a = json.accessors[i], v = json.bufferViews[a.bufferView];
  const T = COMP[a.componentType], n = SIZE[a.type];
  const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const copy = new Uint8Array(a.count * n * T.BYTES_PER_ELEMENT);
  copy.set(bin.subarray(off, off + copy.length));
  return new T(copy.buffer);
}

// ── Gather the primitives (one mesh per object, one primitive per material) ──
const prims = [];
function pack(p, pos, nrm, idx) {
  const [remap, unique] = MeshoptEncoder.reorderMesh(idx, true, false);
  const p2 = new Float32Array(unique * 3), n2 = new Float32Array(unique * 3);
  for (let i = 0; i < remap.length; i++) {
    const j = remap[i];
    if (j === 0xffffffff) continue;
    p2.set(pos.subarray(i * 3, i * 3 + 3), j * 3);
    n2.set(nrm.subarray(i * 3, i * 3 + 3), j * 3);
  }
  prims.push({ p, pos: p2, nrm: n2, idx, count: unique });
}
const meshCount = json.meshes.length;
// Kits built with far versions of their own (name~far) keep those as they are.
const ownFar = json.nodes.some((n) => n.name?.endsWith("~far"));
const farMesh = new Set(json.nodes.filter((n) => n.name?.endsWith("~far")).map((n) => n.mesh));
let full = 0, far = 0;
for (let mi = 0; mi < meshCount; mi++) {
  const mesh = json.meshes[mi];
  // Size of the object (for the simplifier's error and for dropping tiny bits far away).
  let ext = 0;
  const raw = mesh.primitives.map((p) => {
    const pos = read(p.attributes.POSITION);
    for (const v of pos) ext = Math.max(ext, Math.abs(v));
    return { p, pos, nrm: read(p.attributes.NORMAL), idx: Uint32Array.from(read(p.indices)) };
  });
  const farPrims = [];
  for (const q of raw) {
    pack(q.p, q.pos, q.nrm, q.idx);
    if (ownFar) { if (farMesh.has(mi)) far += q.idx.length / 3; else full += q.idx.length / 3; continue; }
    full += q.idx.length / 3;
    // Far version: simplified, small parts dropped.
    let idx = q.idx;
    if (idx.length > 90) {
      const target = Math.max(36, Math.floor((idx.length * farKeep) / 3) * 3);
      let [out] = MeshoptSimplifier.simplifyWithAttributes(idx, q.pos, 3, q.nrm, 3, [0.3, 0.3, 0.3], null, target, 0.03);
      if (out.length > target * 1.6) out = MeshoptSimplifier.simplifySloppy(idx, q.pos, 3, null, target, 0.04)[0];
      idx = out;
    }
    if (idx.length < 3) continue;
    const p2 = JSON.parse(JSON.stringify(q.p));
    farPrims.push(p2);
    pack(p2, q.pos, q.nrm, idx);
    far += idx.length / 3;
  }
  if (!ownFar) json.meshes.push({ name: mesh.name + "~far", primitives: farPrims });
}
for (const node of ownFar ? [] : [...json.nodes]) {
  if (node.mesh === undefined) continue;
  json.nodes.push({ name: node.name + "~far", mesh: meshCount + node.mesh, ...(node.translation ? { translation: node.translation } : {}) });
}
json.scenes[0].nodes = json.nodes.map((_, i) => i);

// ── Quantise: one grid for the whole car, undone by the node's scale ──
let big = 0;
for (const q of prims) for (const v of q.pos) big = Math.max(big, Math.abs(v));
const step = big / 32767;

const views = [], accessors = [], chunks = [];
let rawLen = 0, packedLen = 0;
function addView(raw, count, stride, mode, target) {
  const enc = MeshoptEncoder.encodeGltfBuffer(raw, count, stride, mode);
  const pad = (4 - (enc.length % 4)) % 4;
  views.push({
    buffer: 1, byteOffset: rawLen, byteLength: raw.length, ...(mode === "ATTRIBUTES" ? { byteStride: stride } : {}), target,
    extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: packedLen, byteLength: enc.length, byteStride: stride, mode, count } },
  });
  chunks.push(enc, new Uint8Array(pad));
  packedLen += enc.length + pad;
  rawLen += raw.length + ((4 - (raw.length % 4)) % 4);
  return views.length - 1;
}

for (const q of prims) {
  const n = q.count;
  const P = new Int16Array(n * 4), N = new Int8Array(n * 4);
  const mn = [32767, 32767, 32767], mx = [-32767, -32767, -32767];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = Math.round(q.pos[i * 3 + c] / step);
      P[i * 4 + c] = v; mn[c] = Math.min(mn[c], v); mx[c] = Math.max(mx[c], v);
    }
    const x = q.nrm[i * 3], y = q.nrm[i * 3 + 1], z = q.nrm[i * 3 + 2], l = Math.hypot(x, y, z) || 1;
    N[i * 4] = Math.round((x / l) * 127); N[i * 4 + 1] = Math.round((y / l) * 127); N[i * 4 + 2] = Math.round((z / l) * 127);
  }
  const small = n < 65536;
  const I = small ? Uint16Array.from(q.idx) : q.idx;
  const pv = addView(new Uint8Array(P.buffer), n, 8, "ATTRIBUTES", 34962);
  const nv = addView(new Uint8Array(N.buffer), n, 4, "ATTRIBUTES", 34962);
  const iv = addView(new Uint8Array(I.buffer), I.length, small ? 2 : 4, "TRIANGLES", 34963);
  accessors.push({ bufferView: pv, componentType: 5122, count: n, type: "VEC3", min: mn, max: mx });
  accessors.push({ bufferView: nv, componentType: 5120, normalized: true, count: n, type: "VEC3" });
  accessors.push({ bufferView: iv, componentType: small ? 5123 : 5125, count: I.length, type: "SCALAR" });
  q.p.attributes = { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 };
  q.p.indices = accessors.length - 1;
}

json.accessors = accessors;
json.bufferViews = views;
json.buffers = [{ byteLength: packedLen }, { byteLength: rawLen, extensions: { EXT_meshopt_compression: { fallback: true } } }];
for (const node of json.nodes) if (node.mesh !== undefined) node.scale = [step, step, step];
json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), "EXT_meshopt_compression", "KHR_mesh_quantization"])];
json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), "EXT_meshopt_compression", "KHR_mesh_quantization"])];
json.asset.generator = "Blender + hexdrift-pack-kit";

// ── Write the glb ──
const pad4 = (b, fill) => { const p = (4 - (b.length % 4)) % 4; return p ? Buffer.concat([b, Buffer.alloc(p, fill)]) : b; };
const J = pad4(Buffer.from(JSON.stringify(json)), 0x20);
const B = pad4(Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))), 0);
const head = Buffer.alloc(12);
head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + J.length + 8 + B.length, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
writeFileSync(dst, Buffer.concat([head, ch(J.length, 0x4e4f534a), J, ch(B.length, 0x004e4942), B]));
console.log(`${dst}: ${full} triangles near, ${far} far, ${(file.length / 1024).toFixed(0)} KB -> ${((28 + J.length + B.length) / 1024).toFixed(0)} KB`);
