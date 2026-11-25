# Cyber Rig body for Hexdrift (a steel-panelled electric pickup), built in
# Blender (headless):
#   blender -b -P scripts/hexdrift-cars/rig.py -- out.glb
# Same conventions as coupe.py, but no smooth surfaces: flat steel planes
# with slightly softened edges.
#
# The shape: one straight roof line from the nose edge up to a peak over the
# front seats, one straight line down to the tailgate. In section it is a
# wedge: the sides are widest at a sharp belt crease and lean in above it
# (the glass) and below it (the lower doors). Trapezoid wheel arches with
# black cladding that runs along the sills.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from carkit import *

reset()


def lerp(a, b, t):
    return a + (b - a) * t


def along(pts, z):
    """Piecewise-linear value along the car: pts [(z, v)] from front to back."""
    for (z0, v0), (z1, v1) in zip(pts, pts[1:]):
        if z1 <= z <= z0:
            return lerp(v0, v1, (z0 - z) / (z0 - z1))
    return pts[0][1] if z > pts[0][0] else pts[-1][1]


NOSE, PEAK, TAIL = 2.70, 0.30, -2.62
TOP = [(NOSE, 1.04), (PEAK, 1.92), (TAIL, 1.30)]            # roof centre line
RAIL_X = [(NOSE, 0.92), (PEAK, 0.76), (-1.0, 0.92), (TAIL, 0.98)]  # roof edge
BELT = [(NOSE, 1.00), (1.25, 1.16), (TAIL, 1.24)]           # the widest crease
BELT_X = 1.10
SILL = (0.98, 0.70)                                        # lower crease
FLOOR = 0.56


def section(z, zf=None):
    """Half section, bottom centre to roof centre; zf moves each point's z
    (the nose and the tailgate lean)."""
    top = along(TOP, z)
    pts = [(0, FLOOR), (0.90, FLOOR), SILL, (BELT_X, along(BELT, z)), (along(RAIL_X, z), top - 0.035), (0, top)]
    return [(x, y, z if zf is None else zf(y)) for x, y in pts]


# The nose: the top edge sticks out, the face leans back down to the bumper.
nose = section(NOSE, lambda y: NOSE - (1.04 - y) * 0.30)
tail = section(TAIL, lambda y: TAIL + (1.30 - y) * 0.06)
S = [nose, section(1.25), section(PEAK), section(-1.0), tail]

bm = bmesh.new()
rings = []
for half in S:
    pts = half + [(-x, y, z) for x, y, z in reversed(half[1:-1])]
    rings.append([bm.verts.new(G(x, y, z)) for x, y, z in pts])
n = len(rings[0])
for A, B in zip(rings, rings[1:]):
    for i in range(n):
        bm.faces.new((A[i], A[(i + 1) % n], B[(i + 1) % n], B[i]))
bm.faces.new(rings[0]); bm.faces.new(list(reversed(rings[-1])))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
if bm.calc_volume(signed=True) < 0:
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
body = link("Body", bm, "paint")

# ── Trapezoid wheel arches ──
WHEELS = [(0.98, 1.72, 0.48), (0.98, -1.68, 0.48)]
def trapezoid(z, r, bot, top, wb, wt):
    return [(z - r * wb, bot), (z - r * wt, top), (z + r * wt, top), (z + r * wb, bot)]

body.data.materials.append(mat("trim"))
for x, z, r in WHEELS:
    for s in (1, -1):
        cut_pts = trapezoid(z, r, 0.3, 1.10, 1.30, 0.80)
        cb = bmesh.new()
        a = [cb.verts.new(G(s * 0.62, y, zz)) for zz, y in cut_pts]
        b = [cb.verts.new(G(s * 1.5, y, zz)) for zz, y in cut_pts]
        for i in range(4):
            j = (i + 1) % 4
            cb.faces.new((a[i], a[j], b[j], b[i]))
        cb.faces.new(a); cb.faces.new(list(reversed(b)))
        bmesh.ops.recalc_face_normals(cb, faces=cb.faces)
        if cb.calc_volume(signed=True) < 0:
            bmesh.ops.reverse_faces(cb, faces=cb.faces)
        me = bpy.data.meshes.new("cut"); cb.to_mesh(me); cb.free()
        cut = bpy.data.objects.new("cut", me); bpy.context.scene.collection.objects.link(cut)
        cut.data.materials.append(mat("trim"))
        m = body.modifiers.new("arch", "BOOLEAN")
        m.operation = "DIFFERENCE"; m.object = cut; m.solver = "EXACT"; m.material_mode = "TRANSFER"
        apply_mod(body, m)
        bpy.data.objects.remove(cut)

# Slightly rounded edges catch the light like folded steel.
m = body.modifiers.new("bev", "BEVEL")
m.width = 0.014; m.segments = 2; m.limit_method = "ANGLE"; m.angle_limit = math.radians(12)
apply_mod(body, m)
smooth(body)
sharpen(body, 30)
under_trim(body)


# ── Black cladding round the arches and along the sills ──
def band(material, outer, inner, xf):
    """A band between two open polylines (z, y), lying on the side: xf(y)
    gives its inner and outer x at each height."""
    b = bmesh.new()
    lay = []
    for k in (0, 1):
        lay.append(([b.verts.new(G(xf(y)[k], y, z)) for z, y in outer], [b.verts.new(G(xf(y)[k], y, z)) for z, y in inner]))
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

# Where the lower door panel is at height y (it leans in towards the sill).
def side_x(y):
    return SILL[0] + (BELT_X - SILL[0]) * (y - SILL[1]) / (1.16 - SILL[1]) if y > SILL[1] else SILL[0]

for x, z, r in WHEELS:
    for s in (1, -1):
        outer = trapezoid(z, r, 0.58, 1.17, 1.58, 0.98)
        inner = trapezoid(z, r, 0.58, 1.10, 1.30, 0.80)
        band("trim", outer, inner, lambda y, s=s: (s * (side_x(y) - 0.04), s * (side_x(y) + 0.025)))
# Sills between the arches.
a, b = 1.72 - 0.48 * 1.58, -1.68 + 0.48 * 1.58
side_decal(body, "trim", [(a, 0.56), (b, 0.56), (b, 0.80), (a, 0.80)], 0.006)

# ── Glass: a huge flat windscreen, glass roof, side windows ──
def rail_y(z):
    return along(TOP, z) - 0.035

ws = [(-0.80, 1.28), (0.80, 1.28), (0.70, 0.36), (-0.70, 0.36)]
top_decal(body, "glass", ws, 0.006)
top_decal(body, "gloss", ws, 0.006, ring=0.03)
roof = [(-0.68, 0.22), (0.68, 0.22), (0.72, -0.72), (-0.72, -0.72)]
top_decal(body, "glass", roof, 0.006)
top_decal(body, "gloss", roof, 0.006, ring=0.03)
# Side windows sit in the leaning upper panel, between the belt and the
# roof edge: front door, rear door ending in a slanted edge.
bl = lambda z: along(BELT, z) + 0.045
win = [(1.18, bl(1.18)), (0.30, rail_y(0.30) - 0.07), (-0.55, rail_y(-0.55) - 0.07), (-1.05, bl(-1.05))]
side_decal(body, "gloss", outline_grow(win, 0.035), 0.004)
side_decal(body, "glass", win, 0.008)
side_decal(body, "gloss", strip([(0.0, bl(0.0) - 0.01), (-0.04, rail_y(-0.04) - 0.06)], 0.07), 0.01)

# ── Front: the light bar along the nose edge, black lower bumper ──
front_decal(body, "gloss", [(-0.90, 0.975), (0.90, 0.975), (0.88, 1.025), (-0.88, 1.025)], 0.004)
front_decal(body, "lamp", strip([(-0.86, 1.0), (0.86, 1.0)], 0.018), 0.008)
front_decal(body, "trim", [(-1.0, 0.56), (1.0, 0.56), (0.96, 0.76), (-0.96, 0.76)], 0.005)
front_decal(body, "gloss", [(-0.55, 0.62), (0.55, 0.62), (0.55, 0.70), (-0.55, 0.70)], 0.008)
for s in (1, -1):
    front_decal(body, "accent", [(s * 0.70, 0.60), (s * 0.92, 0.60), (s * 0.92, 0.64), (s * 0.70, 0.64)], 0.009)

# ── Rear: the tail bar along the top of the tailgate, black bumper ──
rear_decal(body, "gloss", [(-1.04, 1.18), (1.04, 1.18), (1.04, 1.25), (-1.04, 1.25)], 0.004)
rear_decal(body, "tail", strip([(-1.02, 1.215), (1.02, 1.215)], 0.026), 0.008)
rear_decal(body, "trim", [(-1.04, 0.56), (1.04, 0.56), (1.04, 0.80), (-1.04, 0.80)], 0.005)
rear_decal(body, "gloss", [(-0.28, 0.62), (0.28, 0.62), (0.28, 0.74), (-0.28, 0.74)], 0.008)
rear_decal(body, "trim", strip([(-1.0, 0.86), (1.0, 0.86)], 0.01), 0.003)

# ── Panel gaps: doors, frunk, the bed cover's slats ──
GAP = 0.01
for z0 in (1.18, 0.05, -1.05):
    side_decal(body, "trim", strip([(z0, 0.82), (z0 + 0.02, along(BELT, z0) + 0.01)], GAP), 0.003)
top_decal(body, "trim", strip([(-0.84, 1.32), (-0.90, 2.62), (0.90, 2.62), (0.84, 1.32)], GAP), 0.003)
top_decal(body, "trim", strip([(-0.84, 1.32), (0.84, 1.32)], GAP), 0.003)
for k in range(6):
    zz = -1.05 - k * 0.24
    top_decal(body, "trim", strip([(-0.86, zz), (0.86, zz)], 0.006), 0.003)
top_decal(body, "trim", strip([(-0.88, -0.85), (-0.94, -2.56), (0.94, -2.56), (0.88, -0.85)], GAP), 0.003)

# ── Small square mirrors on stalks at the front of the doors ──
for s in (1, -1):
    box("trim", (s * 1.16, 1.27, 1.06), (0.14, 0.035, 0.05), bevel=0.01)
    box("paint", (s * 1.25, 1.31, 1.04), (0.12, 0.12, 0.13), bevel=0.02)
    box("glass", (s * 1.255, 1.31, 0.97), (0.09, 0.09, 0.01), bevel=0.003)

finish(sys.argv[sys.argv.index("--") + 1])
