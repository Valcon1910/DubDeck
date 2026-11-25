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
    "white": (0.9, 0.9, 0.92, 1), "tyre": (0.02, 0.02, 0.022, 1), "rim": (0.3, 0.3, 0.32, 1), "caliper": (0.7, 0.05, 0.08, 1),
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
    # Thin shapes can fool the guess: make sure the surface faces outwards
    # (booleans cut the wrong way otherwise).
    if bm.calc_volume(signed=True) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
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


# ── Curves and painted regions ─────────────────────────────────────────────
def curve(pts, closed=True, per=6, sharp=()):
    """A smooth line through the points (centripetal Catmull-Rom). sharp:
    indices of points that stay corners."""
    P = [Vector(p) for p in pts]
    n = len(P)
    out = []
    segs = n if closed else n - 1
    for i in range(segs):
        p1, p2 = P[i], P[(i + 1) % n]
        if (not closed and i == 0) or i in sharp:
            p0 = p1 - (p2 - p1)
        else:
            p0 = P[i - 1]
        j = (i + 2) % n
        if (not closed and i + 2 >= n) or (i + 1) % n in sharp:
            p3 = p2 + (p2 - p1)
        else:
            p3 = P[j]
        def tj(ti, a, b):
            return ti + max((b - a).length, 1e-6) ** 0.5
        t0 = 0; t1 = tj(t0, p0, p1); t2 = tj(t1, p1, p2); t3 = tj(t2, p2, p3)
        for k in range(per):
            t = t1 + (t2 - t1) * k / per
            a1 = p0 * ((t1 - t) / (t1 - t0)) + p1 * ((t - t0) / (t1 - t0))
            a2 = p1 * ((t2 - t) / (t2 - t1)) + p2 * ((t - t1) / (t2 - t1))
            a3 = p2 * ((t3 - t) / (t3 - t2)) + p3 * ((t - t2) / (t3 - t2))
            b1 = a1 * ((t2 - t) / (t2 - t0)) + a2 * ((t - t0) / (t2 - t0))
            b2 = a2 * ((t3 - t) / (t3 - t1)) + a3 * ((t - t1) / (t3 - t1))
            c = b1 * ((t2 - t) / (t2 - t1)) + b2 * ((t - t1) / (t2 - t1))
            out.append((c.x, c.y))
    if not closed:
        out.append(tuple(P[-1]))
    return out


def rounded(pts, r, per=4):
    """A polygon with its corners rounded off (radius about r); the edges
    stay straight."""
    P = [Vector(p) for p in pts]
    n = len(P)
    out = []
    for i in range(n):
        a, b, c = P[i - 1], P[i], P[(i + 1) % n]
        d = min(r, (b - a).length * 0.45, (c - b).length * 0.45)
        p0 = b + (a - b).normalized() * d
        p1 = b + (c - b).normalized() * d
        for k in range(per + 1):
            t = k / per
            q = p0 * (1 - t) ** 2 + b * 2 * t * (1 - t) + p1 * t * t
            out.append((q.x, q.y))
    return out


# How each view maps a 2D outline (u, v) to game axes, and which way it looks.
_VIEWS = {
    "front": (lambda u, v, d: (u, v, d), (0, 0, 1)),
    "rear": (lambda u, v, d: (u, v, d), (0, 0, -1)),
    "top": (lambda u, v, d: (u, d, v), (0, 1, 0)),
    "side": (lambda u, v, d: (d, v, u), (1, 0, 0)),     # both sides
}


def _uv(view, co):
    """Blender coordinate -> the view's 2D coordinates."""
    x, y, z = co.x, co.z, -co.y   # game axes
    return {"front": (x, y), "rear": (x, y), "top": (x, z), "side": (z, y)}[view]


def _inside(p, poly):
    c = False
    for i in range(len(poly)):
        a, b = poly[i], poly[i - 1]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]:
            c = not c
    return c


def onto(body, pts, src, dst):
    """Lays an outline drawn in one view (src) onto the body, and returns it
    in another view's coordinates (dst): e.g. a windscreen drawn from the
    front, cut from above where the raked glass is seen square on."""
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new(); bm.from_mesh(body.data)
    tree = BVHTree.FromBMesh(bm); bm.free()
    to3, look = _VIEWS[src]
    d = G(*look)
    out = []
    for u, v in pts:
        o = G(*to3(u, v, 0.0)) + d * 8.0
        loc, *_ = tree.ray_cast(o, -d)
        if loc is not None:
            out.append(_uv(dst, loc))
    return out


def region(body, material, pts, view, ring=0.0, ring_material="gloss", min_facing=0.08):
    """Paints the part of the body inside an outline (seen from `view`) in
    another material. The outline is cut into the body's own surface, so the
    region follows every curve exactly: nothing floats, overlaps or hangs
    over an edge. ring > 0 also paints a frame that wide around it."""
    from mathutils.bvhtree import BVHTree
    to3, look = _VIEWS[view]
    dirs = [Vector(look)] if view != "side" else [Vector((1, 0, 0)), Vector((-1, 0, 0))]
    dirs_b = [G(d.x, d.y, d.z) for d in dirs]
    outlines = [(material, list(pts))]
    if ring:
        outlines.insert(0, (ring_material, outline_grow(list(pts), ring)))
    bm = bmesh.new(); bm.from_mesh(body.data)

    def facing(f):
        return max(f.normal.dot(d) for d in dirs_b)

    for _, poly in outlines:
        us = [p[0] for p in poly]; vs = [p[1] for p in poly]
        box2 = (min(us) - 0.05, max(us) + 0.05, min(vs) - 0.05, max(vs) + 0.05)
        def bb(f):
            c = [_uv(view, v.co) for v in f.verts]
            return min(a for a, _ in c), max(a for a, _ in c), min(b for _, b in c), max(b for _, b in c)
        pool = [f for f in bm.faces if facing(f) > min_facing * 0.5]
        pool = [f for f in pool if (lambda q: q[1] >= box2[0] and q[0] <= box2[1] and q[3] >= box2[2] and q[2] <= box2[3])(bb(f))]
        for i in range(len(poly)):
            a, b = Vector(poly[i]), Vector(poly[(i + 1) % len(poly)])
            if (b - a).length < 1e-5:
                continue
            lo_u, hi_u = min(a.x, b.x) - 0.004, max(a.x, b.x) + 0.004
            lo_v, hi_v = min(a.y, b.y) - 0.004, max(a.y, b.y) + 0.004
            hit = []
            for f in pool:
                if not f.is_valid:
                    continue
                q = bb(f)
                if q[1] >= lo_u and q[0] <= hi_u and q[3] >= lo_v and q[2] <= hi_v:
                    hit.append(f)
            if not hit:
                continue
            t = (b - a).normalized()
            n2 = Vector((-t.y, t.x))
            co = G(*to3(a.x, a.y, 0.0)); no = G(*to3(n2.x, n2.y, 0.0))
            geom = set(hit)
            for f in hit:
                geom.update(f.edges); geom.update(f.verts)
            res = bmesh.ops.bisect_plane(bm, geom=list(geom), plane_co=co, plane_no=no, dist=1e-6)
            newf = [g for g in res["geom"] if isinstance(g, bmesh.types.BMFace)]
            keep = set(hit)
            pool = [f for f in pool if f.is_valid and f not in keep] + newf
    bm.normal_update()
    bm.faces.ensure_lookup_table(); bm.faces.index_update()
    tree = BVHTree.FromBMesh(bm)
    for mname, poly in outlines:
        if not body.data.materials.get(mname):
            body.data.materials.append(mat(mname))
        mi = list(body.data.materials).index(mat(mname))
        for f in bm.faces:
            if facing(f) <= min_facing:
                continue
            c = f.calc_center_median()
            if not _inside(_uv(view, c), poly):
                continue
            # Only what is actually seen from that side (not a surface
            # hidden behind another part of the body).
            seen = False
            for d in dirs_b:
                if f.normal.dot(d) <= 0:
                    continue
                loc, _, idx, _ = tree.ray_cast(c + d * 6.0, -d)
                if loc is not None and (idx == f.index or (loc - c).length < 0.004):
                    seen = True
            if seen:
                f.material_index = mi
    bm.to_mesh(body.data); bm.free()
    smooth(body)


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


def mirror_pod(s, z, y, xb=0.95):
    """A door mirror: a slim stalk, a housing tapered towards the front with
    softened edges, and mirror glass on its back face."""
    hx = s * (xb + 0.17)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        gx, gy, gz = v.co.x, v.co.z, -v.co.y          # -0.5..0.5 each, game axes
        front = gz > 0
        k = 0.62 if front else 1.0                    # tapered nose
        v.co = G(hx + gx * 0.21 * k + (s * 0.02 if front else 0), y + gy * 0.11 * (0.8 if front else 1.0), z + gz * 0.1)
    ob = link("mirror", bm, "paint")
    m = ob.modifiers.new("bev", "BEVEL"); m.width = 0.028; m.segments = 3
    apply_mod(ob, m)
    smooth(ob)
    box("chrome", (hx, y, z - 0.052), (0.17, 0.08, 0.006), bevel=0.003)
    box("trim", (s * (xb + 0.04), y - 0.025, z + 0.01), (0.12, 0.022, 0.055), bevel=0.006)


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


# ── Plates, wing profiles, tubes, circles ─────────────────────────────────
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


def circle(cx, cy, r, n=20, ry=None):
    """A round (or oval) outline."""
    ry = r if ry is None else ry
    return [(cx + r * math.cos(2 * math.pi * k / n), cy + ry * math.sin(2 * math.pi * k / n)) for k in range(n)]


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
