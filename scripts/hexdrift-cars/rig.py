# Cyber Rig body for Hexdrift (a steel-panelled electric truck), built in
# Blender (headless):
#   blender -b -P scripts/hexdrift-cars/rig.py -- out.glb
# Same conventions as coupe.py, but no smooth surfaces: flat steel planes
# with slightly rounded edges, trapezoid wheel arches with black cladding.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from carkit import *

reset()


def lerp(a, b, t):
    return a + (b - a) * t


# Half cross-sections (x, y) from the bottom centre up to the roof centre.
def sec(yb, belt, rx, ry, top):
    return [(0, yb), (1.0, yb), (1.08, yb + 0.08), (1.08, belt), (rx, ry), (0, top)]


# The roof is one straight line nose -> peak and one peak -> tail.
NOSE, PEAK, TAIL = 2.66, -0.15, -2.62
def roof_at(z):
    if z >= PEAK:
        t = (NOSE - z) / (NOSE - PEAK)
        return lerp(0.98, 0.80, t), lerp(1.06, 1.86, t), lerp(1.08, 1.90, t)
    t = (PEAK - z) / (PEAK - TAIL)
    return lerp(0.80, 1.0, t), lerp(1.86, 1.29, t), lerp(1.90, 1.30, t)


S = []
for z, yb, belt in [(NOSE, 0.60, 1.0), (1.0, 0.56, 1.25), (PEAK, 0.56, 1.27), (TAIL, 0.60, 1.27)]:
    rx, ry, top = roof_at(z)
    S.append((z, sec(yb, belt, rx, ry, top)))

bm = bmesh.new()
rings = []
for z, half in S:
    pts = half + [(-x, y) for x, y in reversed(half[1:-1])]
    rings.append([bm.verts.new(G(x, y, z)) for x, y in pts])
n = len(rings[0])
for A, B in zip(rings, rings[1:]):
    for i in range(n):
        bm.faces.new((A[i], A[(i + 1) % n], B[(i + 1) % n], B[i]))
bm.faces.new(rings[0]); bm.faces.new(list(reversed(rings[-1])))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
body = link("Body", bm, "paint")

# ── Trapezoid wheel arches ──
WHEELS = [(0.98, 1.72, 0.48), (0.98, -1.68, 0.48)]
def trapezoid(z, r, bot, top, wb, wt):
    return [(z - r * wb, bot), (z - r * wt, top), (z + r * wt, top), (z + r * wb, bot)]

for x, z, r in WHEELS:
    for s in (1, -1):
        cut_pts = trapezoid(z, r, 0.3, 1.10, 1.25, 0.82)
        cb = bmesh.new()
        a = [cb.verts.new(G(s * 0.62, y, zz)) for zz, y in cut_pts]
        b = [cb.verts.new(G(s * 1.5, y, zz)) for zz, y in cut_pts]
        for i in range(4):
            j = (i + 1) % 4
            cb.faces.new((a[i], a[j], b[j], b[i]))
        cb.faces.new(a); cb.faces.new(list(reversed(b)))
        bmesh.ops.recalc_face_normals(cb, faces=cb.faces)
        me = bpy.data.meshes.new("cut"); cb.to_mesh(me); cb.free()
        cut = bpy.data.objects.new("cut", me); bpy.context.scene.collection.objects.link(cut)
        cut.data.materials.append(mat("trim"))
        if not body.data.materials.get("trim"):
            body.data.materials.append(mat("trim"))
        m = body.modifiers.new("arch", "BOOLEAN")
        m.operation = "DIFFERENCE"; m.object = cut; m.solver = "EXACT"; m.material_mode = "TRANSFER"
        apply_mod(body, m)
        bpy.data.objects.remove(cut)

# Slightly rounded edges catch the light like folded steel.
m = body.modifiers.new("bev", "BEVEL")
m.width = 0.018; m.segments = 2; m.limit_method = "ANGLE"; m.angle_limit = math.radians(20)
apply_mod(body, m)
smooth(body)
sharpen(body, 30)
under_trim(body)

# ── Black cladding round the arches and along the sills ──
def band(material, outer, inner, x0, x1):
    """A flat band between two open polylines (z, y), x0..x1 thick."""
    b = bmesh.new()
    lay = []
    for x in (x0, x1):
        lay.append(([b.verts.new(G(x, y, z)) for z, y in outer], [b.verts.new(G(x, y, z)) for z, y in inner]))
    for (o, i) in lay:
        for k in range(len(o) - 1):
            b.faces.new((o[k], o[k + 1], i[k + 1], i[k]))
    (o0, i0), (o1, i1) = lay
    for k in range(len(o0) - 1):
        b.faces.new((o0[k], o0[k + 1], o1[k + 1], o1[k]))
        b.faces.new((i0[k], i0[k + 1], i1[k + 1], i1[k]))
    b.faces.new((o0[0], i0[0], i1[0], o1[0])); b.faces.new((o0[-1], i0[-1], i1[-1], o1[-1]))
    bmesh.ops.recalc_face_normals(b, faces=b.faces)
    ob = link("band", b, material)
    bev = ob.modifiers.new("bev", "BEVEL"); bev.width = 0.008; bev.segments = 1
    apply_mod(ob, bev)
    return ob

for x, z, r in WHEELS:
    for s in (1, -1):
        outer = trapezoid(z, r, 0.56, 1.18, 1.52, 0.98)
        inner = trapezoid(z, r, 0.56, 1.10, 1.25, 0.82)
        x0, x1 = (1.07, 1.12) if s > 0 else (-1.12, -1.07)
        band("trim", outer, inner, x0, x1)
for s in (1, -1):
    x0, x1 = (1.07, 1.11) if s > 0 else (-1.11, -1.07)
    band("trim", [(1.72 - 0.48 * 1.52, 0.56), (-1.68 + 0.48 * 1.52, 0.56)], [(1.72 - 0.48 * 1.52, 0.76), (-1.68 + 0.48 * 1.52, 0.76)], x0, x1)

# ── Glass: one raked windscreen, a glass roof, long side windows ──
ws = [(-0.80, 0.98), (0.80, 0.98), (0.73, -0.08), (-0.73, -0.08)]
top_decal(body, "glass", ws, 0.006)
top_decal(body, "gloss", ws, 0.006, ring=0.025)
roof = [(-0.70, -0.24), (0.70, -0.24), (0.74, -1.05), (-0.74, -1.05)]
top_decal(body, "glass", roof, 0.006)
top_decal(body, "gloss", roof, 0.006, ring=0.02)
def rail_y(z):
    return roof_at(z)[1]
side = [(0.92, 1.31), (0.92, rail_y(0.92) - 0.06), (-0.15, rail_y(-0.15) - 0.06), (-1.25, rail_y(-1.25) - 0.06), (-1.25, 1.31)]
side_decal(body, "gloss", side, 0.004, ring=0.03)
side_decal(body, "glass", side, 0.008)
side_decal(body, "gloss", [(-0.22, 1.30), (-0.12, 1.30), (-0.12, 1.82), (-0.22, 1.82)], 0.01)
# A single long wiper resting at the bottom of the screen.
top_decal(body, "trim", strip([(-0.70, 1.02), (0.55, 0.92)], 0.03), 0.012)

# ── Front and rear: full-width light bars, black bumpers ──
front_decal(body, "lamp", [(-1.04, 1.015), (1.04, 1.015), (1.04, 1.05), (-1.04, 1.05)], 0.008)
front_decal(body, "gloss", [(-1.06, 0.99), (1.06, 0.99), (1.06, 1.06), (-1.06, 1.06)], 0.004)
box("trim", (0, 0.70, 2.65), (2.08, 0.34, 0.16), bevel=0.02)
for i in range(5):
    box("gloss", (0, 0.58 + i * 0.05, 2.735), (1.2, 0.018, 0.02))
rear_decal(body, "tail", [(-1.04, 1.215), (1.04, 1.215), (1.04, 1.255), (-1.04, 1.255)], 0.008)
rear_decal(body, "gloss", [(-1.06, 1.19), (1.06, 1.19), (1.06, 1.27), (-1.06, 1.27)], 0.004)
box("trim", (0, 0.72, -2.62), (2.08, 0.30, 0.14), bevel=0.02)
rear_decal(body, "gloss", [(-0.30, 0.95), (0.30, 0.95), (0.30, 1.10), (-0.30, 1.10)], 0.006)

# ── Panel gaps: doors, hood (frunk), tailgate, the covered bed ──
GAP = 0.01
for zz in (1.0, -0.20, -1.30):
    side_decal(body, "trim", strip([(zz, 0.78), (zz, 1.27)], GAP), 0.003)
top_decal(body, "trim", strip([(-0.86, 1.05), (-0.92, 2.58), (0.92, 2.58), (0.86, 1.05)], GAP), 0.003)
for zz in (-1.35, -1.75, -2.15):
    top_decal(body, "trim", strip([(-0.95, zz), (0.95, zz)], GAP), 0.003)
rear_decal(body, "trim", strip([(-1.0, 0.92), (1.0, 0.92)], GAP), 0.003)
side_decal(body, "chrome", [(0.55, 1.12), (0.72, 1.12), (0.72, 1.14), (0.55, 1.14)], 0.006)
for s in (1, -1):
    box("trim", (s * 1.13, 1.30, 0.90), (0.12, 0.04, 0.05))
    box("paint", (s * 1.22, 1.36, 0.88), (0.12, 0.13, 0.2), bevel=0.02)
    box("glass", (s * 1.225, 1.36, 0.775), (0.09, 0.09, 0.01))

finish(sys.argv[sys.argv.index("--") + 1])
