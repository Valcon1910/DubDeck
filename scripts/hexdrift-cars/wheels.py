# Hexdrift wheels, shared by every car. Run inside Blender:
#   blender -b -P scripts/hexdrift-cars/wheels.py -- out.glb
#
# Everything is built for a wheel of radius 1 and width 0.72 (x from -0.36 to
# 0.36), outer face towards +x (the right-hand side of the car). The game
# scales each wheel to its size and mirrors the left-hand ones.
#
# Nodes (one material each):
#   tyre_road, tyre_off, tyre_slick, band_slick       spin with the wheel
#   rim_multi, rim_y5, rim_aero, rim_covered          spin; painted by rim colour
#   disc_70, disc_60      brake disc + hat + lug nuts (rim radius 0.70 / 0.60)
#   caliper_70, caliper_60                            fixed to the hub (no spin)
import math, os, sys
import bpy, bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carkit import G, link, join, reset, smooth, apply_mod, export_all

OUT = sys.argv[sys.argv.index("--") + 1]
HALF = 0.36


def P(x, y, z):
    return G(x, y, z)


def yz(rho, a):
    """Game (y, z) of a point at radius rho and angle a (0 = straight up, + = forwards)."""
    return rho * math.cos(a), rho * math.sin(a)


# ── Lathe with normals on the right of the profile ──────────────────────────
def spin(name, material, prof, steps, closed=False):
    """Spins a profile [(x, radius)] around the axle. Walking along the
    profile, the visible side is on the right: normal = (dr, -dx)."""
    bm = bmesh.new()
    n = len(prof)
    rings = []
    for s in range(steps):
        a = 2 * math.pi * s / steps
        rings.append([bm.verts.new(P(x, *yz(r, a))) for x, r in prof])
    segs = list(zip(range(n), range(1, n))) + ([(n - 1, 0)] if closed else [])
    faces = []
    for s in range(steps):
        A, B = rings[s], rings[(s + 1) % steps]
        for i, j in segs:
            vs = [A[i], A[j], B[j], B[i]]
            # Points on the axle collapse to triangles.
            uniq = []
            for v in vs:
                if all((v.co - u.co).length > 1e-7 for u in uniq): uniq.append(v)
            if len(uniq) >= 3:
                try: faces.append((bm.faces.new(uniq), i, j))
                except ValueError: pass
    bm.normal_update()
    for f, i, j in faces:
        (x0, r0), (x1, r1) = prof[i], prof[j]
        c = f.calc_center_median()
        gx, gy, gz = c.x, c.z, -c.y
        rad = Vector((0, gy, gz))
        rad = rad.normalized() if rad.length > 1e-6 else Vector((0, 1, 0))
        dn = Vector((r1 - r0, 0, 0)) + rad * -(x1 - x0)
        want = Vector((dn.x, -dn.z, dn.y))  # back to Blender axes
        if f.normal.dot(want) < 0: f.normal_flip()
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    ob = link(name, bm, material)
    smooth(ob)
    return ob


def tube(name, material, sections, close_ends=False):
    """Skins a list of cross-sections (each a list of game points, same count)."""
    bm = bmesh.new()
    rings = [[bm.verts.new(P(*p)) for p in s] for s in sections]
    m = len(sections[0])
    for A, B in zip(rings, rings[1:]):
        for i in range(m):
            bm.faces.new((A[i], A[(i + 1) % m], B[(i + 1) % m], B[i]))
    if close_ends:
        bm.faces.new(rings[0]); bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = link(name, bm, material)
    smooth(ob)
    return ob


def sharp(ob, deg=35):
    ob.data.set_sharp_from_angle(angle=math.radians(deg))


def cyl(name, material, segs, r, x0, x1, rho, a, rot=0.0):
    """A small cylinder along the axle (lug nuts, bolts), centred at (rho, a)."""
    cy, cz = yz(rho, a)
    sec = []
    for x in (x0, x1):
        sec.append([(x, cy + r * math.cos(rot + 2 * math.pi * k / segs), cz + r * math.sin(rot + 2 * math.pi * k / segs)) for k in range(segs)])
    ob = tube(name, material, sec, close_ends=True)
    sharp(ob, 30)
    return ob


# ── Tyres ───────────────────────────────────────────────────────────────────
def mirror_half(right):
    """Right half (bead to centre) → whole profile (right bead → left bead)."""
    left = [(-x, r) for x, r in reversed(right) if x > 1e-6]
    return right + left


def inboard(right):
    """Whole profile, with the (never seen) inboard sidewall kept coarse."""
    full = mirror_half(right)
    n = len(right)
    keep = [p for i, p in enumerate(full) if i < n or i >= len(full) - 2 or full[i][1] > 0.97 or i % 2 == 0]
    return keep


def tyre_road():
    rr = 0.70
    right = [(0.33, rr - 0.01), (0.346, rr + 0.025), (0.364, rr + 0.07), (0.374, 0.84), (0.37, 0.9),
             (0.355, 0.945), (0.33, 0.976), (0.29, 0.995), (0.25, 1.0),
             # Three grooves round the tread.
             (0.158, 1.0), (0.158, 0.972), (0.122, 0.972), (0.122, 1.0), (0.0, 1.0)]
    ob = spin("tyre_road", "tyre", inboard(right), 48)
    sharp(ob, 50)
    return ob


def tyre_slick():
    rr = 0.62
    right = [(0.33, rr - 0.01), (0.346, rr + 0.025), (0.366, rr + 0.07), (0.38, 0.80), (0.382, 0.86),
             (0.372, 0.92), (0.346, 0.966), (0.30, 0.992), (0.24, 1.0), (0.0, 1.0)]
    ob = spin("tyre_slick", "tyre", inboard(right), 48)
    band = spin("band_slick", "accent", [(0.381, 0.765), (0.3855, 0.80), (0.386, 0.835)], 60)
    return ob, band


def tyre_off():
    rr = 0.60
    base = 0.925
    right = [(0.33, rr - 0.01), (0.348, rr + 0.03), (0.37, rr + 0.09), (0.38, 0.80), (0.375, 0.86),
             (0.36, 0.9), (0.33, base), (0.0, base)]
    obs = [spin("tyre_off", "tyre", inboard(right), 44)]
    # Chunky blocks, two staggered rows; each wraps over the shoulder.
    n = 18
    pitch = 2 * math.pi / n
    for row in (1, -1):
        for k in range(n):
            a0 = pitch * (k + (0.5 if row < 0 else 0)) - pitch * 0.32
            a1 = a0 + pitch * 0.64
            # Cross-section (x, r), outer side first.
            cs = [(0.03, base - 0.01), (0.03, 0.992), (0.05, 1.0), (0.29, 1.0), (0.335, 0.975),
                  (0.37, 0.93), (0.385, 0.875), (0.37, 0.87), (0.34, base - 0.01)]
            if k % 2: cs = [(x + 0.03, r) for x, r in cs[:1]] + [(x + 0.03, r) for x, r in cs[1:3]] + cs[3:]
            secs = []
            for t in range(3):
                a = a0 + (a1 - a0) * t / 2
                secs.append([(row * x, *yz(r, a)) for x, r in cs])
            ob = tube("blk", "tyre", secs, close_ends=True)
            sharp(ob, 30)
            obs.append(ob)
    return join("tyre_off", obs)


# ── Rims ────────────────────────────────────────────────────────────────────
def lip(rr):
    """Outer lip, from the spoke face out over the flange (tucks under the tyre)."""
    return [(0.29, rr - 0.06), (0.325, rr - 0.05), (0.35, rr - 0.03), (0.362, rr - 0.005), (0.357, rr + 0.02), (0.338, rr + 0.03)]


def barrel(name, rr):
    prof = [(-0.34, rr + 0.012), (-0.335, rr - 0.055), (-0.29, rr - 0.06), (-0.262, rr - 0.12),
            (-0.15, rr - 0.12), (-0.122, rr - 0.06)] + lip(rr)
    ob = spin(name, "rim", prof, 44)
    sharp(ob, 40)
    return ob


def hub_cap(name):
    # Small centre cap, a recessed ring for the lug nuts, then the hub face.
    ob = spin(name, "rim", [(0.255, 0.0), (0.255, 0.04), (0.242, 0.065), (0.222, 0.072), (0.222, 0.148), (0.236, 0.16),
                            (0.228, 0.2), (0.205, 0.228), (0.15, 0.232), (0.13, 0.2)], 28)
    sharp(ob, 30)
    return ob


def spoke(rr, a, hw0, hw1, d, sweep=0.0, r0=0.19, x0=0.2, x1=0.305, segs=5, crown=0.55):
    """One concave spoke from the hub (r0, x0) out to the lip (rr - 0.05, x1)."""
    r1 = rr - 0.045
    secs = []
    for s in range(segs + 1):
        t = s / segs
        rho = r0 + (r1 - r0) * t
        x = x0 + (x1 - x0) * t ** 1.6
        hw = hw0 + (hw1 - hw0) * t
        ang = a + sweep * t
        ey = (-math.sin(ang), math.cos(ang))
        cy, cz = yz(rho, ang)
        sec = []
        for u, v in ((-hw, -d), (hw, -d), (hw, -0.3 * d), (crown * hw, 0.0), (-crown * hw, 0.0), (-hw, -0.3 * d)):
            sec.append((x + v, cy + u * ey[0], cz + u * ey[1]))
        secs.append(sec)
    ob = tube("spk", "rim", secs, close_ends=True)
    sharp(ob, 28)
    return ob


def rim_multi():
    rr = 0.70
    obs = [barrel("rim_multi", rr), hub_cap("cap")]
    # Ten spokes in five split pairs.
    for k in range(5):
        a = 2 * math.pi * k / 5
        for sgn in (-1, 1):
            obs.append(spoke(rr, a + sgn * 0.075, 0.045, 0.05, 0.075, sweep=sgn * 0.12))
    return join("rim_multi", obs)


def rim_y5():
    rr = 0.70
    obs = [barrel("rim_y5", rr), hub_cap("cap")]
    for k in range(5):
        a = 2 * math.pi * k / 5
        # Stem from the hub, then two arms out to the lip.
        stem = []
        for s in range(4):
            t = s / 3
            rho = 0.19 + 0.18 * t
            x = 0.2 + 0.03 * t ** 1.6
            hw = 0.065 - 0.012 * t
            ey = (-math.sin(a), math.cos(a)); cy, cz = yz(rho, a)
            stem.append([(x + v, cy + u * ey[0], cz + u * ey[1]) for u, v in
                         ((-hw, -0.075), (hw, -0.075), (hw, -0.02), (0.6 * hw, 0.0), (-0.6 * hw, 0.0), (-hw, -0.02))])
        ob = tube("stem", "rim", stem, close_ends=True); sharp(ob, 28); obs.append(ob)
        for sgn in (-1, 1):
            obs.append(spoke(rr, a + sgn * 0.03, 0.034, 0.046, 0.068, sweep=sgn * 0.24, r0=0.33, x0=0.222, segs=5))
    return join("rim_y5", obs)


def rim_aero():
    """The electric truck's aero cover: a flat dish folded into twelve
    facets like a turbine, round a small hub."""
    rr = 0.60
    obs = [barrel("rim_aero", rr)]
    b = bmesh.new()
    ro = rr - 0.055
    centre = b.verts.new(P(0.335, 0, 0))
    ring_in, ring_out = [], []
    for k in range(12):
        a = 2 * math.pi * k / 12
        ridge = k % 2 == 0
        ring_in.append(b.verts.new(P(0.335 if ridge else 0.322, *yz(0.12, a))))
        ring_out.append(b.verts.new(P(0.312 if ridge else 0.292, *yz(ro, a + (0.12 if ridge else 0.0)))))
    for k in range(12):
        j = (k + 1) % 12
        b.faces.new((centre, ring_in[k], ring_in[j]))
        b.faces.new((ring_in[k], ring_out[k], ring_out[j], ring_in[j]))
    bmesh.ops.recalc_face_normals(b, faces=b.faces)
    for f in b.faces:
        if f.normal.x < 0: f.normal_flip()  # Blender x is the axle: face outwards
    cover = link("cover", b, "rim")
    cover.data.set_sharp_from_angle(angle=math.radians(5))
    obs.append(cover)
    obs.append(spin("hub", "rim", [(0.36, 0.0), (0.36, 0.05), (0.348, 0.075), (0.336, 0.09)], 24))
    return join("rim_aero", obs)


def rim_covered():
    """Single-seater: a dished aero cover and a centre-lock nut."""
    rr = 0.62
    cover = [(0.3, 0.0), (0.3, 0.07), (0.285, 0.09), (0.266, 0.13), (0.262, 0.25), (0.27, 0.38), (0.284, 0.47)] + lip(rr)
    ob = spin("rim_covered", "rim", cover, 48); sharp(ob, 40)
    nut = cyl("nut", "rim", 6, 0.085, 0.29, 0.335, 0.0, 0.0)
    tip = spin("tip", "rim", [(0.37, 0.0), (0.36, 0.03), (0.335, 0.05), (0.335, 0.06)], 16)
    return join("rim_covered", [ob, nut, tip])


# ── Brakes ──────────────────────────────────────────────────────────────────
def disc(name, rr):
    ri, ro = rr * 0.47, rr * 0.84
    rotor = spin("rotor", "metal", [(0.12, ri), (0.12, ro), (0.07, ro), (0.07, ri)], 36, closed=True)
    # Cross-drilled: holes on three staggered radii.
    for k in range(12):
        rho = ri + 0.05 + ((k % 3) / 2) * (ro - ri - 0.1)
        bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.019, depth=0.2, location=P(0.095, *yz(rho, 2 * math.pi * k / 12)), rotation=(0, math.pi / 2, 0))
        cut = bpy.context.active_object
        m = rotor.modifiers.new("hole", "BOOLEAN"); m.operation = "DIFFERENCE"; m.object = cut; m.solver = "EXACT"
        apply_mod(rotor, m)
        bpy.data.objects.remove(cut)
    smooth(rotor); sharp(rotor, 40)
    hat = spin("hat", "metal", [(0.16, 0.1), (0.16, ri - 0.012), (0.148, ri), (0.12, ri)], 24); sharp(hat, 40)
    obs = [rotor, hat]
    for k in range(5):
        obs.append(cyl("lug", "metal", 6, 0.02, 0.2, 0.25, 0.11, 2 * math.pi * (k + 0.5) / 5))
    return join(name, obs)


def caliper(name, rr):
    ro = rr - 0.075
    ri = rr * 0.6
    ac, span = -0.6, 0.42  # behind and above the axle
    cs = [(0.045, ri), (0.045, ro), (0.15, ro), (0.175, ro - 0.025), (0.175, ri + 0.03), (0.16, ri)]
    secs = []
    for s in range(7):
        a = ac - span + 2 * span * s / 6
        secs.append([(x, *yz(r, a)) for x, r in cs])
    ob = tube(name, "caliper", secs, close_ends=True)
    m = ob.modifiers.new("bev", "BEVEL"); m.width = 0.01; m.segments = 2; m.limit_method = "ANGLE"
    apply_mod(ob, m)
    smooth(ob); sharp(ob, 40)
    return ob


reset()
tyre_road(); tyre_slick(); tyre_off()
rim_multi(); rim_y5(); rim_aero(); rim_covered()
disc("disc_70", 0.70); disc("disc_60", 0.60)
caliper("caliper_70", 0.70); caliper("caliper_60", 0.60)
export_all(OUT)
