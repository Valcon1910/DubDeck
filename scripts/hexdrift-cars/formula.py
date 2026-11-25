# Formula X body for Hexdrift (an open-wheel single-seater), built in
# Blender (headless):
#   blender -b -P scripts/hexdrift-cars/formula.py -- out.glb
# Same conventions as coupe.py: game axes (x right, y up, z forward).
# The stock rear wing is its own node ("wing"): the game shows it only when
# the garage's wing choice is "stock".
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from carkit import *
from carkit import _parts as carkit_parts

reset()

# ── Chassis: gearbox, engine cover with the airbox, cockpit, nose ──
# prof(yb, hw, ymid, ws, ybelt, wg, yg, ytop)
C = [
    (2.78, prof(0.22, 0.07, 0.25, 0.065, 0.30, 0.05, 0.31, 0.31)),
    (2.45, prof(0.21, 0.13, 0.26, 0.125, 0.36, 0.10, 0.385, 0.39)),
    (1.65, prof(0.20, 0.25, 0.30, 0.24, 0.48, 0.19, 0.54, 0.56)),
    (0.80, prof(0.18, 0.36, 0.30, 0.36, 0.57, 0.30, 0.66, 0.70)),
    (0.10, prof(0.18, 0.38, 0.30, 0.38, 0.60, 0.30, 0.68, 0.70)),
    (-0.15, prof(0.18, 0.36, 0.32, 0.35, 0.62, 0.22, 1.00, 1.06)),
    (-0.45, prof(0.18, 0.34, 0.32, 0.33, 0.62, 0.22, 0.95, 1.02)),
    (-1.10, prof(0.22, 0.30, 0.34, 0.29, 0.60, 0.22, 0.78, 0.84)),
    (-1.70, prof(0.28, 0.22, 0.36, 0.21, 0.56, 0.17, 0.64, 0.66)),
    (-2.25, prof(0.30, 0.13, 0.36, 0.12, 0.48, 0.10, 0.52, 0.53)),
]
chassis = loft("Chassis", C, cap_front=2.86, cap_rear=-2.30, creases={4: 0.6, 2: 0.5, "ends": 0.4})
subdivide(chassis, 3)

# The cockpit opening.
bpy.ops.mesh.primitive_cube_add(size=1, location=G(0, 0.95, 0.44))
cut = bpy.context.active_object
cut.scale = (0.42, 0.84, 0.7)
bpy.ops.object.transform_apply(scale=True)
cb = cut.modifiers.new("bev", "BEVEL"); cb.width = 0.1; cb.segments = 4
apply_mod(cut, cb)
cut.data.materials.append(mat("trim"))
chassis.data.materials.append(mat("trim"))
m = chassis.modifiers.new("cockpit", "BOOLEAN")
# (The exact solver leaves this cutter whole; the fast one is fine here.)
m.operation = "DIFFERENCE"; m.object = cut; m.solver = "FAST"; m.material_mode = "TRANSFER"
apply_mod(chassis, m)
bpy.data.objects.remove(cut)
smooth(chassis)
under_trim(chassis)
sharpen(chassis, 50)

# ── Sidepods: wide intakes, tucked in hard towards the back ──
P = [
    (0.30, prof(0.18, 0.80, 0.32, 0.79, 0.50, 0.60, 0.555, 0.56)),
    (0.05, prof(0.18, 0.82, 0.32, 0.80, 0.53, 0.62, 0.585, 0.59)),
    (-0.60, prof(0.18, 0.74, 0.32, 0.72, 0.51, 0.56, 0.585, 0.59)),
    (-1.20, prof(0.20, 0.46, 0.32, 0.44, 0.47, 0.34, 0.53, 0.54)),
    (-1.65, prof(0.24, 0.24, 0.34, 0.23, 0.43, 0.17, 0.47, 0.48)),
]
pods = loft("Pods", P, cap_front=0.40, cap_rear=-1.80, creases={4: 0.7, 3: 0.6, "ends": 0.9})
subdivide(pods, 3)
under_trim(pods)
sharpen(pods, 50)
# The intakes: the blunt fronts of the pods, in black (beside the chassis).
pods.data.materials.append(mat("gloss"))
gi = list(pods.data.materials).index(mat("gloss"))
for p in pods.data.polygons:
    if p.normal.y < -0.55 and abs(p.center.x) > 0.36:
        p.material_index = gi
side_decal(pods, "accent", strip([(0.25, 0.30), (-1.0, 0.30), (-1.6, 0.36)], 0.06), 0.006)

# ── Details on the chassis ──
# Airbox above the driver's head, a black nose tip, a livery line.
front_decal(chassis, "gloss", [(-0.11, 0.88), (0.11, 0.88), (0.11, 1.02), (0, 1.045), (-0.11, 1.02)], 0.006)
front_decal(chassis, "accent", [(-0.08, 0.20), (0.08, 0.20), (0.08, 0.34), (-0.08, 0.34)], 0.006)
side_decal(chassis, "accent", strip([(2.70, 0.27), (1.6, 0.30), (0.85, 0.36)], 0.035), 0.006)
top_decal(chassis, "accent", strip([(0, 2.70), (0, 1.0)], 0.06), 0.005)
# Shark fin on the engine cover.
def plate(material, pts, t, x=0.0):
    """A flat plate: outline (z, y) extruded t thick across x."""
    b = bmesh.new()
    a = [b.verts.new(G(x - t / 2, y, z)) for z, y in pts]
    c = [b.verts.new(G(x + t / 2, y, z)) for z, y in pts]
    b.faces.new(a); b.faces.new(list(reversed(c)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        b.faces.new((a[i], a[j], c[j], c[i]))
    bmesh.ops.recalc_face_normals(b, faces=b.faces)
    ob = link("plate", b, material)
    bv = ob.modifiers.new("bev", "BEVEL"); bv.width = min(0.008, t / 3); bv.segments = 1
    apply_mod(ob, bv)
    return ob

plate("paint", [(-0.30, 0.95), (-0.30, 1.06), (-1.95, 0.80), (-1.95, 0.60)], 0.02)


def airfoil(material, x0, x1, z_le, y, chord, aoa, thick=0.12):
    """A wing element across x0..x1: leading edge at z_le, height y,
    pitched aoa radians (nose down for positive), thickness ratio thick."""
    prof = []
    for i in range(9):
        t = i / 8
        h = 5 * thick * (0.2969 * math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4)
        prof.append((t, h))
    loop = [(t, h) for t, h in prof] + [(t, -h * 0.4) for t, h in reversed(prof[1:-1])]
    b = bmesh.new()
    rings = []
    for x in (x0, x1):
        r = []
        for t, h in loop:
            dz, dy = -t * chord, h * chord
            zz = z_le + dz * math.cos(aoa) - dy * math.sin(aoa)
            yy = y + dz * math.sin(aoa) + dy * math.cos(aoa)
            r.append(b.verts.new(G(x, yy, zz)))
        rings.append(r)
    n = len(loop)
    A, B = rings
    for i in range(n):
        j = (i + 1) % n
        b.faces.new((A[i], A[j], B[j], B[i]))
    b.faces.new(A); b.faces.new(list(reversed(B)))
    bmesh.ops.recalc_face_normals(b, faces=b.faces)
    ob = link("foil", b, material)
    smooth(ob)
    sharpen(ob, 40)
    return ob


def tube(material, pts, r, segs=6):
    """A round rod along a polyline (game points)."""
    b = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        a = Vector(pts[max(0, i - 1)]); c = Vector(pts[min(len(pts) - 1, i + 1)])
        t = (c - a).normalized()
        u = t.cross(Vector((0, 1, 0)))
        if u.length < 1e-3: u = t.cross(Vector((1, 0, 0)))
        u.normalize(); v = t.cross(u)
        rings.append([b.verts.new(G(*(Vector(p) + (u * math.cos(2 * math.pi * k / segs) + v * math.sin(2 * math.pi * k / segs)) * r))) for k in range(segs)])
    for A, B in zip(rings, rings[1:]):
        for k in range(segs):
            b.faces.new((A[k], A[(k + 1) % segs], B[(k + 1) % segs], B[k]))
    b.faces.new(rings[0]); b.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(b, faces=b.faces)
    ob = link("tube", b, material)
    smooth(ob)
    return ob


# ── Front wing: a main plane, two flaps, end plates, pylons to the nose ──
airfoil("accent", -1.15, 1.15, 2.98, 0.15, 0.40, 0.04)
for s in (1, -1):
    airfoil("paint", s * 0.22, s * 1.15, 2.66, 0.215, 0.22, 0.30)
    airfoil("paint", s * 0.32, s * 1.15, 2.50, 0.29, 0.17, 0.55)
    plate("accent", [(2.98, 0.11), (2.30, 0.13), (2.32, 0.40), (2.86, 0.36)], 0.025, s * 1.16)
    box("accent", (s * 0.06, 0.22, 2.68), (0.025, 0.12, 0.22), bevel=0.006)

# ── Cockpit: driver, steering wheel, the halo, little mirrors ──
bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.16, location=G(0, 0.80, 0.24))
hob = bpy.context.active_object
hob.scale = (1.0, 1.1, 0.95)
bpy.ops.object.transform_apply(scale=True)
hob.data.materials.append(mat("white"))
smooth(hob)
carkit_parts.append(hob)
front_decal(hob, "gloss", [(-0.13, 0.78), (0.13, 0.78), (0.11, 0.86), (-0.11, 0.86)], 0.004)
box("trim", (0, 0.76, 0.52), (0.22, 0.06, 0.05), bevel=0.01)
halo = []
for i in range(13):
    a = math.pi * (i / 12 - 0.5)
    halo.append((0.34 * math.sin(a), 0.93 - 0.03 * abs(math.sin(a)), 0.30 + 0.42 * math.cos(a)))
for s in (1, -1):
    side = [p for p in halo if s * p[0] >= -1e-6]
    side.sort(key=lambda p: -p[2])
    tube("trim", side + [(s * 0.36, 0.80, 0.02), (s * 0.38, 0.66, -0.02)], 0.028, 8)
tube("trim", [(0, 0.66, 0.86), (0, 0.86, 0.80), (0, 0.92, 0.72)], 0.03, 8)
for s in (1, -1):
    tube("trim", [(s * 0.36, 0.60, 0.30), (s * 0.48, 0.70, 0.36)], 0.012, 5)
    box("paint", (s * 0.52, 0.72, 0.36), (0.10, 0.06, 0.04), bevel=0.012)
    box("glass", (s * 0.52, 0.72, 0.335), (0.08, 0.045, 0.01))

# ── Suspension: wishbones and push rods out to each wheel ──
for wx, wz, wr in [(1.02, 1.95, 0.40), (0.98, -1.50, 0.44)]:
    front = wz > 0
    inner = 0.20 if front else 0.30
    for s in (1, -1):
        hub = (s * (wx - 0.2), wr, wz)
        tube("trim", [(s * inner, 0.46, wz + 0.16), (hub[0], wr + 0.08, wz)], 0.02)
        tube("trim", [(s * inner, 0.46, wz - 0.16), (hub[0], wr + 0.08, wz)], 0.02)
        tube("trim", [(s * inner, 0.28, wz + 0.16), (hub[0], wr - 0.12, wz)], 0.02)
        tube("trim", [(s * inner, 0.28, wz - 0.16), (hub[0], wr - 0.12, wz)], 0.02)
        tube("accent", [(s * (inner + 0.04), 0.56, wz - 0.05), (hub[0] - s * 0.04, wr - 0.1, wz)], 0.016)

# ── Floor, beam wing, rain light ──
box("trim", (0, 0.165, -0.30), (1.62, 0.03, 2.5), bevel=0.01)
airfoil("accent", -0.50, 0.50, -2.22, 0.47, 0.26, 0.25)
box("tail", (0, 0.56, -2.31), (0.14, 0.08, 0.03), bevel=0.01)

# ── The stock rear wing (separate, swappable) ──
wing = [airfoil("accent", -0.77, 0.77, -2.16, 0.99, 0.40, 0.12),
        airfoil("paint", -0.77, 0.77, -2.40, 1.11, 0.26, 0.42)]
for s in (1, -1):
    wing.append(plate("paint", [(-2.66, 0.62), (-2.06, 0.66), (-2.02, 1.10), (-2.14, 1.22), (-2.64, 1.24)], 0.03, s * 0.79))
wing.append(plate("accent", [(-2.30, 0.50), (-2.12, 0.50), (-2.20, 0.98), (-2.36, 0.98)], 0.05))
join("wing", wing)

finish(sys.argv[sys.argv.index("--") + 1])
