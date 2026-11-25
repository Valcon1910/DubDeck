# The Sky kit: a kingdom on floating islands. Castle keeps and a gatehouse,
# a wizard's tower, a domed temple, cottages, a windmill, trees in blossom,
# glowing crystals, statues, a gazebo, lantern posts, a grandstand, chevron
# boards, and the open air between the islands: cloud banks, little islets
# with a tree, hot-air balloons and an airship (drawn only).
#   blender -b -P scripts/hexdrift-kit/sky.py -- out.glb
import math, os, sys, random
sys.path.insert(0, os.path.dirname(__file__))
from kit import *

reset()
palette({
    # Stone, plaster, timber, roofs, gold.
    "stone": "#d8d2c4", "stone2": "#bfb7a6", "stone3": "#a59c8a", "plaster": "#fbf4e6", "beam": "#6e4a2c", "wood": "#8c5f38",
    "roof_b": "#3f6fd6", "roof_p": "#c85aa8", "roof_r": "#d2523f", "roof_t": "#2fa79a", "gold": "#f0c548", "trim": "#2b2d36",
    "trimw": "#ffffff", "banner_r": "#e0365a", "banner_b": "#3a5fe0", "banner_y": "#ffd23d", "steel": "#8d939e", "dark": "#22242c",
    "canvas_w": "#f5f1e8", "canvas_r": "#e2475f", "canvas_y": "#f4c233", "canvas_t": "#2fb7c4",
    # Plants and rock.
    "grass": "#7ccf62", "leaf": "#4fa44a", "leaf2": "#6cc05a", "blossom": "#ffb3d9", "blossom2": "#ff8cc6", "trunk": "#7a5a40",
    "cypress": "#2f7a4a", "flower": "#ff5d9e", "flower2": "#ffd23d", "rock": "#8c7a68", "rock2": "#a6927c",
    # Air.
    "cloud": "#ffffff", "cloud2": "#e8f2fb", "balloon_a": "#ff6a5a", "balloon_b": "#ffd23d", "balloon_c": "#5ab0ff", "basket": "#a2774c",
    "ship": "#f2efe8", "ship2": "#3a5fe0",
    # Special looks (the game knows these names).
    "glass": "#7fb2d9", "glass_d": "#3a5878", "glass_car": "#1c2633", "lamp": "#fff4d6", "screen": "#202838",
    "neon_c": "#7af0ff", "neon_p": "#ff8af0", "blink": "#ffb43a", "arrow": "#ffa928", "arrowl": "#ffa928",
})


def cone_roof(c, r, h, material, n=12, gold=True):
    cyl(material, (c[0], c[1] + h / 2, c[2]), r, h, n, r1=0.02)
    if gold and not far():
        cyl("gold", (c[0], c[1] + h + 0.6, c[2]), 0.05, 1.2, 5)
        ball("gold", (c[0], c[1] + h + 0.1, c[2]), 0.18, 1)


def crenels(c, r, y, n=12, material="stone"):
    """Battlements round a round top."""
    if far():
        cyl(material, (c[0], y + 0.4, c[2]), r, 0.8, 8)
        return
    for k in range(n):
        a = 2 * math.pi * k / n
        box(material, (c[0] + math.cos(a) * r * 0.92, y + 0.45, c[2] + math.sin(a) * r * 0.92), (0.7, 0.9, 0.7), 0.04, yaw=-a)


def banner(x, y, z, material, h=2.4):
    box("gold", (x, y + h / 2 + 0.6, z), (0.06, h + 1.2, 0.06))
    box(material, (x + 0.45, y + h * 0.65, z), (0.9, h * 0.6, 0.03))


def round_tower(c, r, h, roof, windows_n=3, roof_h=None):
    """A round stone tower, slit windows up it, a corbelled top and a cone roof."""
    cyl("stone", (c[0], h / 2, c[2]), r, h, 14 if not far() else 8)
    cyl("stone2", (c[0], h + 0.3, c[2]), r + 0.35, 0.6, 14 if not far() else 8)
    if not far():
        for k in range(windows_n):
            y = h * (0.3 + 0.6 * k / max(1, windows_n))
            for a in (0.4, 2.5, 4.4):
                box("glass_d", (c[0] + math.cos(a) * (r + 0.02), y, c[2] + math.sin(a) * (r + 0.02)), (0.35, 1.1, 0.35), 0, yaw=-a)
    cone_roof((c[0], h + 0.6, c[2]), r + 0.6, roof_h or r * 2.6, roof, 14 if not far() else 8)


# ── Castle ───────────────────────────────────────────────────────────────────
def keep(name):
    """The castle keep: a square hall with corner towers, battlements,
    tall windows, a central spire, banners."""
    w, d, H = 12, 12, 14
    box("stone", (0, H / 2, 0), (w, H, d), 0.06)
    for (P, width) in box_walls(w, d):
        windows(P, width, 3, H - 1, floor=4, win=1.2, gap=2.2, sill=1.0, wh=2.4, glass="glass", frame="stone2", margin=1.5)
    if not far():
        for k in range(8):
            for (x, z, yaw) in ((-w / 2 + 0.75 + k * (w - 1.5) / 7, d / 2 - 0.3, 0), (-w / 2 + 0.75 + k * (w - 1.5) / 7, -d / 2 + 0.3, 0)):
                if k % 2 == 0: box("stone2", (x, H + 0.45, z), (0.9, 0.9, 0.6))
            for (x, z) in ((w / 2 - 0.3, -d / 2 + 0.75 + k * (d - 1.5) / 7), (-w / 2 + 0.3, -d / 2 + 0.75 + k * (d - 1.5) / 7)):
                if k % 2 == 0: box("stone2", (x, H + 0.45, z), (0.6, 0.9, 0.9))
    for sx in (-1, 1):
        for sz in (-1, 1):
            round_tower((sx * w / 2, 0, sz * d / 2), 2.2, H + 4, "roof_b", 3)
    # Central spire.
    box("stone2", (0, H + 3, 0), (5, 6, 5), 0.05)
    box("glass", (0, H + 3.5, 2.52), (1.2, 2.4, 0.05))
    cyl("roof_b", (0, H + 6 + 5, 0), 3.6, 10, 4, r1=0.02)
    if not far():
        cyl("gold", (0, H + 16.6, 0), 0.06, 1.6, 5)
        banner(0, H + 17.2, 0, "banner_r", 1.6)
    # Gate.
    box("wood", (0, 2.2, d / 2 + 0.05), (3, 4.4, 0.1))
    cyl("wood", (0, 4.4, d / 2 + 0.05), 1.5, 0.1, 12, axis="z")
    box("stone2", (0, 0.2, d / 2 + 1.5), (5, 0.4, 3), 0.04)
    obj(name)


def gatehouse(name):
    """Two round towers either side of an arch, a walkway between, banners."""
    for s in (-1, 1):
        round_tower((s * 5, 0, 0), 2.6, 11, "roof_r", 3)
        if not far():
            banner(s * 3.2, 9.2, 1.4, "banner_b" if s > 0 else "banner_y")
    box("stone", (0, 9.5, 0), (8, 3, 4), 0.05)
    box("stone", (-3.0, 4, 0), (2.0, 8, 4), 0.05)
    box("stone", (3.0, 4, 0), (2.0, 8, 4), 0.05)
    cyl("stone", (0, 8.0, 0), 2.0, 4, 12, axis="z")
    if not far():
        for k in range(5):
            box("stone2", (-3.2 + k * 1.6, 11.45, 1.7), (0.8, 0.9, 0.6))
            box("stone2", (-3.2 + k * 1.6, 11.45, -1.7), (0.8, 0.9, 0.6))
        # Portcullis.
        for k in range(7):
            box("dark", (-1.5 + k * 0.5, 4.5, 0), (0.08, 5, 0.08))
        for k in range(5):
            box("dark", (0, 2.5 + k * 1.1, 0), (3.2, 0.08, 0.08))
    obj(name)


def wizard(name):
    """A slender wizard's tower: leaning stacked drums, a balcony, a tall
    crooked violet roof and a glowing crystal at the tip."""
    y = 0.0
    r = 2.6
    for k in range(4):
        h = 4.2 - k * 0.4
        cyl("stone" if k % 2 == 0 else "stone2", (k * 0.12, y + h / 2, 0), r - k * 0.25, h, 12 if not far() else 7, r1=r - (k + 1) * 0.25)
        if not far():
            box("glass", (k * 0.12 + 0.0, y + h * 0.55, r - k * 0.25 - 0.05), (0.6, 1.0, 0.1))
        y += h
    cyl("wood", (0.5, y + 0.15, 0), r + 0.3, 0.3, 12 if not far() else 7)
    cyl("roof_p", (0.6, y + 3.2, 0), r + 0.5, 6.0, 12 if not far() else 7, r1=0.4)
    cyl("roof_p", (0.9, y + 7.0, 0.2), 0.45, 2.0, 8, r1=0.05)
    ball("neon_p", (1.0, y + 8.3, 0.25), 0.4, 1)
    obj(name)


def temple(name):
    """A round temple: a stepped base, a ring of columns, a gold dome."""
    for k in range(3):
        cyl("stone2", (0, 0.25 + k * 0.5, 0), 6.0 - k * 0.5, 0.5, 20 if not far() else 10)
    n = 12 if not far() else 8
    for k in range(n):
        a = 2 * math.pi * k / n
        cyl("plaster", (math.cos(a) * 4.3, 1.5 + 2.6, math.sin(a) * 4.3), 0.35, 5.2, 8 if not far() else 5)
    cyl("plaster", (0, 7.0, 0), 5.0, 0.7, 20 if not far() else 10)
    ball("gold", (0, 7.3, 0), 4.6, 2, 0.75)
    cyl("gold", (0, 11.0, 0), 0.4, 0.8, 8)
    ball("neon_c", (0, 11.7, 0), 0.5, 1)
    if not far():
        box("plaster", (0, 3.2, 0), (2.2, 3.6, 2.2), 0.08)
        ball("gold", (0, 5.4, 0), 0.7, 1)
    obj(name)


def cottage(name, roof, wall):
    """A fairy-tale cottage: half-timbered walls, a steep roof with a
    dormer, a round window, a chimney and flowers by the door."""
    w, d, H = 7, 6, 4.5
    box(wall, (0, H / 2, 0), (w, H, d), 0.05)
    if not far():
        for (P, width) in box_walls(w, d):
            slab("beam", P, -0.05, width + 0.05, H - 0.2, H, 0.0, 0.06)
            slab("beam", P, -0.05, width + 0.05, 2.1, 2.3, 0.0, 0.06)
            for k in range(int(width / 1.6) + 1):
                x = k * width / int(width / 1.6)
                slab("beam", P, x - 0.1, x + 0.1, 0.0, H, 0.0, 0.06)
    P, width = box_walls(w, d)[0]
    slab("wood", P, width / 2 - 0.55, width / 2 + 0.55, 0.0, 2.0, 0.0, 0.1)
    for x in (1.2, width - 1.2):
        slab("glass", P, x - 0.45, x + 0.45, 2.8, 3.8, 0.0, 0.08)
    # Steep roof (ridge along x).
    rise = 4.5
    for s in (-1, 1):
        bm = bmesh.new()
        pts = [(-w / 2 - 0.5, H - 0.3, s * (d / 2 + 0.6)), (w / 2 + 0.5, H - 0.3, s * (d / 2 + 0.6)), (w / 2 + 0.5, H + rise, 0), (-w / 2 - 0.5, H + rise, 0)]
        v = [bm.verts.new(G(*p)) for p in pts]
        bm.faces.new(v if s > 0 else list(reversed(v)))
        ob = link(bm, roof)
        sol = ob.modifiers.new("s", "SOLIDIFY"); sol.thickness = 0.3
        apply_mod(ob, sol)
    for sx in (-1, 1):
        bm = bmesh.new()
        v = [bm.verts.new(G(sx * w / 2, H, -d / 2)), bm.verts.new(G(sx * w / 2, H, d / 2)), bm.verts.new(G(sx * w / 2, H + rise * 0.92, 0))]
        bm.faces.new(v if sx < 0 else list(reversed(v)))
        link(bm, wall)
    cyl("glass", (w / 2 + 0.02, H + 1.5, 0), 0.5, 0.06, 10, axis="x")
    box(wall, (0, H + 1.4, d / 2 - 0.4), (1.6, 1.8, 1.4), 0.04)
    box("glass", (0, H + 1.4, d / 2 + 0.31), (0.8, 0.9, 0.05))
    cyl(roof, (0, H + 2.8, d / 2 - 0.4), 1.2, 1.4, 4, r1=0.05)
    box("stone3", (-w / 4, H + rise * 0.7, -d / 4), (0.8, 3.0, 0.8), 0.04)
    if not far():
        for k in range(4):
            ball("flower" if k % 2 else "flower2", (-2.2 + k * 0.4 + (k > 1) * 2.8, 0.3, d / 2 + 0.4), 0.3, 1)
    obj(name)


def windmill(name):
    """A tapered windmill with a cap and four lattice sails."""
    cyl("plaster", (0, 5, 0), 3.0, 10, 12 if not far() else 7, r1=2.1)
    cyl("roof_r", (0, 11.2, 0), 2.4, 2.4, 12 if not far() else 7, r1=0.3)
    box("wood", (0, 1.2, 2.95), (1.2, 2.4, 0.1))
    for y in (4, 7):
        box("glass", (0, y, 2.85 - (y - 4) * 0.25), (0.7, 0.9, 0.08))
    cyl("dark", (0, 10.6, 2.4), 0.25, 1.2, 8, axis="z")
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        dx, dy = math.cos(a), math.sin(a)
        tube("wood", [(0, 10.6, 3.0), (dx * 7, 10.6 + dy * 7, 3.0)], 0.12, 4)
        cx, cy = dx * 4.3, 10.6 + dy * 4.3
        box("canvas_w", (cx - dy * 0.6, cy + dx * 0.6, 3.1), (abs(dx) * 5.2 + abs(dy) * 1.1, abs(dy) * 5.2 + abs(dx) * 1.1, 0.04))
    obj(name)


# ── Garden ───────────────────────────────────────────────────────────────────
def tree(name, kind):
    """oak: a round crown; blossom: a pink one; cypress: tall and slim."""
    if kind == "cypress":
        cyl("trunk", (0, 0.8, 0), 0.25, 1.6, 6)
        ball("cypress", (0, 5.0, 0), 1.3, 2 if not far() else 1, 3.4)
        obj(name)
        return
    c1, c2 = ("leaf", "leaf2") if kind == "oak" else ("blossom", "blossom2")
    tube("trunk", [(0, 0, 0), (0.2, 2.2, 0), (0.1, 3.8, 0.2)], 0.35, 6)
    if far():
        ball(c1, (0, 5.2, 0), 3.0, 1, 0.8)
        obj(name)
        return
    for k, (x, y, z, r) in enumerate(((0, 5.4, 0, 2.6), (1.8, 4.8, 0.6, 1.8), (-1.6, 4.9, -0.4, 1.9), (0.3, 6.6, -0.8, 1.7), (-0.5, 4.6, 1.6, 1.6))):
        ball(c1 if k % 2 == 0 else c2, (x, y, z), r, 2, 0.85)
    obj(name)


def flowers(name):
    """A flowerbed in a stone edge (drawn only)."""
    box("stone2", (0, 0.15, 0), (4, 0.3, 2), 0.05)
    box("grass", (0, 0.32, 0), (3.7, 0.08, 1.7))
    if not far():
        rnd = random.Random(3)
        for k in range(14):
            ball(["flower", "flower2", "blossom2", "trimw"][k % 4], (-1.6 + rnd.random() * 3.2, 0.5, -0.7 + rnd.random() * 1.4), 0.22, 1)
    obj(name)


def lantern(name):
    """A garden lantern post."""
    cyl("dark", (0, 1.8, 0), 0.07, 3.6, 6)
    cyl("dark", (0, 0.2, 0), 0.2, 0.4, 6)
    box("dark", (0, 3.75, 0), (0.55, 0.08, 0.55))
    box("lamp", (0, 3.45, 0), (0.42, 0.55, 0.42))
    cyl("dark", (0, 4.0, 0), 0.38, 0.4, 4, r1=0.02)
    obj(name)


def crystal(name):
    """A cluster of glowing crystals out of a rock."""
    ball("rock", (0, 0.4, 0), 1.6, 1, 0.5)
    rnd = random.Random(5)
    for k in range(6 if not far() else 3):
        a = rnd.random() * 6.28
        h = 2 + rnd.random() * 4
        lean = 0.2 + rnd.random() * 0.3
        tube("neon_c" if k % 2 == 0 else "neon_p", [(math.cos(a) * 0.4, 0.3, math.sin(a) * 0.4), (math.cos(a) * (0.4 + h * lean), h, math.sin(a) * (0.4 + h * lean))], 0.35 - k * 0.03, 5)
    obj(name)


def statue(name):
    """A knight on a plinth, sword raised (simple, chunky)."""
    box("stone2", (0, 1.0, 0), (2.2, 2.0, 2.2), 0.08)
    box("stone", (0, 2.15, 0), (2.4, 0.3, 2.4), 0.05)
    box("gold", (0, 3.3, 0), (0.9, 2.0, 0.6), 0.15)
    ball("gold", (0, 4.6, 0), 0.4, 2)
    box("gold", (0.6, 4.4, 0), (0.25, 1.4, 0.25), 0.05)
    box("trimw", (0.65, 5.9, 0), (0.08, 1.8, 0.15))
    box("gold", (-0.6, 3.6, 0.2), (0.15, 1.2, 0.9), 0.05)
    obj(name)


def gazebo(name):
    for k in range(6):
        a = 2 * math.pi * k / 6
        cyl("trimw", (math.cos(a) * 2.6, 1.5, math.sin(a) * 2.6), 0.12, 3, 6)
    cyl("stone2", (0, 0.2, 0), 3.0, 0.4, 6)
    cyl("roof_t", (0, 3.9, 0), 3.3, 1.8, 6, r1=0.1)
    if not far():
        ball("gold", (0, 4.9, 0), 0.25, 1)
    obj(name)


def stand(name, w):
    """A grandstand for the kingdom: white tiers, striped canopy, pennants."""
    d, rows = 8, 7
    for r in range(rows):
        y = 0.5 + r * 0.6
        box("stone" if r % 2 else "plaster", (0, y / 2, d / 2 - 1.0 - r * 0.95), (w, y, 0.95), 0.02)
    box("plaster", (0, 2.4, -d / 2 + 0.4), (w, 4.8, 0.4))
    for k in range(6):
        x = -w / 2 + 0.5 + k * (w - 1) / 5
        cyl("gold", (x, 3.5, d / 2 - 0.4), 0.15, 7, 8)
    n = int(w / 2)
    for k in range(n):
        x = -w / 2 + (k + 0.5) * w / n
        box("canvas_r" if k % 2 else "canvas_w", (x, 7.2, 0.4), (w / n, 0.2, d + 0.6))
    if not far():
        cols = ["canvas_r", "canvas_t", "canvas_y", "trimw", "blossom2", "roof_b"]
        for r in range(rows):
            for k in range(int(w / 1.2)):
                if (k * 5 + r * 3) % 7 == 0: continue
                x = -w / 2 + 0.6 + k * 1.2
                y = 0.5 + r * 0.6
                z = d / 2 - 1.0 - r * 0.95
                box(cols[(k + r) % 6], (x, y + 0.42, z), (0.5, 0.6, 0.35), 0.04)
                ball("plaster", (x, y + 0.9, z), 0.17, 1)
        for k in range(8):
            x = -w / 2 + 1 + k * (w - 2) / 7
            box(["banner_r", "banner_b", "banner_y"][k % 3], (x, 6.6, d / 2 + 0.9), (0.9, 1.0, 0.03))
    obj(name)


def chevron(name, way):
    """A chevron board for the sharp bends (sequenced lamps)."""
    lamp = "arrow" if way > 0 else "arrowl"
    for s in (-1, 1):
        box("gold", (s * 0.95, 1.0, -0.05), (0.12, 2.0, 0.12))
    box("dark", (0, 2.2, 0.0), (2.4, 1.0, 0.08), 0.02)
    box("gold", (0, 2.72, 0.0), (2.45, 0.05, 0.1))
    box("gold", (0, 1.68, 0.0), (2.45, 0.05, 0.1))
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


# ── The open air (drawn only) ────────────────────────────────────────────────
def cloud(name, size, seed):
    """A cloud bank: flattened puffs, brighter on top."""
    rnd = random.Random(seed)
    n = 4 if far() else 9
    for k in range(n):
        x = (rnd.random() - 0.5) * size * 1.6
        z = (rnd.random() - 0.5) * size * 0.9
        r = size * (0.3 + rnd.random() * 0.25)
        ball("cloud" if k % 3 else "cloud2", (x, r * 0.35, z), r, 1 if far() else 2, 0.6)
    obj(name)


def islet(name, seed):
    """A small floating rock with grass and a tree on top."""
    rnd = random.Random(seed)
    cyl("rock2", (0, -4.0, 0), 0.6, 8, 7 if not far() else 5, r1=4.5)
    cyl("grass", (0, 0.25, 0), 4.6, 0.5, 7 if not far() else 5)
    tube("trunk", [(0.5, 0.4, 0), (0.6, 3, 0.2)], 0.25, 5)
    ball("blossom" if seed % 2 else "leaf", (0.6, 4.2, 0.2), 1.9, 1 if far() else 2, 0.85)
    if not far():
        for k in range(3):
            a = rnd.random() * 6.28
            ball("rock", (math.cos(a) * 2.8, 0.5, math.sin(a) * 2.8), 0.6, 1, 0.7)
    obj(name)


def balloon(name, c1, c2):
    """A hot-air balloon: striped envelope, ropes and a wicker basket."""
    n = 12 if not far() else 6
    rows = [(0.0, 2.0), (1.6, 4.2), (3.6, 5.6), (6.0, 6.2), (8.6, 5.6), (10.8, 4.0), (12.2, 1.8), (12.8, 0.2)]
    for i in range(len(rows) - 1):
        (y0, r0), (y1, r1) = rows[i], rows[i + 1]
        if far():
            cyl(c1 if i % 2 else c2, (0, 6 + (y0 + y1) / 2, 0), r0, y1 - y0, n, r1=r1, cap=False)
            continue
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            m = c1 if k % 2 else c2
            quad(m, (math.cos(a0) * r0, 6 + y0, math.sin(a0) * r0), (math.cos(a1) * r0, 6 + y0, math.sin(a1) * r0),
                 (math.cos(a1) * r1, 6 + y1, math.sin(a1) * r1), (math.cos(a0) * r1, 6 + y1, math.sin(a0) * r1))
    if not far():
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            tube("dark", [(math.cos(a) * 0.6, 1.4, math.sin(a) * 0.6), (math.cos(a) * 1.9, 6.0, math.sin(a) * 1.9)], 0.02, 3)
    box("basket", (0, 0.6, 0), (1.3, 1.1, 1.3), 0.08)
    obj(name)


def airship(name):
    """A small airship: a long envelope with fins, a gondola with windows."""
    L, R = 34, 5
    if far():
        cyl("ship", (0, 0, 0), R, L * 0.7, 8, axis="z")
        ball("ship", (0, 0, L * 0.35), R, 1, 1.0)
        ball("ship", (0, 0, -L * 0.35), R, 1, 1.0)
    else:
        n = 16
        prof = [(-L / 2, 0.4), (-L * 0.4, 2.6), (-L * 0.25, 4.4), (0, R), (L * 0.25, 4.6), (L * 0.4, 3.0), (L / 2, 0.6)]
        for i in range(len(prof) - 1):
            (z0, r0), (z1, r1) = prof[i], prof[i + 1]
            cyl("ship" if i % 2 else "ship2", (0, 0, (z0 + z1) / 2), r0, z1 - z0, n, r1=r1, axis="z", cap=False)
    for (dx, dy) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        box("ship2", (dx * 3.2, dy * 3.2, -L / 2 + 3), (0.2 + abs(dx) * 3.6, 0.2 + abs(dy) * 3.6, 4.5), 0.05)
    box("wood", (0, -R - 1.0, 2), (2.6, 1.8, 8), 0.2)
    box("glass", (0, -R - 0.9, 2), (2.65, 0.6, 6.8))
    box("lamp", (0, -R - 1.95, 2), (0.6, 0.1, 6))
    obj(name)


# ── Build ────────────────────────────────────────────────────────────────────
def build():
    keep("keep")
    gatehouse("gatehouse")
    wizard("wizard")
    temple("temple")
    cottage("cottage_a", "roof_b", "plaster")
    cottage("cottage_b", "roof_r", "plaster")
    cottage("cottage_c", "roof_t", "stone")
    windmill("windmill")
    tree("oak", "oak")
    tree("blossom", "blossom")
    tree("cypress", "cypress")
    flowers("flowers")
    lantern("lantern")
    crystal("crystal")
    statue("statue")
    gazebo("gazebo")
    stand("stand", 30)
    chevron("chevron_r", 1)
    chevron("chevron_l", -1)
    cloud("cloud_a", 14, 1)
    cloud("cloud_b", 22, 2)
    islet("islet_a", 1)
    islet("islet_b", 2)
    balloon("balloon_a", "balloon_a", "balloon_b")
    balloon("balloon_b", "balloon_c", "trimw")
    airship("airship")


build_both(build)
export()
