# The Alpine kit: a mountain village (chalets, a hotel, a chapel, shops, a
# barn, a ski hut), the forest and the rocks (snowy pines, boulders), the
# road (chevron boards that light up round the frozen corners, ice warning
# signs, lamps, wooden fences, a snowplough), a ski lift, a wooden
# grandstand, and cars and a yellow post bus for traffic.
#   blender -b -P scripts/hexdrift-kit/alpine.py -- out.glb
import math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from kit import *

reset()
palette({
    # Houses: stone, plaster, timber, roofs, shutters, flowers.
    "stone": "#8f8a82", "stone2": "#a6a097", "plaster": "#efe6d4", "plaster2": "#f3dcc0", "wood": "#6e4a2c", "wood2": "#8c5f38",
    "wood3": "#b07c48", "roof": "#4a3f38", "snow": "#f6f9ff", "snow2": "#e3ebf5", "shut_g": "#3e6b48", "shut_r": "#9c2f2a",
    "flower": "#e03a4a", "leafbox": "#3f7a3a", "trim": "#2b2d36", "trimw": "#ffffff", "steel": "#8d939e", "dark": "#22242c",
    "concrete": "#b5b2ab", "copper": "#3f8a78", "gold": "#d8b24a", "canvas_r": "#c8323c", "canvas_w": "#f5f1e8", "canvas_b": "#2f5fa8",
    # Nature.
    "pine": "#24543a", "pine2": "#2f6646", "bark": "#5a4030", "rock": "#7d7a74", "rock2": "#6a675f", "moss": "#5d6e4a",
    # Road: posts, signs, reflectors.
    "post": "#f2f0ea", "sign_r": "#d22a2a", "sign_y": "#f2c230", "panel": "#15161a", "reflect": "#ff7a1a",
    # Cars.
    "car_w": "#eef0f2", "car_k": "#1d2027", "car_r": "#b8242f", "car_b": "#2d5fbf", "car_g": "#2f5d46", "car_s": "#9aa1ab",
    "post_y": "#f6c400", "police": "#f2f4f8", "tyre": "#151517", "rim": "#b9bec6", "tail": "#9a1020", "plough": "#ff8a1a",
    # Special looks (the game knows these names).
    "glass": "#5b7d99", "glass_d": "#33485e", "glass_car": "#1c2633", "lamp": "#fff4d6",
    "blink": "#ffb43a", "arrow": "#ffa928", "arrowl": "#ffa928", "neon_c": "#2ee6ff", "neon_p": "#ff3da6", "screen": "#202838",
})


# ── Roofs ────────────────────────────────────────────────────────────────────
def plate(material, corners, t):
    """A slab: four top corners (x, y, z), pushed down t."""
    bm = bmesh.new()
    top = [bm.verts.new(G(*c)) for c in corners]
    bot = [bm.verts.new(G(c[0], c[1] - t, c[2])) for c in corners]
    bm.faces.new(top); bm.faces.new(list(reversed(bot)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((top[i], top[j], bot[j], bot[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bm.calc_volume(signed=True) < 0: bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return link(bm, material)


def gable(w, d, y, rise, over=0.8, roof="roof", snow="snow", ridge_x=False):
    """A pitched roof over a w×d box from height y: the ridge runs along z
    (front to back, so the gable faces the road), eaves overhanging by over,
    a thick snow cover on top, and the gable ends filled in timber."""
    hw, hd = w / 2 + over, d / 2 + over
    # Two slopes.
    for s in (-1, 1):
        c = [(0, y + rise, -hd), (0, y + rise, hd), (s * hw, y - over * rise / (w / 2), hd), (s * hw, y - over * rise / (w / 2), -hd)]
        if s > 0: c = [c[1], c[0], c[3], c[2]]
        plate(roof, c, 0.3)
        cs = [(x * 0.96 if x else 0, yy + 0.32, z * 0.97) for (x, yy, z) in c]
        plate(snow, cs, 0.3 if not far() else 0.2)
    # Gable ends: a triangle of boards (front and back).
    for sz in (-1, 1):
        bm = bmesh.new()
        z = sz * d / 2
        v = [bm.verts.new(G(-w / 2, y, z)), bm.verts.new(G(w / 2, y, z)), bm.verts.new(G(0, y + rise, z))]
        bm.faces.new(v if sz > 0 else list(reversed(v)))
        link(bm, "wood")
        if not far():
            for k in range(1, 6):
                x = -w / 2 + k * w / 6
                h = rise * (1 - abs(x) / (w / 2))
                box("wood2", (x, y + h / 2, z + sz * 0.04), (0.12, h, 0.06))
    # Snow icicle edge along the eaves (a thin white strip).
    if not far():
        for s in (-1, 1):
            box("snow2", (s * hw, y - over * rise / (w / 2) - 0.12, 0), (0.25, 0.25, 2 * hd))


def shutters(P, width, y0, y1, color, floor=2.9, win=1.0, gap=1.6, box_flowers=True):
    """Windows with wooden shutters either side and flower boxes under them."""
    windows(P, width, y0, y1, floor=floor, win=win, gap=gap, sill=0.9, wh=1.25, frame="trimw", margin=0.8)
    if far():
        return
    fl = int((y1 - y0) / floor)
    cols = max(1, int((width - 1.6 + gap) / (win + gap)))
    span = cols * win + (cols - 1) * gap
    x0 = (width - span) / 2
    for f in range(fl):
        yb = y0 + f * floor
        for k in range(cols):
            xa = x0 + k * (win + gap)
            slab(color, P, xa - 0.55, xa - 0.08, yb + 0.9, yb + 2.15, 0.02, 0.08)
            slab(color, P, xa + win + 0.08, xa + win + 0.55, yb + 0.9, yb + 2.15, 0.02, 0.08)
            if box_flowers:
                slab("wood2", P, xa - 0.05, xa + win + 0.05, yb + 0.62, yb + 0.86, 0.0, 0.3)
                slab("flower", P, xa, xa + win, yb + 0.86, yb + 1.0, 0.05, 0.28)


def balcony(P, xa, xb, y, out=1.2, step=0.22):
    """A timber balcony: a deck, cut-board railing, brackets underneath."""
    slab("wood2", P, xa, xb, y - 0.15, y, 0.0, out)
    slab("wood", P, xa, xb, y + 0.95, y + 1.05, out - 0.1, out)
    if far():
        slab("wood", P, xa, xb, y, y + 0.95, out - 0.08, out - 0.02)
        return
    n = int((xb - xa) / step)
    for k in range(n):
        x = xa + (k + 0.5) * (xb - xa) / n
        slab("wood3" if k % 2 else "wood", P, x - 0.08, x + 0.08, y, y + 0.95, out - 0.08, out - 0.03)
    for x in (xa + 0.3, (xa + xb) / 2, xb - 0.3):
        slab("wood", P, x - 0.08, x + 0.08, y - 0.8, y - 0.15, 0.0, 0.18)


# ── Village ──────────────────────────────────────────────────────────────────
def chalet(name, w, d, floors, wall, shut, rise):
    """A chalet: a stone ground floor, timber or plaster floors above, a
    balcony along the front, a deep snowy roof with the gable to the road,
    a chimney, firewood stacked by the door."""
    fh = 2.9
    H = 3.0 + (floors - 1) * fh
    box("stone", (0, 1.5, 0), (w, 3.0, d), 0.04)
    box(wall, (0, 3.0 + (H - 3.0) / 2, 0), (w - 0.1, H - 3.0, d - 0.1), 0.03)
    box("wood", (0, 3.05, 0), (w + 0.1, 0.12, d + 0.1))
    gable(w, d, H, rise)
    walls = box_walls(w, d)
    for i, (P, width) in enumerate(walls):
        shutters(P, width, 3.0, H, shut, box_flowers=i == 0)
        if i == 0:
            # Door and porch lamp.
            slab("wood", P, width / 2 - 0.6, width / 2 + 0.6, 0.0, 2.2, 0.0, 0.08)
            slab("lamp", P, width / 2 + 0.9, width / 2 + 1.1, 2.3, 2.55, 0.0, 0.14)
            for k in range(2):
                slab("glass", P, 0.9 + k * (width - 3.2), 2.3 + k * (width - 3.2), 0.9, 2.1, 0.0, 0.06)
    P, width = walls[0]
    if floors > 1:
        balcony(P, 0.4, width - 0.4, 3.2, 1.3)
    if floors > 2:
        balcony(P, width * 0.2, width * 0.8, 3.2 + fh, 1.0)
    # Chimney through the snow.
    box("stone2", (w * 0.22, H + rise * 0.75, -d * 0.2), (0.8, rise * 0.9, 0.8), 0.04)
    box("dark", (w * 0.22, H + rise * 1.22, -d * 0.2), (0.95, 0.12, 0.95))
    box("snow", (w * 0.22, H + rise * 1.3, -d * 0.2), (0.85, 0.12, 0.85), 0.04)
    # Firewood stack against the side wall.
    if not far():
        for k in range(3):
            for j in range(4):
                cyl("wood3", (w / 2 + 0.25, 0.18 + k * 0.32, -d / 2 + 1.0 + j * 0.34 + (k % 2) * 0.17), 0.16, 0.5, 6, axis="x")
        box("snow", (w / 2 + 0.25, 1.05, -d / 2 + 1.6), (0.55, 0.1, 1.5), 0.03)
    obj(name)


def hotel(name, w, d, floors):
    """A grand alpine hotel: plaster walls, rows of balconies on every floor,
    a big roof with dormers, a lit name board and an entrance canopy."""
    fh = 3.1
    H = 3.6 + floors * fh
    box("stone", (0, 1.8, 0), (w, 3.6, d), 0.05)
    box("plaster", (0, 3.6 + (H - 3.6) / 2, 0), (w - 0.2, H - 3.6, d - 0.2), 0.04)
    for (P, width) in box_walls(w, d):
        shutters(P, width, 3.6, H, "shut_g", floor=fh, win=1.2, gap=1.6, box_flowers=False)
        slab("glass_d", P, 1.0, width - 1.0, 0.6, 3.0, 0.0, 0.06)
    P, width = box_walls(w, d)[0]
    for f in range(floors):
        balcony(P, 0.6, width - 0.6, 3.6 + f * fh + 0.1, 1.4, step=0.55)
    # Roof: ridge along x here (long side to the road), so build it turned.
    rise = 5.5
    hw, hd = d / 2 + 1.0, w / 2 + 1.0
    for s in (-1, 1):
        c = [(-hd, H + rise, 0), (hd, H + rise, 0), (hd, H - 1.0 * rise / (d / 2), s * hw), (-hd, H - 1.0 * rise / (d / 2), s * hw)]
        if s < 0: c = [c[1], c[0], c[3], c[2]]
        plate("roof", c, 0.35)
        plate("snow", [(x * 0.97, yy + 0.34, z * 0.96 if z else 0) for (x, yy, z) in c], 0.3)
    for sx in (-1, 1):
        bm = bmesh.new()
        x = sx * w / 2
        v = [bm.verts.new(G(x, H, -d / 2)), bm.verts.new(G(x, H, d / 2)), bm.verts.new(G(x, H + rise, 0))]
        bm.faces.new(v if sx < 0 else list(reversed(v)))
        link(bm, "plaster2")
    # Dormers on the front slope.
    for k in range(4):
        x = -w / 2 + 4 + k * (w - 8) / 3
        box("plaster", (x, H + 1.3, d / 2 - 1.2), (2.2, 2.0, 1.6), 0.03)
        box("glass", (x, H + 1.3, d / 2 - 0.38), (1.3, 1.1, 0.06))
        plate("snow", [(x - 1.4, H + 2.7, d / 2 - 2.2), (x + 1.4, H + 2.7, d / 2 - 2.2), (x + 1.4, H + 2.3, d / 2 + 0.1), (x - 1.4, H + 2.3, d / 2 + 0.1)], 0.35)
    # Name board on the roof (lit) and the entrance canopy.
    box("dark", (0, H + rise - 0.2, d / 4), (w * 0.4, 1.5, 0.2), 0.03)
    box("lamp", (0, H + rise - 0.2, d / 4 + 0.12), (w * 0.36, 0.9, 0.04))
    box("wood", (0, 3.4, d / 2 + 2.5), (6, 0.35, 5), 0.06)
    box("snow", (0, 3.7, d / 2 + 2.5), (5.8, 0.25, 4.8), 0.06)
    for s in (-1, 1):
        cyl("wood", (s * 2.6, 1.7, d / 2 + 4.6), 0.18, 3.4, 8)
        box("glass_d", (s * 1.2, 1.3, d / 2 + 0.05), (1.6, 2.4, 0.08))
    for k in range(3):
        cyl("stone2", (-w / 2 + 2 + k * 0.6, H + 2.5, -d / 4), 0.45, 3.6, 8)
    obj(name)


def chapel(name):
    """A village chapel: whitewashed nave, steep snowy roof, a tower with an
    onion dome, a clock and arched windows."""
    w, d, H = 8, 14, 7
    box("plaster", (0, H / 2, -2), (w, H, d), 0.04)
    box("stone", (0, 0.4, -2), (w + 0.2, 0.8, d + 0.2), 0.02)
    gable(w, d, H, 4.2, over=0.6)
    for sx in (-1, 1):
        for k in range(3):
            z = -2 - d / 2 + 3 + k * 4
            box("glass_d", (sx * (w / 2 + 0.02), 4.2, z), (0.05, 2.6, 1.0))
            cyl("glass_d", (sx * (w / 2 + 0.02), 5.5, z), 0.5, 0.05, 10, axis="x")
    # Tower in front.
    tz = d / 2 - 2 + 1.6
    box("plaster", (0, 7.5, tz), (3.6, 15, 3.6), 0.04)
    box("stone", (0, 0.6, tz), (3.9, 1.2, 3.9), 0.02)
    box("wood", (0, 2.0, tz + 1.82), (1.4, 2.6, 0.08))
    for (sx, sz, ax) in ((0, 1, "z"), (0, -1, "z"), (1, 0, "x"), (-1, 0, "x")):
        c = (sx * 1.82, 11.4, tz + sz * 1.82)
        cyl("trimw", c, 0.75, 0.06, 16, axis=ax)
        cyl("dark", (c[0] + sx * 0.04, c[1], c[2] + sz * 0.04), 0.68, 0.04, 16, axis=ax)
        box("glass_d", (sx * 1.82, 13.4, tz + sz * 1.82), (1.0 if sz else 0.06, 1.6, 0.06 if sz else 1.0))
    box("plaster2", (0, 15.2, tz), (3.8, 0.4, 3.8), 0.04)
    cyl("copper", (0, 16.0, tz), 1.5, 1.2, 12, r1=1.3)
    ball("copper", (0, 17.4, tz), 1.45, 2, 1.1)
    cyl("copper", (0, 19.2, tz), 0.5, 1.6, 10, r1=0.08)
    cyl("gold", (0, 20.6, tz), 0.05, 1.5, 6)
    box("gold", (0, 20.8, tz), (0.6, 0.06, 0.06))
    ball("snow", (0, 17.9, tz), 1.2, 1, 0.5)
    obj(name)


def shoprow(name, w, d, colors):
    """Village shops under one long roof: a ski hire, a bakery, a café, each
    with a shop window, a striped awning and a hanging sign."""
    H = 6.2
    box("stone", (0, 0.4, 0), (w, 0.8, d), 0.02)
    n = len(colors)
    for k, c in enumerate(colors):
        x0 = -w / 2 + k * w / n
        box(c, (x0 + w / n / 2, H / 2, 0), (w / n - 0.05, H, d), 0.03)
    # Long roof: ridge along x.
    rise = 3.2
    for s in (-1, 1):
        c = [(-w / 2 - 0.8, H + rise, 0), (w / 2 + 0.8, H + rise, 0), (w / 2 + 0.8, H - 0.5, s * (d / 2 + 1.0)), (-w / 2 - 0.8, H - 0.5, s * (d / 2 + 1.0))]
        if s < 0: c = [c[1], c[0], c[3], c[2]]
        plate("roof", c, 0.3)
        plate("snow", [(x * 0.97, yy + 0.32, z * 0.96 if z else 0) for (x, yy, z) in c], 0.3)
    P, width = box_walls(w, d)[0]
    awn = ["canvas_r", "canvas_b", "canvas_r", "canvas_b"]
    for k in range(n):
        xa = k * width / n + 0.5
        xb = (k + 1) * width / n - 0.5
        slab("glass_d", P, xa + 0.3, xb - 1.6, 0.8, 3.0, 0.0, 0.06)
        slab("wood", P, xb - 1.4, xb - 0.3, 0.8, 3.0, 0.0, 0.08)
        awning("canvas_w", P, xa, xb, 3.7, 1.6, 0.6, stripes=awn[k % 4])
        slab("glass", P, xa + 0.6, xa + 1.8, 4.3, 5.6, 0.0, 0.06)
        slab("glass", P, xb - 1.8, xb - 0.6, 4.3, 5.6, 0.0, 0.06)
        if not far():
            # Hanging sign on an iron bracket.
            slab("dark", P, xa + 0.1, xa + 0.15, 3.9, 4.0, 0.0, 1.0)
            slab("gold", P, xa + 0.05, xa + 0.2, 3.1, 3.85, 0.7, 1.0)
    # Benches and a ski rack out front.
    if not far():
        for k in range(6):
            x = -w / 2 + 2 + k * 0.5
            box("wood3", (x, 1.0, d / 2 + 2.0), (0.08, 2.0, 0.08))
        box("dark", (-w / 2 + 3.2, 1.1, d / 2 + 2.0), (3.2, 0.08, 0.1))
    obj(name)


def barn(name):
    """A hay barn: dark timber, a stone footing, big doors, hay inside."""
    w, d = 12, 9
    box("stone", (0, 0.6, 0), (w, 1.2, d), 0.02)
    box("wood", (0, 3.3, 0), (w - 0.05, 4.2, d - 0.05), 0.02)
    if not far():
        for k in range(int(w / 0.4)):
            x = -w / 2 + 0.2 + k * 0.4
            box("wood2" if k % 3 else "wood", (x, 3.3, d / 2 + 0.03), (0.3, 4.2, 0.04))
    gable(w, d, 5.4, 3.4, over=0.7)
    box("wood3", (0, 2.6, d / 2 + 0.1), (3.6, 3.6, 0.1))
    box("wood", (0, 2.6, d / 2 + 0.16), (0.12, 3.6, 0.06))
    for s in (-1, 1):
        tube("wood", [(-1.7 * s, 0.9, d / 2 + 0.16), (0, 4.3, d / 2 + 0.16)], 0.06, 4)
    obj(name)


def hut(name):
    """A small ski hut / woodshed."""
    box("wood", (0, 1.3, 0), (4.0, 2.6, 3.2), 0.02)
    gable(4.0, 3.2, 2.6, 1.6, over=0.5)
    box("wood3", (0, 1.0, 1.62), (0.9, 2.0, 0.05))
    box("glass", (1.2, 1.5, 1.62), (0.7, 0.6, 0.05))
    if not far():
        for k in range(3):
            box("wood3" if k % 2 else "wood2", (-1.4 + k * 0.25, 1.0, 1.9), (0.1, 1.8, 0.04), yaw=0.1)
    obj(name)


def stand(name, w):
    """A timber grandstand with a snowy roof and the crowd's flags."""
    d, rows = 9, 8
    for r in range(rows):
        y = 0.5 + r * 0.55
        box("wood2" if r % 2 else "wood3", (0, y, d / 2 - 1.0 - r * 0.9), (w, 0.3, 0.9), 0.02)
        box("dark", (0, y - 0.35, d / 2 - 1.0 - r * 0.9 - 0.4), (w, 0.5, 0.1))
    box("wood", (0, 2.4, -d / 2 + 0.4), (w, 4.8, 0.4))
    for k in range(6):
        x = -w / 2 + 0.5 + k * (w - 1) / 5
        cyl("wood", (x, 3.5, d / 2 - 0.4), 0.2, 7, 8)
        cyl("wood", (x, 3.5, -d / 2 + 0.4), 0.2, 7, 8)
    plate("roof", [(-w / 2 - 0.5, 7.4, d / 2 + 0.6), (w / 2 + 0.5, 7.4, d / 2 + 0.6), (w / 2 + 0.5, 8.0, -d / 2 - 0.3), (-w / 2 - 0.5, 8.0, -d / 2 - 0.3)], 0.3)
    plate("snow", [(-w / 2 - 0.4, 7.7, d / 2 + 0.5), (w / 2 + 0.4, 7.7, d / 2 + 0.5), (w / 2 + 0.4, 8.3, -d / 2 - 0.2), (-w / 2 - 0.4, 8.3, -d / 2 - 0.2)], 0.3)
    box("dark", (0, 6.6, d / 2 + 0.5), (w * 0.6, 1.0, 0.1))
    box("screen", (0, 6.6, d / 2 + 0.56), (w * 0.56, 0.8, 0.02))
    if not far():
        cols = ["canvas_r", "canvas_b", "sign_y", "trimw", "car_g"]
        for r in range(rows):
            for k in range(int(w / 1.3)):
                if (k * 7 + r * 3) % 5 == 0: continue
                x = -w / 2 + 0.8 + k * 1.3
                y = 0.5 + r * 0.55
                z = d / 2 - 1.0 - r * 0.9
                box(cols[(k + r) % 5], (x, y + 0.45, z), (0.5, 0.6, 0.35), 0.04)
                ball("plaster2", (x, y + 0.95, z), 0.17, 1)
    obj(name)


# ── Nature ───────────────────────────────────────────────────────────────────
def pine(x, z, h, seed=0):
    """A snowy spruce: a trunk and stacked tiers, each with snow on top."""
    if far():
        # Two cones and a snow cap: reads the same from 70 m on.
        cyl("pine", (x, h * 0.42, z), h * 0.3, h * 0.62, 5, r1=h * 0.08, cap=False)
        cyl("snow", (x, h * 0.78, z), h * 0.16, h * 0.42, 5, r1=0.01, cap=False)
        return
    tiers, n = 6, 10
    cyl("bark", (x, h * 0.12, z), h * 0.03, h * 0.24, 5)
    for k in range(tiers):
        t = k / tiers
        r = h * (0.27 - 0.2 * t)
        y = h * (0.15 + 0.78 * t)
        th = h * 0.26
        cyl("pine" if k % 2 else "pine2", (x, y + th / 2, z), r, th, n, r1=r * 0.1)
        if not far() or k % 2 == 0:
            cyl("snow", (x + 0.05 * math.sin(seed + k), y + th * 0.62, z), r * 0.55, th * 0.5, n, r1=r * 0.04)
    cyl("snow", (x, h * 0.98, z), h * 0.04, h * 0.1, 5, r1=0.01)


def rocks(name, size, seed):
    """A heap of boulders with snow in the hollows and moss low down."""
    import random
    rnd = random.Random(seed)
    if far():
        ball("rock", (0, size * 0.3, 0), size * 0.45, 1, 0.7)
        ball("snow", (0, size * 0.5, 0), size * 0.36, 1, 0.4)
        obj(name)
        return
    for k in range(7):
        a = rnd.random() * 6.28
        r = size * (0.2 + rnd.random() * 0.3)
        d = size * 0.35 * rnd.random()
        x, z = math.cos(a) * d, math.sin(a) * d
        y = r * 0.6 + (0.0 if k < 3 else r * 0.4)
        ball("rock" if k % 2 else "rock2", (x, y, z), r, 1 if far() else 2, 0.75)
        ball("snow", (x, y + r * 0.45, z), r * 0.75, 1, 0.35)
        if k < 2 and not far():
            ball("moss", (x, r * 0.25, z), r * 0.95, 1, 0.25)
    obj(name)


def fence(name, L):
    """A rustic wooden fence: posts and two slanted rails, snow on top."""
    if far():
        box("wood2", (0, 0.75, 0), (L, 0.6, 0.06))
        box("snow", (0, 1.08, 0), (L, 0.06, 0.1))
        obj(name)
        return
    n = int(L / 2.0)
    for k in range(n + 1):
        x = -L / 2 + k * L / n
        box("wood", (x, 0.6, 0), (0.14, 1.2, 0.14))
        box("snow", (x, 1.24, 0), (0.18, 0.08, 0.18))
    for y in (0.5, 1.0):
        box("wood2", (0, y, 0.05), (L, 0.1, 0.06))
    box("snow", (0, 1.06, 0.05), (L, 0.05, 0.1))
    obj(name)


# ── Road ─────────────────────────────────────────────────────────────────────
def chevron(name, way):
    """A chevron board on the outside of a frozen corner: three arrows of
    amber lamps on a black board, lit one after another the way the road
    bends (the game sequences them along x), on two posts with reflectors."""
    lamp = "arrow" if way > 0 else "arrowl"
    for s in (-1, 1):
        box("post", (s * 0.95, 1.0, -0.05), (0.12, 2.0, 0.12))
        box("reflect", (s * 0.95, 1.6, 0.02), (0.1, 0.2, 0.02))
    box("panel", (0, 2.2, 0.0), (2.4, 1.0, 0.08), 0.02)
    box("post", (0, 2.72, 0.0), (2.45, 0.05, 0.1))
    box("post", (0, 1.68, 0.0), (2.45, 0.05, 0.1))
    if far():
        # One flat quad of lamps per arrow (still sequenced).
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
    box("snow", (0, 2.76, 0.0), (2.4, 0.06, 0.12), 0.02)
    obj(name)


def icesign(name):
    """A red warning triangle with a snowflake: ice ahead."""
    box("steel", (0, 1.2, 0), (0.08, 2.4, 0.08))
    bm = bmesh.new()
    pts = [(-0.55, 2.0), (0.55, 2.0), (0, 2.95)]
    v = [bm.verts.new(G(x, y, 0.05)) for x, y in pts]
    bm.faces.new(v)
    link(bm, "sign_r")
    bm = bmesh.new()
    v = [bm.verts.new(G(x * 0.72, 2.0 + (y - 2.0) * 0.72 + 0.1, 0.06)) for x, y in pts]
    bm.faces.new(v)
    link(bm, "trimw")
    for k in range(3):
        a = k * math.pi / 3
        box("canvas_b", (0, 2.4, 0.07), (0.32 * abs(math.cos(a)) + 0.04, 0.32 * abs(math.sin(a)) + 0.04, 0.01))
    box("snow", (0, 2.97, 0), (0.25, 0.06, 0.12), 0.02)
    obj(name)


def lamp(name):
    """A village street lamp: an iron post and a lantern."""
    cyl("dark", (0, 2.5, 0), 0.08, 5, 8, r1=0.06)
    cyl("dark", (0, 0.3, 0), 0.16, 0.6, 8)
    tube("dark", [(0, 4.8, 0), (0.4, 5.1, 0), (0.8, 5.0, 0)], 0.04, 5)
    cyl("dark", (0.8, 4.75, 0), 0.22, 0.12, 6, r1=0.05)
    cyl("lamp", (0.8, 4.45, 0), 0.16, 0.45, 6)
    cyl("snow", (0.8, 4.85, 0), 0.18, 0.06, 6)
    obj(name)


def lift(name):
    """A ski lift pylon: a steel mast, a crossbar with sheaves, a chair each way."""
    cyl("steel", (0, 7, 0), 0.35, 14, 10, r1=0.28)
    box("concrete", (0, 0.3, 0), (1.6, 0.6, 1.6), 0.03)
    box("steel", (0, 14.2, 0), (5.2, 0.5, 0.5), 0.03)
    for s in (-1, 1):
        for k in range(3 if not far() else 1):
            cyl("dark", (s * 2.3, 13.8, -0.4 + k * 0.4), 0.18, 0.12, 8, axis="x")
        box("dark", (s * 2.3, 13.95, 0), (0.06, 0.06, 40))
        tube("dark", [(s * 2.3, 13.9, 6 * s), (s * 2.3, 11.6, 6 * s)], 0.04, 4)
        box("canvas_r", (s * 2.3, 11.3, 6 * s), (1.4, 0.15, 0.6), 0.04)
        box("canvas_r", (s * 2.3, 11.75, 6 * s - 0.28 * s), (1.4, 0.8, 0.1), 0.04)
    # Ladder up the mast.
    if not far():
        for k in range(20):
            box("steel", (0, 1.0 + k * 0.6, 0.4), (0.5, 0.04, 0.04))
    obj(name)


def plough(name):
    """A parked snowplough: orange cab, a big blade, a salt hopper."""
    box("plough", (0, 1.9, 1.8), (2.4, 2.0, 2.2), 0.1)
    box("glass_car", (0, 2.4, 2.92), (2.1, 0.9, 0.05))
    box("dark", (0, 0.9, 0), (2.2, 0.5, 7.6), 0.04)
    box("plough", (0, 2.0, -1.6), (2.4, 2.0, 4.0), 0.08)
    box("snow", (0, 3.05, -1.6), (2.2, 0.12, 3.8), 0.05)
    plate("plough", [(-1.6, 1.6, 4.0), (1.6, 1.6, 4.4), (1.6, 0.2, 4.6), (-1.6, 0.2, 4.2)], 0.15)
    box("blink", (0.6, 3.0, 2.0), (0.3, 0.2, 0.3))
    box("blink", (-0.6, 3.0, 2.0), (0.3, 0.2, 0.3))
    for z in (2.0, -0.6, -2.4):
        for s in (-1, 1):
            wheel(s * 1.05, 0.55, z, 0.55, 0.4)
    obj(name)


# ── Vehicles ─────────────────────────────────────────────────────────────────
def car(name, body, rack=False, extra=None):
    car_shell(body, 4.5, 1.86, 0.66, -1.2, 1.2, body)
    if rack:
        # A roof box and skis on top.
        box("dark", (0, 1.95, -0.2), (0.8, 0.32, 1.9), 0.12)
        for s in (-1, 1):
            box("car_s", (s * 0.6, 1.79, 0), (0.05, 0.04, 2.0))
    if extra == "police":
        box("trim", (0, 1.8, 0), (1.3, 0.12, 0.3), 0.04)
        box("neon_c", (-0.35, 1.9, 0), (0.5, 0.12, 0.26))
        box("neon_p", (0.35, 1.9, 0), (0.5, 0.12, 0.26))
        for s in (-1, 1):
            box("car_g", (s * 0.94, 0.75, 0.2), (0.02, 0.45, 1.9))
    obj(name)


def suv(name, body):
    car_shell(body, 4.8, 1.95, 0.85, -1.6, 1.3, body, nose=0.25, ride=0.42)
    box("dark", (0, 2.32, -0.3), (1.2, 0.08, 2.2), 0.02)
    box("canvas_r", (0, 2.5, -0.3), (0.5, 0.3, 1.8), 0.08)
    obj(name)


def postbus(name):
    """The yellow mountain post bus."""
    L, W = 11, 2.55
    box("post_y", (0, 1.75, 0), (W, 2.6, L), 0.18)
    box("glass_car", (0, 2.2, 0.3), (W + 0.02, 1.1, L - 2.0))
    box("glass_car", (0, 1.9, L / 2 - 0.05), (W - 0.3, 1.6, 0.06))
    box("sign_r", (0, 1.15, 0), (W + 0.03, 0.12, L - 0.4))
    box("screen", (0, 2.9, L / 2 + 0.01), (1.8, 0.3, 0.03))
    for s in (-1, 1):
        box("lamp", (s * 0.95, 0.75, L / 2 + 0.01), (0.4, 0.15, 0.03))
        box("tail", (s * 1.0, 0.9, -L / 2 - 0.01), (0.3, 0.4, 0.03))
        for z in (L / 2 - 2.3, -L / 2 + 2.6):
            wheel(s * (W / 2 - 0.15), 0.5, z, 0.5, 0.3)
    box("snow", (0, 3.1, -0.5), (W - 0.3, 0.12, L - 3), 0.05)
    obj(name)


def van(name):
    car_shell("car_w", 5.2, 2.0, 1.15, 0.6, 2.2, "car_w", nose=0.3)
    box("car_w", (0, 1.6, -0.9), (1.98, 1.6, 3.4), 0.12)
    box("canvas_b", (0, 1.45, -0.9), (2.0, 0.5, 3.0))
    obj(name)


# ── Build ────────────────────────────────────────────────────────────────────
def build():
    chalet("chalet_a", 11, 9, 2, "wood2", "shut_g", 3.4)
    chalet("chalet_b", 13, 10, 3, "plaster", "shut_r", 4.0)
    chalet("chalet_c", 10, 9, 2, "plaster2", "shut_g", 3.2)
    hotel("hotel", 28, 13, 5)
    chapel("chapel")
    shoprow("shops", 24, 9, ["plaster", "plaster2", "stone2", "plaster"])
    barn("barn")
    hut("hut")
    stand("stand", 34)
    pine(0, 0, 15, 1); obj("pine_tall")
    pine(0, 0, 10, 2); obj("pine_mid")
    pine(0, 0, 6, 3); obj("pine_small")
    pine(-2.0, -1.0, 13, 4); pine(2.2, -0.6, 10, 5); pine(0.2, 2.0, 8, 6); obj("pine_trio")
    rocks("rock_a", 3.6, 11)
    rocks("rock_b", 6.5, 12)
    fence("fence", 8)
    chevron("chevron_r", 1)
    chevron("chevron_l", -1)
    icesign("icesign")
    lamp("lamp")
    lift("lift")
    plough("plough")
    car("sedan_r", "car_r", rack=True)
    car("sedan_b", "car_b")
    car("sedan_w", "car_w", rack=True)
    suv("taxi", "car_g")
    car("police", "police", extra="police")
    van("van")
    postbus("bus")


build_both(build)
export()
