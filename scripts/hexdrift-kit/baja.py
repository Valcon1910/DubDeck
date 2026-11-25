# The Baja kit: a desert town (adobe houses, a cantina, a tienda, a gas
# station, a whitewashed mission, a water tower, a windpump), the desert
# (saguaro and cardón cacti, agave, creosote bushes, fan palms, red sandstone
# rocks), the rally (tyre stacks, hay bales, a service tent with a parked
# trophy truck, a scaffold grandstand, a start arch, chevron boards, power
# poles), and pickups, a beetle taxi and an old bus for traffic.
#   blender -b -P scripts/hexdrift-kit/baja.py -- out.glb
import math, os, sys, random
sys.path.insert(0, os.path.dirname(__file__))
from kit import *

reset()
palette({
    # Adobe, plaster, wood, tiles and painted walls.
    "adobe": "#d9a77a", "adobe2": "#c98f63", "white": "#f4efe4", "terra": "#c4673f", "ochre": "#e0a548", "teal": "#3f9e9a",
    "pinkw": "#e88a9a", "bluew": "#4a7fc0", "wood": "#6e4a2c", "wood2": "#9b6b43", "viga": "#5a3a22", "tile": "#b5532f",
    "thatch": "#c9a35c", "trim": "#2b2d36", "trimw": "#ffffff", "steel": "#8d939e", "dark": "#22242c", "rust": "#8a4a2a",
    "concrete": "#bdb6a8", "canvas_r": "#d23a3a", "canvas_y": "#f2c230", "canvas_b": "#2f6fd6", "canvas_w": "#f5f1e8",
    "green": "#3a8a4a", "flower": "#ff5d9e", "pot": "#b85a32",
    # Desert plants and rock.
    "cactus": "#4f7d45", "cactus2": "#5f8f50", "agave": "#7fa08a", "bush": "#6b7a3e", "bush2": "#8a8a4a",
    "trunk": "#7a6248", "leaf": "#4f8f46", "leaf2": "#679f52", "sandst": "#b8613f", "sandst2": "#cf7a4e", "sandst3": "#a3532f",
    # Rally: tyres, bales, sponsors.
    "tyre": "#151517", "rim": "#b9bec6", "hay": "#e0c070", "orange": "#ff7a1a", "sponsor": "#1a1d26",
    # Cars.
    "car_w": "#eef0f2", "car_k": "#1d2027", "car_r": "#b8242f", "car_b": "#2d5fbf", "car_t": "#3f9e9a", "car_s": "#9aa1ab",
    "bus_y": "#f0b41c", "police": "#f2f4f8", "tail": "#9a1020", "truck": "#ff5a1f",
    # Special looks (the game knows these names).
    "glass": "#5b7d99", "glass_d": "#33485e", "glass_car": "#1c2633", "lamp": "#fff4d6",
    "blink": "#ffb43a", "arrow": "#ffa928", "arrowl": "#ffa928", "neon_p": "#ff3da6", "neon_c": "#2ee6ff", "neon_y": "#ffd23d",
    "screen": "#202838",
})


# ── Town ─────────────────────────────────────────────────────────────────────
def vigas(w, d, H, n):
    """Roof beams poking out of the front wall."""
    if far():
        return
    for k in range(n):
        x = -w / 2 + 0.8 + k * (w - 1.6) / (n - 1)
        cyl("viga", (x, H - 0.45, d / 2 + 0.35), 0.13, 0.9, 6, axis="z")


def parapet(w, d, H, wall):
    """A flat roof behind a rounded parapet, with a drain spout."""
    box(wall, (0, H + 0.3, d / 2 - 0.15), (w, 0.6, 0.3), 0.08)
    box(wall, (0, H + 0.3, -d / 2 + 0.15), (w, 0.6, 0.3), 0.08)
    box(wall, (w / 2 - 0.15, H + 0.3, 0), (0.3, 0.6, d), 0.08)
    box(wall, (-w / 2 + 0.15, H + 0.3, 0), (0.3, 0.6, d), 0.08)
    box("adobe2", (0, H + 0.05, 0), (w - 0.5, 0.1, d - 0.5))
    if not far():
        box("wood2", (w / 3, H - 0.2, d / 2 + 0.4), (0.18, 0.18, 0.8))


def door(P, x, w, h, color):
    slab(color, P, x - w / 2, x + w / 2, 0.0, h, 0.0, 0.08)
    slab("trimw", P, x - w / 2 - 0.12, x + w / 2 + 0.12, h, h + 0.15, 0.0, 0.1)


def pots(P, x0, n):
    if far():
        return
    for k in range(n):
        p = P(x0 + k * 0.7, 0.25, 0.4)
        cyl("pot", (p.x, p.y, p.z), 0.22, 0.5, 8, r1=0.28)
        ball("green" if k % 2 else "flower", (p.x, p.y + 0.4, p.z), 0.28, 1)


def adobe(name, w, d, H, wall, trim, second=False):
    """An adobe house: thick soft-cornered walls, a parapet roof, vigas,
    deep-set windows with painted frames, a door, pots by the door.
    second: a smaller upper floor at the back, with a stair and a terrace."""
    box(wall, (0, H / 2, 0), (w, H, d), 0.22)
    parapet(w, d, H, wall)
    vigas(w, d, H, 5)
    walls = box_walls(w, d)
    for i, (P, width) in enumerate(walls):
        n = max(1, int(width / 3.4))
        for k in range(n):
            x = (k + 0.5) * width / n
            if i == 0 and k == n // 2:
                door(P, x, 1.1, 2.2, trim)
                continue
            slab(trim, P, x - 0.65, x + 0.65, 1.0, 2.3, 0.0, 0.06)
            slab("glass_d", P, x - 0.5, x + 0.5, 1.12, 2.18, 0.0, 0.08)
    pots(walls[0][0], 0.8, 3)
    if second:
        w2, d2, H2 = w * 0.55, d * 0.55, 3.0
        box(wall, (-w / 2 + w2 / 2 + 0.3, H + H2 / 2, -d / 2 + d2 / 2 + 0.3), (w2, H2, d2), 0.18)
        box("adobe2", (-w / 2 + w2 / 2 + 0.3, H + H2 + 0.05, -d / 2 + d2 / 2 + 0.3), (w2 - 0.3, 0.12, d2 - 0.3))
        for (P, width) in box_walls(w2, d2, -w / 2 + w2 / 2 + 0.3, -d / 2 + d2 / 2 + 0.3)[:2]:
            slab(trim, P, width / 2 - 0.6, width / 2 + 0.6, H + 0.9, H + 2.1, 0.0, 0.06)
            slab("glass_d", P, width / 2 - 0.45, width / 2 + 0.45, H + 1.0, H + 2.0, 0.0, 0.08)
        # Outside stair up the side wall.
        for k in range(10):
            box(wall, (w / 2 + 0.6, 0.2 + k * H / 10, -d / 2 + 1.0 + k * 0.45), (1.0, 0.4, 0.5), 0.04)
        # Shade over the terrace: posts and a reed mat.
        for (sx, sz) in ((0.1, 0.1), (0.45, 0.1), (0.1, 0.45), (0.45, 0.45)):
            cyl("wood", (sx * w, H + 1.2, sz * d), 0.08, 2.4, 6)
        box("thatch", (0.27 * w, H + 2.45, 0.27 * d), (0.45 * w, 0.08, 0.45 * d))
    obj(name)


def cantina(name):
    """A cantina: a long adobe front, a timber porch with string lights, a
    painted sign, tables under the porch."""
    w, d, H = 16, 10, 4.6
    box("ochre", (0, H / 2, 0), (w, H, d), 0.2)
    parapet(w, d, H, "ochre")
    # Stepped false front with the sign.
    box("ochre", (0, H + 1.2, d / 2 - 0.2), (8, 2.4, 0.4), 0.1)
    box("ochre", (0, H + 2.6, d / 2 - 0.2), (4, 1.0, 0.4), 0.1)
    box("terra", (0, H + 1.3, d / 2 + 0.02), (6.4, 1.2, 0.04))
    box("neon_y", (0, H + 1.3, d / 2 + 0.06), (5.4, 0.2, 0.04))
    P, width = box_walls(w, d)[0]
    for k in range(4):
        x = 1.6 + k * (width - 3.2) / 3
        if k == 1:
            door(P, x, 1.6, 2.5, "teal")
        else:
            slab("teal", P, x - 0.9, x + 0.9, 0.9, 2.5, 0.0, 0.06)
            slab("glass_d", P, x - 0.75, x + 0.75, 1.0, 2.4, 0.0, 0.08)
    # Porch.
    box("wood2", (0, 0.15, d / 2 + 2.0), (w, 0.3, 4.0), 0.02)
    for k in range(6):
        x = -w / 2 + 0.5 + k * (w - 1) / 5
        cyl("wood", (x, 1.7, d / 2 + 3.8), 0.12, 3.4, 6)
    box("wood", (0, 3.45, d / 2 + 2.0), (w + 0.4, 0.15, 4.3), 0.02)
    box("thatch", (0, 3.6, d / 2 + 2.0), (w + 0.6, 0.15, 4.4), 0.03)
    if not far():
        for k in range(14):
            x = -w / 2 + 0.6 + k * (w - 1.2) / 13
            ball("lamp", (x, 3.1 - 0.15 * math.sin(k * 0.9) ** 2, d / 2 + 3.75), 0.09, 1)
        for k in range(3):
            x = -w / 2 + 3 + k * 5
            cyl("wood2", (x, 0.75, d / 2 + 2.0), 0.6, 0.08, 10)
            cyl("wood", (x, 0.5, d / 2 + 2.0), 0.08, 0.5, 6)
            box("canvas_r", (x, 2.7, d / 2 + 2.0), (0.06, 0.06, 0.06))
    obj(name)


def tienda(name, wall, band):
    """A corner shop: a painted wall with a big lettered band, an awning,
    a soda fridge and crates out front."""
    w, d, H = 10, 8, 4.2
    box(wall, (0, H / 2, 0), (w, H, d), 0.18)
    parapet(w, d, H, wall)
    box(band, (0, H - 0.6, d / 2 + 0.01), (w - 0.4, 0.9, 0.04))
    box("trimw", (0, H - 0.6, d / 2 + 0.04), (w * 0.6, 0.4, 0.03))
    P, width = box_walls(w, d)[0]
    slab("glass_d", P, 1.0, 4.4, 0.6, 2.5, 0.0, 0.06)
    door(P, 6.0, 1.3, 2.4, "dark")
    awning("canvas_w", P, 0.6, width - 0.6, 3.1, 1.8, 0.5, stripes=band)
    if not far():
        box("canvas_r", (w / 2 - 1.4, 0.9, d / 2 + 0.6), (0.9, 1.8, 0.7), 0.05)
        box("glass", (w / 2 - 1.4, 1.0, d / 2 + 0.96), (0.7, 1.2, 0.02))
        for k in range(3):
            box("wood2" if k % 2 else "ochre", (-w / 2 + 1.2 + k * 0.62, 0.25 + (k == 1) * 0.5, d / 2 + 0.7), (0.55, 0.5, 0.45), 0.02)
    obj(name)


def mission(name):
    """A whitewashed mission church: a bell gable (espadaña) over an arched
    door, buttresses down the sides, a little dome at the back."""
    w, d, H = 10, 20, 8
    box("white", (0, H / 2, -2), (w, H, d), 0.2)
    box("white", (0, H + 0.4, -2), (w + 0.2, 0.8, d + 0.2), 0.1)
    for s in (-1, 1):
        for k in range(4):
            z = -2 - d / 2 + 2 + k * (d - 4) / 3
            box("white", (s * (w / 2 + 0.5), 2.6, z), (1.0, 5.2, 1.4), 0.15)
            box("glass_d", (s * (w / 2 + 0.03), 5.2, z + (d - 4) / 6), (0.06, 2.0, 0.8))
    # Front: a tall stepped gable with three bell arches.
    fz = -2 + d / 2
    box("white", (0, H + 3.5, fz - 0.3), (w, 7, 0.9), 0.1)
    box("white", (0, H + 7.8, fz - 0.3), (w * 0.55, 2.0, 0.9), 0.1)
    box("white", (0, H + 9.4, fz - 0.3), (1.6, 1.4, 0.9), 0.1)
    box("wood", (0, H + 10.7, fz - 0.3), (0.15, 1.2, 0.15))
    box("wood", (0, H + 10.9, fz - 0.3), (0.7, 0.15, 0.15))
    for (x, y) in ((-2.4, H + 4.6), (2.4, H + 4.6), (0, H + 7.6)):
        box("dark", (x, y, fz + 0.16), (1.2, 1.6, 0.04))
        cyl("dark", (x, y + 0.8, fz + 0.16), 0.6, 0.04, 10, axis="z")
        if not far():
            cyl("rust", (x, y + 0.4, fz + 0.2), 0.35, 0.5, 8, r1=0.18)
    # Arched door and a round window.
    box("wood", (0, 1.7, fz + 0.03), (2.2, 3.4, 0.06))
    cyl("wood", (0, 3.4, fz + 0.03), 1.1, 0.06, 12, axis="z")
    box("adobe", (0, 0.2, fz + 1.5), (4.5, 0.4, 3.0), 0.04)
    cyl("glass_d", (0, H + 1.6, fz + 0.2), 0.9, 0.06, 12, axis="z")
    cyl("trimw", (0, H + 1.6, fz + 0.18), 1.05, 0.04, 12, axis="z")
    # Dome over the altar.
    cyl("white", (0, H + 1.2, -2 - d / 2 + 3), 2.6, 2.4, 12)
    ball("white", (0, H + 2.4, -2 - d / 2 + 3), 2.6, 2, 0.7)
    box("wood", (0, H + 4.6, -2 - d / 2 + 3), (0.12, 1.0, 0.12))
    obj(name)


def gas(name):
    """A gas station: a canopy on steel posts with lit edges, four pumps, a
    small store with a sign pole."""
    box("concrete", (0, 0.06, 2), (16, 0.12, 12))
    for (x, z) in ((-5, 5), (5, 5), (-5, -1), (5, -1)):
        box("steel", (x, 2.6, z), (0.3, 5.2, 0.3))
    box("trimw", (0, 5.5, 2), (14, 0.7, 9), 0.05)
    box("canvas_r", (0, 5.5, 6.52), (14, 0.5, 0.04))
    box("canvas_r", (0, 5.5, -2.52), (14, 0.5, 0.04))
    box("lamp", (0, 5.13, 2), (12, 0.04, 7))
    for x in (-2.5, 2.5):
        for z in (4.6, -0.6):
            box("concrete", (x, 0.2, z), (1.4, 0.4, 0.8))
            box("canvas_r", (x, 1.1, z), (0.7, 1.6, 0.5), 0.04)
            box("screen", (x, 1.5, z + 0.26), (0.4, 0.3, 0.02))
    # Store at the back.
    box("white", (0, 2.0, -6.5), (12, 4.0, 5), 0.1)
    box("glass_d", (0, 1.6, -3.98), (8, 2.4, 0.06))
    box("canvas_r", (0, 3.7, -3.95), (12, 0.6, 0.06))
    # Sign pole with the price board.
    box("steel", (7.4, 4, 7), (0.3, 8, 0.3))
    box("canvas_r", (7.4, 8.4, 7), (2.2, 1.4, 0.4), 0.05)
    box("screen", (7.4, 7.2, 7.22), (1.8, 0.8, 0.04))
    obj(name)


def watertower(name):
    """A water tank on timber legs with cross-bracing and a ladder."""
    for (x, z) in ((-1.6, -1.6), (1.6, -1.6), (-1.6, 1.6), (1.6, 1.6)):
        box("wood", (x, 4.5, z), (0.3, 9, 0.3))
    if not far():
        for y in (2.5, 6.0):
            for (a, b) in (((-1.6, -1.6), (1.6, -1.6)), ((1.6, -1.6), (1.6, 1.6)), ((1.6, 1.6), (-1.6, 1.6)), ((-1.6, 1.6), (-1.6, -1.6))):
                tube("wood2", [(a[0], y - 1.2, a[1]), (b[0], y + 1.2, b[1])], 0.07, 4)
    box("wood2", (0, 9.1, 0), (4.0, 0.25, 4.0))
    cyl("rust", (0, 10.8, 0), 2.0, 3.2, 14)
    cyl("rust", (0, 12.8, 0), 2.1, 0.8, 14, r1=0.2)
    obj(name)


def windpump(name):
    """A farm windpump: a lattice tower, a bladed wheel and a tail vane."""
    for (x, z) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        tube("steel", [(x * 1.4, 0, z * 1.4), (x * 0.25, 9, z * 0.25)], 0.06, 4)
    if not far():
        for k in range(4):
            y = 1.5 + k * 2.0
            r = 1.4 - (1.15 * y / 9)
            box("steel", (0, y, r), (2 * r, 0.05, 0.05)); box("steel", (0, y, -r), (2 * r, 0.05, 0.05))
            box("steel", (r, y, 0), (0.05, 0.05, 2 * r)); box("steel", (-r, y, 0), (0.05, 0.05, 2 * r))
    cyl("steel", (0, 9.3, 0.4), 0.25, 0.6, 8, axis="z")
    n = 8 if far() else 16
    for k in range(n):
        a = 2 * math.pi * k / n
        p0 = (math.cos(a) * 0.3, 9.3 + math.sin(a) * 0.3, 0.75)
        p1 = (math.cos(a) * 1.5, 9.3 + math.sin(a) * 1.5, 0.75)
        tube("steel", [p0, p1], 0.12 if far() else 0.09, 3)
    box("steel", (0, 9.3, -1.0), (0.05, 0.05, 2.0))
    box("canvas_r", (0, 9.4, -2.0), (0.04, 0.9, 1.2))
    obj(name)


def palapa(name):
    """A thatched shade on poles over a table."""
    for (x, z) in ((-1.6, -1.6), (1.6, -1.6), (-1.6, 1.6), (1.6, 1.6)):
        cyl("wood", (x, 1.4, z), 0.1, 2.8, 6)
    cyl("thatch", (0, 3.2, 0), 3.0, 1.4, 10, r1=0.1)
    cyl("wood2", (0, 0.75, 0), 0.8, 0.08, 10)
    cyl("wood", (0, 0.4, 0), 0.1, 0.8, 6)
    obj(name)


# ── Desert ───────────────────────────────────────────────────────────────────
def saguaro(name, h, arms, seed):
    """A saguaro: a ribbed column and arms that bend up."""
    rnd = random.Random(seed)
    n = 8 if far() else 10  # (halved for far by cyl)
    r = 0.38 * h / 8
    cyl("cactus", (0, h / 2, 0), r, h, n, r1=r * 0.92)
    if not far():
        ball("cactus2", (0, h, 0), r * 0.95, 1, 0.8)
    for k in range(arms):
        a = rnd.random() * 6.28
        y0 = h * (0.35 + rnd.random() * 0.25)
        L = h * (0.18 + rnd.random() * 0.1)
        up = h * (0.2 + rnd.random() * 0.15)
        dx, dz = math.cos(a), math.sin(a)
        tube("cactus2", [(dx * r * 0.6, y0, dz * r * 0.6), (dx * L, y0 + 0.3, dz * L), (dx * L, y0 + 0.3 + up, dz * L)], r * 0.7, 4 if far() else n - 2)
        if not far():
            ball("cactus2", (dx * L, y0 + 0.3 + up, dz * L), r * 0.68, 1, 0.8)
    obj(name)


def cardon(name):
    """A cardón cluster: many columns from one base."""
    n = 4 if far() else 9
    rnd = random.Random(7)
    for k in range(7):
        if far() and k % 2:
            rnd.random(); rnd.random()
            continue
        a = k * 2.4
        lean = 0.12 + rnd.random() * 0.15
        h = 4 + rnd.random() * 4
        dx, dz = math.cos(a) * lean, math.sin(a) * lean
        tube("cactus" if k % 2 else "cactus2", [(dx * 2, 0, dz * 2), (dx * 6, 1.2, dz * 6), (dx * (6 + h), h, dz * (6 + h))], 0.3, n)
        if not far():
            ball("cactus2", (dx * (6 + h), h, dz * (6 + h)), 0.29, 1, 0.8)
    obj(name)


def agave(name):
    """Agave and a couple of creosote bushes."""
    if far():
        cyl("agave", (0, 0.5, 0), 0.9, 1.0, 5, r1=0.15, cap=False)
        cyl("bush", (1.6, 0.6, 0.4), 0.8, 1.2, 5, r1=0.2, cap=False)
        obj(name)
        return
    for k in range(10 if not far() else 5):
        a = 2 * math.pi * k / (10 if not far() else 5)
        tube("agave", [(0, 0.1, 0), (math.cos(a) * 0.6, 0.7, math.sin(a) * 0.6), (math.cos(a) * 0.9, 1.0, math.sin(a) * 0.9)], 0.09, 3)
    bush((1.6, 0, 0.4), 0.8, "bush", 3, 1)
    bush((-1.4, 0, -0.6), 0.6, "bush2", 3, 2)
    obj(name)


def shrubs(name):
    if far():
        for k, (x, z, r) in enumerate(((0, 0, 0.9), (1.8, 0.6, 0.6), (-1.5, 0.9, 0.7))):
            cyl("bush" if k % 2 else "bush2", (x, r * 0.6, z), r * 1.1, r * 1.2, 5, r1=r * 0.3, cap=False)
        obj(name)
        return
    for k, (x, z, r) in enumerate(((0, 0, 0.9), (1.8, 0.6, 0.6), (-1.5, 0.9, 0.7), (0.4, -1.6, 0.5))):
        bush((x, 0, z), r, "bush" if k % 2 else "bush2", 3, k)
    obj(name)


def fanpalm(name, h):
    """A tall skinny fan palm with a skirt of dead fronds."""
    if far():
        cyl("trunk", (0, h / 2, 0), 0.25, h, 5, r1=0.2)
        ball("leaf", (0, h, 0), 1.6, 1, 0.6)
        ball("thatch", (0, h - 1.2, 0), 0.9, 1, 1.2)
        obj(name)
        return
    cyl("trunk", (0, h / 2, 0), 0.3, h, 8, r1=0.22)
    cyl("thatch", (0, h - 1.2, 0), 0.65, 2.0, 8, r1=0.4)
    for k in range(10):
        a = 2 * math.pi * k / 10
        frond(Vector((0, h, 0)), a, 2.2, 0.8 if k % 3 == 0 else 0.4, "leaf" if k % 2 else "leaf2", 5)
    obj(name)


def sandstone(name, w, h, seed):
    """Red sandstone: stacked weathered slabs, wider in the middle."""
    rnd = random.Random(seed)
    layers = 3 if far() else 5
    y = 0.0
    for k in range(layers):
        lh = h / layers * (0.8 + rnd.random() * 0.4)
        s = w * (0.75 + 0.25 * math.sin(math.pi * (k + 0.5) / layers)) * (0.9 + rnd.random() * 0.15)
        pts = []
        m = 6 if far() else 9
        for j in range(m):
            a = 2 * math.pi * j / m
            rr = s / 2 * (0.75 + rnd.random() * 0.35)
            pts.append((math.cos(a) * rr, math.sin(a) * rr * 0.75))
        prism(["sandst", "sandst2", "sandst3"][k % 3], pts, y, y + lh, 0.15 if not far() else 0)
        y += lh * 0.98
    if not far():
        for k in range(3):
            a = rnd.random() * 6.28
            ball("sandst3", (math.cos(a) * w * 0.5, 0.4, math.sin(a) * w * 0.4), 0.6 + rnd.random() * 0.5, 1, 0.7)
    obj(name)


def pole(name):
    """A wooden power pole with a cross-arm, insulators and a transformer."""
    cyl("wood", (0, 4.5, 0), 0.14, 9, 6, r1=0.11)
    box("wood", (0, 8.4, 0), (2.4, 0.14, 0.14))
    tube("wood", [(-0.9, 8.35, 0), (0, 7.6, 0), (0.9, 8.35, 0)], 0.04, 4)
    for x in (-1.0, 0.0, 1.0):
        cyl("steel" if x else "dark", (x, 8.6, 0), 0.06, 0.25, 5)
    if not far():
        box("dark", (0, 6.5, 0.12), (0.3, 0.5, 0.3), 0.04)
    obj(name)


# ── Rally ────────────────────────────────────────────────────────────────────
def tyres(name):
    """Tyre walls: three stacks lashed together, painted white on top."""
    for k in range(3):
        for j in range(4):
            cyl("tyre", (-1.4 + k * 1.4, 0.15 + j * 0.3, 0), 0.62, 0.28, 8 if not far() else 6)
        cyl("trimw" if k % 2 else "orange", (-1.4 + k * 1.4, 1.22, 0), 0.62, 0.04, 8)
    obj(name)


def bales(name):
    """Hay bales in a row with a sponsor banner over them."""
    for k in range(4):
        box("hay", (-2.4 + k * 1.6, 0.45, 0), (1.5, 0.9, 1.0), 0.06)
    for k in range(2):
        box("hay", (-1.6 + k * 1.6, 1.35, 0), (1.5, 0.9, 1.0), 0.06)
    box("sponsor", (0, 1.0, 0.52), (5.6, 0.7, 0.02))
    box("canvas_y", (0, 1.0, 0.54), (2.4, 0.3, 0.02))
    obj(name)


def tent(name):
    """A service tent: a pop-up canopy, a trophy truck under it, tools,
    tyres and a generator."""
    w, d = 8, 8
    for (x, z) in ((-w / 2, -d / 2), (w / 2, -d / 2), (-w / 2, d / 2), (w / 2, d / 2)):
        box("steel", (x, 1.5, z), (0.08, 3.0, 0.08))
    box("canvas_b", (0, 3.15, 0), (w + 0.2, 0.1, d + 0.2))
    box("canvas_b", (0, 3.5, 0), (w * 0.6, 0.6, d * 0.6), 0.2)
    box("canvas_w", (0, 2.85, d / 2 + 0.06), (w, 0.4, 0.04))
    # Trophy truck (simple: long-travel body on big tyres).
    box("truck", (0, 1.3, 0), (2.2, 0.8, 5.2), 0.12)
    box("dark", (0, 1.9, -0.3), (1.9, 0.7, 2.0), 0.08)
    box("glass_car", (0, 1.95, 0.72), (1.7, 0.55, 0.05))
    box("dark", (0, 1.1, -2.3), (1.6, 0.6, 1.0), 0.05)
    for z in (1.6, -1.7):
        for s in (-1, 1):
            wheel(s * 1.15, 0.5, z, 0.5, 0.35)
    if not far():
        box("canvas_r", (-w / 2 + 0.8, 0.5, -d / 2 + 0.8), (0.9, 1.0, 0.6), 0.04)
        for k in range(3):
            cyl("tyre", (w / 2 - 0.8, 0.2 + k * 0.32, -d / 2 + 1.2), 0.5, 0.3, 10)
        box("sponsor", (0, 0.8, -d / 2 + 0.2), (w * 0.8, 1.6, 0.04))
    obj(name)


def stand(name, w):
    """A scaffold grandstand: steel tubes, plank rows, a crowd, flags."""
    d, rows = 8, 7
    for k in range(int(w / 3) + 1):
        x = -w / 2 + k * w / int(w / 3)
        box("steel", (x, 2.3, -d / 2 + 0.3), (0.12, 4.6, 0.12))
        box("steel", (x, 0.6, d / 2 - 0.4), (0.12, 1.2, 0.12))
        tube("steel", [(x, 0.6, d / 2 - 0.4), (x, 4.6, -d / 2 + 0.3)], 0.05, 4)
    for r in range(rows):
        y = 0.7 + r * 0.6
        box("wood2", (0, y, d / 2 - 1.0 - r * 0.95), (w, 0.12, 0.9))
    box("sponsor", (0, 0.5, d / 2 - 0.35), (w, 0.9, 0.04))
    box("canvas_y", (0, 0.5, d / 2 - 0.32), (w * 0.4, 0.4, 0.02))
    if not far():
        cols = ["canvas_r", "canvas_b", "canvas_y", "trimw", "teal", "pinkw"]
        for r in range(rows):
            for k in range(int(w / 1.2)):
                if (k * 5 + r * 3) % 7 == 0: continue
                x = -w / 2 + 0.6 + k * 1.2
                y = 0.7 + r * 0.6
                z = d / 2 - 1.0 - r * 0.95
                box(cols[(k + r) % 6], (x, y + 0.42, z), (0.5, 0.6, 0.35), 0.04)
                ball("adobe", (x, y + 0.9, z), 0.17, 1)
                if (k + r) % 4 == 0:
                    ball("canvas_w", (x, y + 1.08, z), 0.22, 1, 0.35)
        for k in range(5):
            x = -w / 2 + 1 + k * (w - 2) / 4
            box("steel", (x, 6.0, -d / 2 + 0.3), (0.05, 2.8, 0.05))
            box(["canvas_r", "trimw", "green", "canvas_y", "canvas_b"][k], (x + 0.5, 6.9, -d / 2 + 0.3), (1.0, 0.6, 0.02))
    obj(name)


def chevron(name, way):
    """A chevron board on a sharp bend, lamps lit in turn the way it goes."""
    lamp = "arrow" if way > 0 else "arrowl"
    for s in (-1, 1):
        box("wood", (s * 0.95, 1.0, -0.05), (0.12, 2.0, 0.12))
    box("sponsor", (0, 2.2, 0.0), (2.4, 1.0, 0.08), 0.02)
    box("orange", (0, 2.72, 0.0), (2.45, 0.05, 0.1))
    box("orange", (0, 1.68, 0.0), (2.45, 0.05, 0.1))
    if far():
        for c in (-0.72, 0.0, 0.72):
            box(lamp, ((c + 0.1) * way, 2.2, 0.06), (0.32, 0.6, 0.02))
        obj(name)
        return
    for c in (-0.72, 0.0, 0.72):
        for v in (-0.3, -0.15, 0.0, 0.15, 0.3):
            u = c + (0.3 - abs(v)) * 0.75
            x, y = u * way, 2.2 + v
            cyl("dark", (x, y, 0.05), 0.07, 0.03, 10, axis="z")
            cyl(lamp, (x, y, 0.065), 0.06, 0.02, 10, axis="z")
    obj(name)


def wreck(name):
    """A rusted-out old car on its rims."""
    car_shell("rust", 4.4, 1.8, 0.6, -1.1, 1.1, "rust", glass="dark", ride=0.12)
    obj(name)


# ── Vehicles ─────────────────────────────────────────────────────────────────
def pickup(name, body, load=None):
    """A pickup: a cab up front, a bed behind (maybe loaded)."""
    L, W = 5.2, 1.95
    box(body, (0, 0.85, 0), (W, 0.75, L), 0.08)
    box(body, (0, 1.55, 0.55), (W - 0.1, 0.7, 1.8), 0.1)
    box("glass_car", (0, 1.6, 1.46), (W - 0.3, 0.5, 0.04))
    box("glass_car", (0, 1.6, 0.55), (W - 0.05, 0.45, 1.5))
    box("dark", (0, 1.25, -1.25), (W - 0.15, 0.1, 2.5))
    for s in (-1, 1):
        box("lamp", (s * 0.7, 0.95, L / 2 + 0.01), (0.35, 0.18, 0.03))
        box("tail", (s * 0.85, 0.95, -L / 2 - 0.01), (0.2, 0.3, 0.03))
        for z in (1.6, -1.6):
            wheel(s * 0.9, 0.4, z, 0.4, 0.28)
    box("dark", (0, 0.55, L / 2 + 0.05), (W, 0.2, 0.12))
    if load == "hay":
        box("hay", (0, 1.55, -1.25), (1.5, 0.8, 2.0), 0.06)
    elif load == "barrels":
        for k in range(3):
            cyl("canvas_b", (-0.5 + k * 0.5, 1.6, -1.25), 0.25, 0.9, 8)
    obj(name)


def beetle(name, body):
    """A round little taxi."""
    box(body, (0, 0.75, 0), (1.6, 0.7, 4.0), 0.3)
    ball(body, (0, 1.15, -0.1), 1.0, 2, 0.6)
    box("glass_car", (0, 1.35, 0.55), (1.3, 0.4, 0.4), 0.1)
    box("trimw", (0, 1.7, 0.1), (0.6, 0.15, 0.3), 0.04)
    for s in (-1, 1):
        box("lamp", (s * 0.55, 0.85, 2.0), (0.25, 0.25, 0.04), 0.05)
        for z in (1.25, -1.25):
            wheel(s * 0.78, 0.33, z, 0.33, 0.2)
    obj(name)


def oldbus(name):
    """An old school bus repainted, with luggage on the roof."""
    L, W = 10, 2.45
    box("bus_y", (0, 1.7, -0.4), (W, 2.4, L - 1.4), 0.2)
    box("bus_y", (0, 1.0, L / 2 - 0.8), (W - 0.2, 1.0, 1.6), 0.15)
    box("glass_car", (0, 2.2, -0.4), (W + 0.02, 0.9, L - 2.4))
    box("glass_car", (0, 2.1, L / 2 - 1.55), (W - 0.3, 0.9, 0.05))
    box("teal", (0, 1.25, -0.4), (W + 0.03, 0.3, L - 1.6))
    for s in (-1, 1):
        box("lamp", (s * 0.8, 1.2, L / 2 + 0.01), (0.3, 0.3, 0.03))
        box("tail", (s * 1.0, 1.0, -L / 2 + 0.69), (0.3, 0.4, 0.03))
        for z in (L / 2 - 1.5, -L / 2 + 2.2):
            wheel(s * (W / 2 - 0.15), 0.5, z, 0.5, 0.3)
    if not far():
        for k in range(4):
            box(["canvas_r", "canvas_b", "hay", "wood2"][k], (-0.5 + (k % 2), 3.15, -2 + k), (0.8, 0.5, 0.8), 0.05)
    obj(name)


# ── Build ────────────────────────────────────────────────────────────────────
def build():
    adobe("adobe_a", 10, 8, 4.0, "adobe", "teal")
    adobe("adobe_b", 12, 9, 4.2, "terra", "bluew", second=True)
    adobe("adobe_c", 9, 8, 3.8, "pinkw", "green")
    adobe("adobe_d", 11, 9, 4.0, "white", "bluew", second=True)
    cantina("cantina")
    tienda("tienda_a", "teal", "canvas_r")
    tienda("tienda_b", "ochre", "canvas_b")
    mission("mission")
    gas("gas")
    watertower("watertower")
    windpump("windpump")
    palapa("palapa")
    saguaro("saguaro_a", 8, 3, 1)
    saguaro("saguaro_b", 6, 2, 2)
    saguaro("saguaro_c", 10, 4, 3)
    cardon("cardon")
    agave("agave")
    shrubs("shrubs")
    fanpalm("fanpalm", 13)
    sandstone("rock_a", 5, 4, 11)
    sandstone("rock_b", 10, 9, 12)
    sandstone("mesa", 26, 22, 13)
    pole("pole")
    tyres("tyres")
    bales("bales")
    tent("tent")
    stand("stand", 30)
    chevron("chevron_r", 1)
    chevron("chevron_l", -1)
    wreck("wreck")
    pickup("sedan_r", "car_r", "hay")
    pickup("sedan_b", "car_b")
    pickup("sedan_w", "car_w", "barrels")
    beetle("taxi", "car_t")
    pickup("police", "police")
    pickup("van", "car_s")
    oldbus("bus")


build_both(build)
export()
