# Helpers for the Hexdrift car scripts (run inside Blender). Everything takes
# game coordinates (x right, y up, z forward) and turns them into Blender's
# (x, -z, y); the glTF export turns them back.
import bpy, bmesh, math
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt

COLORS = {
    "paint": (0.05, 0.12, 0.45, 1), "accent": (0.8, 0.05, 0.1, 1), "trim": (0.02, 0.02, 0.025, 1),
    "gloss": (0.01, 0.01, 0.012, 1), "glass": (0.01, 0.02, 0.04, 1), "lamp": (1, 1, 1, 1),
    "tail": (0.5, 0.02, 0.05, 1), "chrome": (0.8, 0.82, 0.86, 1), "metal": (0.5, 0.52, 0.55, 1),
    "tyre": (0.02, 0.02, 0.022, 1), "rim": (0.3, 0.3, 0.32, 1), "caliper": (0.7, 0.05, 0.08, 1),
}
_mats = {}
_parts = []


def G(x, y, z):
    return Vector((x, -z, y))


def mat(name):
    if name not in _mats:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = COLORS[name]
        _mats[name] = m
    return _mats[name]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear(); _parts.clear()


def link(name, bm, material):
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


def smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True


# ── Body ────────────────────────────────────────────────────────────────────
def prof(yb, hw, ymid, ws, ybelt, wg, yg, ytop):
    """Half a cross-section, bottom centre to top centre (x, y)."""
    return [(0, yb), (hw * 0.8, yb), (hw, yb + 0.14), (hw, ymid), (ws, ybelt), (wg, yg), (0, ytop)]


def ring(z, half):
    pts = half + [(-x, y) for x, y in reversed(half[1:-1])]
    return [G(x, y, z) for x, y in pts]


def loft(name, stations, cap_front, cap_rear, creases=None):
    """Skins the cross-sections into a closed cage. creases: {point index
    in the half section: sharpness 0..1} for lines along the car (mirrored),
    plus "ends": sharpness of the nose and tail outlines."""
    creases = creases or {}
    bm = bmesh.new()
    rings = []

    def shrunk(z, half, k):
        cy = sum(y for _, y in half) / len(half)
        return ring(z, [(x * k, cy + (y - cy) * k) for x, y in half])

    pos = [shrunk(cap_front, stations[0][1], 0.62)] + [ring(z, h) for z, h in stations] + [shrunk(cap_rear, stations[-1][1], 0.62)]
    for r in pos:
        rings.append([bm.verts.new(v) for v in r])
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    cl = bm.edges.layers.float.new("crease_edge")
    half = len(stations[0][1])
    for idx, k in creases.items():
        if idx == "ends":
            for rr in (rings[1], rings[-2]):
                for i in range(n):
                    e = bm.edges.get((rr[i], rr[(i + 1) % n]))
                    if e: e[cl] = k
            continue
        for i in {idx, (n - idx) % n}:
            for a, b in zip(rings[1:-1], rings[2:-1]):
                e = bm.edges.get((a[i], b[i]))
                if e: e[cl] = k
    ob = link(name, bm, "paint")
    smooth(ob)
    return ob


def subdivide(ob, levels):
    m = ob.modifiers.new("sub", "SUBSURF")
    m.levels = levels; m.render_levels = levels
    apply_mod(ob, m)
    smooth(ob)


def wheel_well(body, x, z, r):
    """Cuts a round wheel well (lined in black) into the body."""
    s = 1 if x > 0 else -1
    inner = abs(x) - 0.22
    depth = 0.9
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=r, depth=depth,
                                        location=G(s * (inner + depth / 2), r - 0.065, z), rotation=(0, math.pi / 2, 0))
    cut = bpy.context.active_object
    cut.data.materials.append(mat("trim"))
    if not body.data.materials.get("trim"):
        body.data.materials.append(mat("trim"))
    m = body.modifiers.new("well", "BOOLEAN")
    m.operation = "DIFFERENCE"; m.object = cut; m.solver = "EXACT"; m.material_mode = "TRANSFER"
    apply_mod(body, m)
    bpy.data.objects.remove(cut)
    smooth(body)


def sharpen(ob, degrees=45):
    """Hard edges where faces meet at a sharp angle (the lips of the wheel
    wells), so the smooth shading doesn't smear across them."""
    ob.data.set_sharp_from_angle(angle=math.radians(degrees))


def under_trim(body):
    if not body.data.materials.get("trim"):
        body.data.materials.append(mat("trim"))
    ti = list(body.data.materials).index(mat("trim"))
    for p in body.data.polygons:
        # Only the real floor of the car (not the lips of the wheel arches).
        if p.normal.z < -0.55 and p.center.z < 0.3:
            p.material_index = ti


# ── Details projected onto the body ────────────────────────────────────────
def _area(pts):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1])) / 2


def outline_grow(pts, d):
    sgn = 1 if _area(pts) > 0 else -1
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        e1 = (p1 - p0).normalized(); e2 = (p2 - p1).normalized()
        n1 = Vector((e1.y, -e1.x)) * sgn; n2 = Vector((e2.y, -e2.x)) * sgn
        nm = (n1 + n2).normalized()
        k = d / max(0.3, nm.dot(n1))
        q = p1 + nm * k
        out.append((q.x, q.y))
    return out


def strip(line, w):
    """A polyline made into a thin outline w wide."""
    left, right = [], []
    for i, p in enumerate(line):
        a = Vector(line[max(0, i - 1)]); b = Vector(line[min(len(line) - 1, i + 1)])
        t = (b - a).normalized()
        nrm = Vector((-t.y, t.x)) * (w / 2)
        q = Vector(p)
        left.append(tuple(q + nrm)); right.append(tuple(q - nrm))
    return left + list(reversed(right))


def _resample(pts, step):
    out = []
    n = len(pts)
    for i in range(n):
        a, b = Vector(pts[i]), Vector(pts[(i + 1) % n])
        k = max(1, int(math.ceil((b - a).length / step)))
        for j in range(k):
            out.append(tuple(a.lerp(b, j / k)))
    return out


def _decal_mesh(pts, step=0.03):
    """A flat triangle mesh filling the outline (2D), dense enough to bend."""
    edge = _resample(pts, step)
    xs = [p[0] for p in edge]; ys = [p[1] for p in edge]
    inner = []
    gx = min(xs) + step / 2
    while gx < max(xs):
        gy = min(ys) + step / 2
        while gy < max(ys):
            inner.append((gx, gy))
            gy += step
        gx += step
    # keep grid points inside the outline and not hugging its edge
    def inside(p):
        c = False
        for i in range(len(edge)):
            a, b = edge[i], edge[i - 1]
            if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]:
                c = not c
        return c
    inner = [p for p in inner if inside(p) and min((p[0] - e[0]) ** 2 + (p[1] - e[1]) ** 2 for e in edge) > (step * 0.45) ** 2]
    verts = [Vector(p) for p in edge + inner]
    ne = len(edge)
    edges = [(i, (i + 1) % ne) for i in range(ne)]
    v, e, f, *_ = delaunay_2d_cdt(verts, edges, [list(range(ne))], 1, 1e-6)
    return v, f


def _ring_mesh(pts, d, step=0.03):
    """A thin band d wide just outside the outline."""
    out = outline_grow(pts, d)
    v, f = [], []
    n = len(pts)
    for i in range(n):
        a0, a1 = Vector(pts[i]), Vector(pts[(i + 1) % n])
        b0, b1 = Vector(out[i]), Vector(out[(i + 1) % n])
        k = max(1, int(math.ceil((a1 - a0).length / step)))
        for j in range(k):
            t0, t1 = j / k, (j + 1) / k
            base = len(v)
            v += [a0.lerp(a1, t0), a0.lerp(a1, t1), b0.lerp(b1, t1), b0.lerp(b1, t0)]
            f.append([base, base + 1, base + 2, base + 3])
    return v, f


def _decal(body, material, pts, offset, plane, axis, positive, ring=0.0):
    v2, faces = _ring_mesh(pts, ring) if ring else _decal_mesh(pts)
    bm = bmesh.new()
    vs = [bm.verts.new(plane(p.x, p.y)) for p in v2]
    for f in faces:
        try:
            bm.faces.new([vs[i] for i in f])
        except ValueError:
            pass
    start = [v.co.copy() for v in bm.verts]
    ob = link("decal-" + material, bm, material)
    m = ob.modifiers.new("wrap", "SHRINKWRAP")
    m.target = body; m.wrap_method = "PROJECT"; m.offset = 0
    m.use_project_x = axis == "x"; m.use_project_y = axis == "y"; m.use_project_z = axis == "z"
    m.use_negative_direction = not positive; m.use_positive_direction = positive
    apply_mod(ob, m)
    # Anything that missed the body stays on the plane: drop it.
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.verts.ensure_lookup_table()
    miss = [v for v, s in zip(bm.verts, start) if (v.co - s).length < 1e-4]
    if miss:
        bmesh.ops.delete(bm, geom=miss, context="VERTS")
    # Lift it off the surface along the surface's normal (not the ray), so
    # it sits the same height above the paint on slopes as on flat panels.
    for v in bm.verts:
        ok, loc, nrm, _ = body.closest_point_on_mesh(v.co)
        if ok:
            v.co = loc + nrm * offset
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(ob.data); bm.free()
    smooth(ob)
    return ob


def front_decal(body, material, pts, offset, ring=0.0):
    """Outline seen from the front (x, y), projected back onto the body.
    ring > 0: only a band that wide around the outline."""
    return _decal(body, material, pts, offset, lambda x, y: G(x, y, 3.5), "y", True, ring)


def rear_decal(body, material, pts, offset, ring=0.0):
    """Outline seen from behind (x, y), projected forward onto the body."""
    return _decal(body, material, pts, offset, lambda x, y: G(x, y, -3.5), "y", False, ring)


def top_decal(body, material, pts, offset, ring=0.0):
    """Outline seen from above (x, z), projected down onto the body."""
    return _decal(body, material, pts, offset, lambda x, z: G(x, 3.0, z), "z", False, ring)


def side_decal(body, material, pts, offset, ring=0.0):
    """Outline seen from the side (z, y), projected onto both sides."""
    for s in (1, -1):
        _decal(body, material, pts, offset, lambda z, y, s=s: G(s * 2.0, y, z), "x", s < 0, ring)


# ── Small solid parts ───────────────────────────────────────────────────────
def box(material, c, size, bevel=0.0, sub=0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    sx, sy, sz = size
    for v in bm.verts:
        v.co = G(c[0] + v.co.x * sx, c[1] + v.co.z * sy, c[2] - v.co.y * sz)
    ob = link("box-" + material, bm, material)
    if bevel:
        m = ob.modifiers.new("bev", "BEVEL"); m.width = bevel; m.segments = 2
        apply_mod(ob, m)
    if sub:
        subdivide(ob, sub)
    return ob


def mirror_pod(s, z, y):
    box("paint", (s * 1.03, y + 0.02, z - 0.02), (0.12, 0.11, 0.2), sub=2)
    box("trim", (s * 0.95, y - 0.02, z + 0.02), (0.12, 0.03, 0.06), bevel=0.01)
    box("glass", (s * 1.035, y + 0.02, z - 0.115), (0.09, 0.08, 0.01), bevel=0.003)


def lathe(name, material, prof, steps=48):
    """Spins a profile [(x, radius)] around the x axis (a wheel's axle)."""
    bm = bmesh.new()
    vs = [bm.verts.new(G(x, r, 0)) for x, r in prof]
    es = [bm.edges.new((a, b)) for a, b in zip(vs, vs[1:])]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(1, 0, 0), angle=2 * math.pi, steps=steps, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = link(name, bm, material)
    smooth(ob)
    return ob


def join(name, obs):
    """Joins objects into one named object (and takes them off the parts list)."""
    bpy.ops.object.select_all(action="DESELECT")
    for ob in obs:
        ob.select_set(True)
        if ob in _parts: _parts.remove(ob)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    return ob


def export_all(path):
    """Exports every object as its own node (by name)."""
    for ob in bpy.context.scene.objects:
        n = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        print("PART", ob.name, n)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=False, export_yup=True,
                              export_apply=True, export_normals=True, export_texcoords=False, export_materials="EXPORT")


# ── Export ──────────────────────────────────────────────────────────────────
def finish(path):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in _parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = _parts[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = "body"
    tris = {}
    for p in ob.data.polygons:
        nm = ob.data.materials[p.material_index].name
        tris[nm] = tris.get(nm, 0) + len(p.vertices) - 2
    print("TRIS", sum(tris.values()), tris)
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    print("BOUNDS x %.3f..%.3f  y(game z) %.3f..%.3f  z(game y) %.3f..%.3f" % (
        min(v.x for v in bb), max(v.x for v in bb), -max(v.y for v in bb), -min(v.y for v in bb), min(v.z for v in bb), max(v.z for v in bb)))
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=False, export_yup=True,
                              export_apply=True, export_normals=True, export_texcoords=False, export_materials="EXPORT")
