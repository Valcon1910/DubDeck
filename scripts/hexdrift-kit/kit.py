# Helpers for the Hexdrift scenery kits (run inside Blender, headless).
#
# A kit is one .glb holding many named objects (a hotel, a palm, a bus...).
# Each object is built at the origin in game axes (x right, y up, z toward
# the road it faces), from parts that each carry a material by name. The
# game draws plain materials with vertex colours (the material's colour)
# and gives the special ones their own look:
#   glass*  windows (lit at night)       neon*  glowing tubes (pulse)
#   screen  video screens (animated)     lamp   lights (always on)
# The sizes the physics uses for each object live in web/src/hexdrift/sim/kit.ts.
import bpy, bmesh, math, sys
from mathutils import Vector

COLORS = {}
_mats = {}
_parts = []
_objects = []
_far = [False]


def far():
    """True while building the far-away versions (plainer: fewer segments, window bands, no bevels)."""
    return _far[0]


def build_both(build):
    """Builds every object twice: as it is, then its far version (named name~far)."""
    _far[0] = False; build()
    _far[0] = True; build()
    _far[0] = False


def G(x, y, z):
    return Vector((x, -z, y))


def hexc(h):
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, 1)


def palette(d):
    for k, v in d.items():
        COLORS[k] = hexc(v)


def mat(name):
    if name not in _mats:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = COLORS.get(name, hexc("#ff00ff"))
        _mats[name] = m
    return _mats[name]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear(); _parts.clear(); _objects.clear()


def link(bm, material, name="part"):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat(material))
    _parts.append(ob)
    return ob


def apply_mod(ob, mod):
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)


def bevel(ob, w, seg=1):
    if far(): return ob
    m = ob.modifiers.new("bev", "BEVEL"); m.width = w; m.segments = seg
    m.limit_method = "ANGLE"
    apply_mod(ob, m)
    return ob


def smooth(ob, angle=40):
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.set_sharp_from_angle(angle=math.radians(angle))
    return ob


# ── Shapes (all in game axes) ───────────────────────────────────────────────
def box(material, c, size, bv=0.0, yaw=0.0):
    """A box centred at c (x, y, z) of size (w, h, d), turned yaw radians about y."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    cs, sn = math.cos(yaw), math.sin(yaw)
    for v in bm.verts:
        x, y, z = v.co.x * size[0], v.co.z * size[1], -v.co.y * size[2]
        x, z = x * cs + z * sn, -x * sn + z * cs
        v.co = G(c[0] + x, c[1] + y, c[2] + z)
    ob = link(bm, material)
    if bv: bevel(ob, bv)
    return ob


def prism(material, pts, y0, y1, bv=0.0):
    """An upright prism: a footprint [(x, z)] (any order) from y0 to y1."""
    bm = bmesh.new()
    lo = [bm.verts.new(G(x, y0, z)) for x, z in pts]
    hi = [bm.verts.new(G(x, y1, z)) for x, z in pts]
    bm.faces.new(lo); bm.faces.new(list(reversed(hi)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bm.calc_volume(signed=True) < 0: bmesh.ops.reverse_faces(bm, faces=bm.faces)
    ob = link(bm, material)
    if bv: bevel(ob, bv)
    return ob


def cyl(material, c, r, h, n=12, r1=None, axis="y", cap=True):
    """A cylinder (or cone, with r1 at the top) centred at c along an axis."""
    r1 = r if r1 is None else r1
    if far(): n = max(4, n // 2)
    bm = bmesh.new()
    def P(a, t, rr):
        u, v = math.cos(a) * rr, math.sin(a) * rr
        if axis == "y": return G(c[0] + u, c[1] + t, c[2] + v)
        if axis == "x": return G(c[0] + t, c[1] + u, c[2] + v)
        return G(c[0] + u, c[1] + v, c[2] + t)
    lo = [bm.verts.new(P(2 * math.pi * k / n, -h / 2, r)) for k in range(n)]
    hi = [bm.verts.new(P(2 * math.pi * k / n, h / 2, r1)) for k in range(n)]
    for k in range(n):
        j = (k + 1) % n
        bm.faces.new((lo[k], lo[j], hi[j], hi[k]))
    if cap:
        bm.faces.new(lo)
        if r1 > 1e-4: bm.faces.new(list(reversed(hi)))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = link(bm, material)
    return smooth(ob, 50)


def ball(material, c, r, sub=1, sy=1.0):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    for v in bm.verts:
        x, y, z = v.co.x, v.co.z * sy, -v.co.y
        v.co = G(c[0] + x, c[1] + y, c[2] + z)
    return smooth(link(bm, material), 70)


def quad(material, a, b, c, d):
    """A flat panel through four game points (seen from the side where they run anticlockwise)."""
    bm = bmesh.new()
    vs = [bm.verts.new(G(*p)) for p in (a, b, c, d)]
    bm.faces.new(vs)
    return link(bm, material)


def tube(material, pts, r, n=6):
    if far(): n = 4
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        a = Vector(pts[max(0, i - 1)]); c = Vector(pts[min(len(pts) - 1, i + 1)])
        t = (c - a).normalized()
        u = t.cross(Vector((0, 1, 0)))
        if u.length < 1e-3: u = t.cross(Vector((1, 0, 0)))
        u.normalize(); v = t.cross(u)
        rings.append([bm.verts.new(G(*(Vector(p) + (u * math.cos(2 * math.pi * k / n) + v * math.sin(2 * math.pi * k / n)) * r))) for k in range(n)])
    for A, B in zip(rings, rings[1:]):
        for k in range(n):
            bm.faces.new((A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]))
    bm.faces.new(rings[0]); bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return smooth(link(bm, material), 60)


def rounded(w, d, r, per=5, cx=0.0, cz=0.0):
    """A rounded rectangle footprint (w across x, d along z)."""
    pts = []
    if far(): per = max(1, per // 3)
    for (sx, sz, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oz = cx + sx * (w / 2 - r), cz + sz * (d / 2 - r)
        for k in range(per + 1):
            a = math.radians(a0 + 90 * k / per)
            pts.append((ox + math.cos(a) * r, oz + math.sin(a) * r))
    return pts


def grow(pts, d):
    """Offsets a convex footprint outwards by d."""
    n = len(pts)
    cx = sum(p[0] for p in pts) / n; cz = sum(p[1] for p in pts) / n
    out = []
    for i in range(n):
        p0, p1, p2 = Vector((*pts[i - 1], 0)), Vector((*pts[i], 0)), Vector((*pts[(i + 1) % n], 0))
        e1 = (p1 - p0).normalized(); e2 = (p2 - p1).normalized()
        n1 = Vector((e1.y, -e1.x, 0)); n2 = Vector((e2.y, -e2.x, 0))
        if n1.dot(p1 - Vector((cx, cz, 0))) < 0: n1, n2 = -n1, -n2
        m = (n1 + n2)
        m = m.normalized() * (d / max(0.3, m.normalized().dot(n1))) if m.length > 1e-6 else n1 * d
        out.append((p1.x + m.x, p1.y + m.y))
    return out


# ── Facades ─────────────────────────────────────────────────────────────────
def wall_frame(o, u, n):
    """A wall's frame: origin o (bottom left, outside), right u, out n (unit, horizontal)."""
    o, u, n = Vector(o), Vector(u).normalized(), Vector(n).normalized()
    up = Vector((0, 1, 0))
    return lambda a, b, c=0.0: o + u * a + up * b + n * c


def windows(P, width, y0, y1, floor=3.2, win=1.5, gap=0.9, sill=0.9, wh=1.6, depth=0.12,
            glass="glass", frame=None, ledge=None, ledge_d=0.35, margin=1.0):
    """Rows of windows on a wall (P from wall_frame), floors from y0 up to y1.
    Each: a glass pane set a little in, a frame round it, and a ledge under each floor."""
    fl = int((y1 - y0) / floor)
    cols = max(1, int((width - 2 * margin + gap) / (win + gap)))
    span = cols * win + (cols - 1) * gap
    x0 = (width - span) / 2
    if far():
        # One band of glass per floor, and the ledges.
        for f in range(fl):
            yb = y0 + f * floor
            quad(glass, P(x0, yb + sill, 0.06), P(x0 + span, yb + sill, 0.06), P(x0 + span, yb + sill + wh, 0.06), P(x0, yb + sill + wh, 0.06))
            if ledge and f > 0:
                slab(ledge, P, -0.1, width + 0.1, yb - 0.12, yb + 0.05, 0.0, ledge_d)
        return
    for f in range(fl):
        yb = y0 + f * floor
        for k in range(cols):
            xa = x0 + k * (win + gap)
            a, b = P(xa, yb + sill, 0.06), P(xa + win, yb + sill, 0.06)
            c, d = P(xa + win, yb + sill + wh, 0.06), P(xa, yb + sill + wh, 0.06)
            quad(glass, a, b, c, d)
            if frame:
                for (p0, p1, sz) in (((xa - 0.06, yb + sill - 0.08), (xa + win + 0.06, yb + sill), 0),
                                     ((xa - 0.06, yb + sill + wh), (xa + win + 0.06, yb + sill + wh + 0.08), 0)):
                    slab(frame, P, p0[0], p1[0], p0[1], p1[1], 0.0, depth)
                slab(frame, P, xa - 0.08, xa, yb + sill, yb + sill + wh, 0.0, depth)
                slab(frame, P, xa + win, xa + win + 0.08, yb + sill, yb + sill + wh, 0.0, depth)
        if ledge and f > 0:
            slab(ledge, P, -0.1, width + 0.1, yb - 0.12, yb + 0.05, 0.0, ledge_d)


def slab(material, P, xa, xb, ya, yb, za, zb):
    """A box on a wall: from (xa, ya) to (xb, yb) across it, za to zb out from it."""
    c = [P(xa, ya, za), P(xb, ya, za), P(xb, yb, za), P(xa, yb, za),
         P(xa, ya, zb), P(xb, ya, zb), P(xb, yb, zb), P(xa, yb, zb)]
    bm = bmesh.new()
    v = [bm.verts.new(G(p.x, p.y, p.z)) for p in c]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bm.calc_volume(signed=True) < 0: bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return link(bm, material)


def box_walls(w, d, x0=0.0, z0=0.0):
    """The four outside walls of a w×d box centred at (x0, z0): front (+z) first."""
    return [
        (wall_frame((x0 - w / 2, 0, z0 + d / 2), (1, 0, 0), (0, 0, 1)), w),
        (wall_frame((x0 + w / 2, 0, z0 + d / 2), (0, 0, -1), (1, 0, 0)), d),
        (wall_frame((x0 + w / 2, 0, z0 - d / 2), (-1, 0, 0), (0, 0, -1)), w),
        (wall_frame((x0 - w / 2, 0, z0 - d / 2), (0, 0, 1), (-1, 0, 0)), d),
    ]


def awning(material, P, xa, xb, y, out, drop=0.5, stripes=None):
    """A sloped awning over a shop front (optionally striped in two materials)."""
    n = 1 if not stripes else max(1, int((xb - xa) / 0.6))
    for k in range(n):
        a = xa + (xb - xa) * k / n; b = xa + (xb - xa) * (k + 1) / n
        m = material if not stripes or k % 2 == 0 else stripes
        quad(m, P(a, y, 0.02), P(b, y, 0.02), P(b, y - drop, out), P(a, y - drop, out))
        quad(m, P(a, y, 0.02), P(a, y - drop, out), P(b, y - drop, out), P(b, y, 0.02))
    quad(material, P(xa, y - drop, out), P(xb, y - drop, out), P(xb, y - drop - 0.25, out), P(xa, y - drop - 0.25, out))


def sign(material, P, xa, xb, ya, yb, out=0.1, back="trim"):
    slab(back, P, xa - 0.1, xb + 0.1, ya - 0.1, yb + 0.1, 0.0, out)
    quad(material, P(xa, ya, out + 0.01), P(xb, ya, out + 0.01), P(xb, yb, out + 0.01), P(xa, yb, out + 0.01))


# ── Plants ──────────────────────────────────────────────────────────────────
def palm(h, lean=0.25, fronds=9, trunk="trunk", leaf="leaf", leaf2="leaf2", seed=1):
    """A coconut palm: a ringed, curving trunk and drooping fronds."""
    pts = []
    for i in range(9):
        t = i / 8
        pts.append((lean * h * t * t, h * t, 0.0))
    if far():
        tube(trunk, [pts[0], pts[3], pts[6], pts[8]], 0.3, 4)
        for k in range(0, fronds, 2):
            a = 2 * math.pi * k / fronds + seed * 0.7
            frond(Vector(pts[-1]), a, h * 0.45, 0.5, leaf if k % 4 else leaf2, 3)
        return
    rings = []
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        r = 0.34 - 0.13 * (i / 8)
        tube(trunk, [tuple(a), tuple(a + (b - a) * 0.88)], r, 7)
        tube(trunk if i % 2 else "trunk2", [tuple(a + (b - a) * 0.86), tuple(b + (b - a) * 0.04)], r * 1.12, 7)
    top = Vector(pts[-1])
    ball("husk", tuple(top + Vector((0, -0.2, 0))), 0.55, 1, 0.8)
    for k in range(3):
        a = 2 * math.pi * k / 3 + seed
        ball("coconut", tuple(top + Vector((math.cos(a) * 0.38, -0.55, math.sin(a) * 0.38))), 0.2, 1)
    for k in range(fronds):
        a = 2 * math.pi * k / fronds + seed * 0.7
        L = h * 0.42 * (0.85 + 0.3 * ((k * 7919 + seed) % 5) / 5)
        rise = 0.9 if k % 3 == 0 else 0.35
        frond(top, a, L, rise, leaf if k % 2 else leaf2)


def frond(base, ang, L, rise, material, n=8):
    """One palm frond: a spine arcing out and down, with a leafy blade either side."""
    bm = bmesh.new()
    dx, dz = math.cos(ang), math.sin(ang)
    sx, sz = -dz, dx
    prev = None
    for i in range(n + 1):
        t = i / n
        o = t * L
        y = base.y + rise * L * 0.6 * t - L * 0.9 * t * t
        w = 0.9 * math.sin(math.pi * min(1, t * 1.15)) * (1 - 0.3 * t)
        sag = 0.25 * w
        c = Vector((base.x + dx * o, y, base.z + dz * o))
        ring = [bm.verts.new(G(*(c + Vector((sx * w, -sag, sz * w))))), bm.verts.new(G(*(c + Vector((0, 0.06, 0))))),
                bm.verts.new(G(*(c + Vector((-sx * w, -sag, -sz * w)))))]
        if prev:
            bm.faces.new((prev[0], prev[1], ring[1], ring[0]))
            bm.faces.new((prev[1], prev[2], ring[2], ring[1]))
        prev = ring
    ob = link(bm, material)
    s = ob.modifiers.new("sol", "SOLIDIFY"); s.thickness = 0.04 if not far() else 0.1
    apply_mod(ob, s)
    return smooth(ob, 80)


def bush(c, r, material="bush", n=4, seed=0):
    for k in range(n):
        a = 2 * math.pi * k / n + seed
        ball(material, (c[0] + math.cos(a) * r * 0.45, c[1] + r * 0.55, c[2] + math.sin(a) * r * 0.45), r * (0.55 + 0.1 * (k % 2)), 1, 0.8)


# ── Vehicles ────────────────────────────────────────────────────────────────
def wheel(x, y, z, r=0.34, w=0.24):
    cyl("tyre", (x, y, z), r, w, 12, axis="x")
    cyl("rim", (x + (w / 2 + 0.005) * (1 if x > 0 else -1), y, z), r * 0.6, 0.02, 10, axis="x")


def car_shell(body, L, W, H, cab0, cab1, roof, glass="glass_car", nose=0.18, ride=0.32):
    """A road car: a lower body with rounded ends, a cabin with sloped glass, lights and wheels."""
    hl, hw = L / 2, W / 2
    side = [(-hl, ride), (-hl, ride + 0.55), (-hl + nose, ride + 0.72), (hl - nose * 1.4, ride + 0.74), (hl, ride + 0.5), (hl, ride)]
    bm = bmesh.new()
    a = [bm.verts.new(G(-hw, y, z)) for z, y in side]
    b = [bm.verts.new(G(hw, y, z)) for z, y in side]
    bm.faces.new(a); bm.faces.new(list(reversed(b)))
    for i in range(len(side)):
        j = (i + 1) % len(side)
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bm.calc_volume(signed=True) < 0: bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bevel(link(bm, body), 0.07, 2)
    # Cabin: glass all round, roof on top.
    y0, y1 = ride + 0.72, ride + 0.72 + H
    cab = [(-hw + 0.08, cab0), (hw - 0.08, cab0), (hw - 0.08, cab1), (-hw + 0.08, cab1)]
    bm = bmesh.new()
    lo = [bm.verts.new(G(x, y0, z)) for x, z in cab]
    hi = [bm.verts.new(G(x * 0.9, y1, z + (0.35 if z == cab0 else -0.5))) for x, z in cab]
    bm.faces.new(lo); bm.faces.new(list(reversed(hi)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bm.calc_volume(signed=True) < 0: bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bevel(link(bm, glass), 0.04, 1)
    box(roof, (0, y1 + 0.03, (cab0 + 0.35 + cab1 - 0.5) / 2), (W * 0.9 - 0.1, 0.07, (cab1 - 0.5) - (cab0 + 0.35) + 0.05), 0.03)
    # Pillars between the windows.
    for s in (-1, 1):
        box(body, (s * (hw - 0.12), (y0 + y1) / 2, (cab0 + cab1) / 2 - 0.05), (0.06, H * 0.95, 0.12), 0.0)
    # Lights.
    for s in (-1, 1):
        box("lamp", (s * (hw - 0.3), ride + 0.58, hl - 0.02), (0.42, 0.13, 0.05), 0.02)
        box("tail", (s * (hw - 0.28), ride + 0.6, -hl + 0.02), (0.36, 0.12, 0.05), 0.02)
    box("trim", (0, ride + 0.18, hl), (W - 0.2, 0.22, 0.12), 0.04)
    box("trim", (0, ride + 0.18, -hl), (W - 0.2, 0.22, 0.12), 0.04)
    for z in (hl - 0.75, -hl + 0.8):
        for s in (-1, 1):
            wheel(s * (hw - 0.12), 0.34, z)


# ── Objects and export ──────────────────────────────────────────────────────
def obj(name):
    """Joins the parts made since the last call into one object called name."""
    bpy.ops.object.select_all(action="DESELECT")
    for ob in _parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = _parts[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name + ("~far" if far() else "")
    _parts.clear()
    _objects.append(ob)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    bb = [Vector(c) for c in ob.bound_box]
    print("OBJ %-18s %6d tris  x %.1f..%.1f  y %.1f..%.1f  z %.1f..%.1f" % (
        ob.name, tris, min(v.x for v in bb), max(v.x for v in bb), min(v.z for v in bb), max(v.z for v in bb),
        -max(v.y for v in bb), -min(v.y for v in bb)))
    return ob


def export(path=None):
    path = path or sys.argv[sys.argv.index("--") + 1]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=False, export_yup=True,
                              export_apply=True, export_normals=True, export_texcoords=False, export_materials="EXPORT")


def last():
    """The part made most recently."""
    return _parts[-1]
