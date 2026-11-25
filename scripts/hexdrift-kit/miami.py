# The Miami kit: art deco hotels, condos and offices, shops, a parking
# garage, the beach (lifeguard huts, a beach bar, palms), the street
# (lamps, bus stops, billboards with screens, kiosks), the race (a covered
# grandstand), vehicles for traffic and the marina (yacht, sailboat, pier),
# and a helicopter to follow the race.
#   blender -b -P scripts/hexdrift-kit/miami.py -- out.glb
import math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from kit import *

reset()
palette({
    # Walls (pastels), trims and roofs.
    "pink": "#f6c3cf", "mint": "#bfe8d8", "cream": "#f7ecd0", "peach": "#ffcfae", "sky": "#c6defa", "lilac": "#dccdf2",
    "white": "#f4f2ec", "trim": "#2b2d36", "trimw": "#ffffff", "concrete": "#b9b5ad", "conc2": "#8f8b84", "roof": "#7a7570",
    "tile": "#d98a5f", "wood": "#9b6b43", "wood2": "#c4935f", "deck": "#b88c5e", "steel": "#8d939e", "dark": "#22242c",
    "canvas_r": "#e2475f", "canvas_w": "#f5f1e8", "canvas_t": "#2fb7c4", "canvas_y": "#f4c233", "rail": "#e9eef2",
    "trunk": "#8a6a48", "trunk2": "#a2825c", "leaf": "#3f9046", "leaf2": "#57a84e", "husk": "#6b5236", "coconut": "#4e3a24",
    "bush": "#3d7f3f", "flower": "#ff5d9e", "sand": "#e8d2a2", "water": "#3fb6c6",
    "red": "#d63a3a", "yellow": "#f2c230", "blue": "#2f6fd6", "orange": "#ff8a2a",
    # Cars.
    "car_w": "#eef0f2", "car_k": "#1d2027", "car_r": "#c02a36", "car_b": "#2d5fbf", "car_s": "#9aa1ab", "taxi": "#f5c518",
    "bus": "#f4f4f0", "bus_s": "#ff4fa3", "police": "#f2f4f8", "tyre": "#151517", "rim": "#b9bec6", "tail": "#9a1020",
    # Special looks (the game knows these names).
    "glass": "#5b7d99", "glass_d": "#33485e", "glass_car": "#1c2633", "lamp": "#fff4d6",
    "neon_p": "#ff3da6", "neon_c": "#2ee6ff", "neon_y": "#ffd23d", "neon_g": "#5dff8a", "screen": "#202838",
})


def deco_hotel(name, w, d, floors, wall, accent, neon, fin=True):
    """Art deco: rounded corners, eyebrow ledges over the windows, a stepped
    parapet, a vertical sign fin, a terrace with an awning at street level."""
    fh = 3.3
    H = 4.4 + floors * fh
    foot = rounded(w, d, 2.2)
    prism(wall, foot, 0, H, 0.05)
    prism("trimw", grow(foot, 0.12), 0, 0.5)
    prism("trimw", grow(foot, 0.22), H - 0.2, H + 0.4)
    # Stepped parapet in the middle of the front.
    for k, (ww, hh) in enumerate(((w * 0.5, 1.6), (w * 0.3, 3.0), (w * 0.12, 4.4))):
        box(wall if k % 2 == 0 else accent, (0, H + hh / 2, d / 2 - 1.2 - k * 0.4), (ww, hh, 2.4), 0.05)
    box("neon_c", (0, H + 1.65, d / 2 - 0.04), (w * 0.5, 0.12, 0.05))
    for (P, width) in box_walls(w - 4.4, d - 4.4)[:4]:
        pass
    # Windows with eyebrows on the flat parts of each side.
    walls = [
        (wall_frame((-w / 2 + 2.2, 0, d / 2), (1, 0, 0), (0, 0, 1)), w - 4.4),
        (wall_frame((w / 2, 0, d / 2 - 2.2), (0, 0, -1), (1, 0, 0)), d - 4.4),
        (wall_frame((w / 2 - 2.2, 0, -d / 2), (-1, 0, 0), (0, 0, -1)), w - 4.4),
        (wall_frame((-w / 2, 0, -d / 2 + 2.2), (0, 0, 1), (-1, 0, 0)), d - 4.4),
    ]
    for i, (P, width) in enumerate(walls):
        windows(P, width, 4.4, H - 0.4, floor=fh, win=1.3, gap=0.8, sill=0.8, wh=1.7, frame="trimw", margin=0.4)
        for f in range(floors):
            slab(accent, P, 0.1, width - 0.1, 4.4 + f * fh + 2.62, 4.4 + f * fh + 2.78, 0.0, 0.55)  # eyebrow
    # Round corner windows (porthole bands).
    for sx in (-1, 1):
        for sz in (-1, 1):
            for f in range(floors):
                y = 4.4 + f * fh + 1.6
                a = math.atan2(sz, sx)
                cx, cz = sx * (w / 2 - 2.2), sz * (d / 2 - 2.2)
                for k in (-1, 0, 1):
                    aa = a + k * 0.38
                    p = (cx + math.cos(aa) * 2.23, y, cz + math.sin(aa) * 2.23)
                    cyl("glass", p, 0.42, 0.06, 10, axis="x" if abs(math.cos(aa)) > 0.7 else "z")
    # Street level: big shop windows, a terrace, a striped awning, columns.
    P, width = walls[0]
    slab("glass_d", P, 0.6, width - 0.6, 0.5, 3.4, 0.0, 0.14)
    for k in range(5):
        x = 0.4 + k * (width - 0.8) / 4
        slab("trimw", P, x - 0.18, x + 0.18, 0.5, 3.6, 0.0, 0.3)
    awning("canvas_w", P, 0.2, width - 0.2, 4.0, 2.6, 0.7, stripes=accent if accent.startswith("canvas") else "canvas_t")
    box("deck", (0, 0.25, d / 2 + 2.6), (w - 3, 0.5, 4.4), 0.04)
    for k in range(4):
        x = -w / 2 + 3.5 + k * (w - 7) / 3
        cyl("trimw", (x, 0.9, d / 2 + 3.4), 0.45, 0.06, 10)
        cyl("steel", (x, 0.7, d / 2 + 3.4), 0.05, 0.4, 6)
        cyl(accent if accent.startswith("canvas") else "canvas_t", (x, 2.5, d / 2 + 3.4), 1.3, 0.5, 10, r1=0.05)
        cyl("steel", (x, 1.6, d / 2 + 3.4), 0.03, 2.0, 5)
    # Sign fin with neon letters (bars) up the corner.
    if fin:
        fx = w / 2 - 3.0
        box(accent, (fx, H - 3, d / 2 + 0.9), (0.4, 9, 1.8), 0.05)
        for k in range(6):
            box(neon, (fx + 0.23, H - 7 + k * 1.4, d / 2 + 0.9), (0.06, 0.9, 1.2))
            box(neon, (fx - 0.23, H - 7 + k * 1.4, d / 2 + 0.9), (0.06, 0.9, 1.2))
    # Rooftop: water tank and AC units.
    cyl("conc2", (-w / 4, H + 1.4, -d / 4), 1.1, 2.2, 10)
    for k in range(3):
        box("steel", (w / 5 + k * 1.6, H + 0.5, -d / 4), (1.2, 0.8, 1.2), 0.04)
    obj(name)


def condo(name, w, d, floors, wall):
    """A beach condo tower: curved balconies on every floor, glass behind,
    a crown with a neon band, a podium with a lobby canopy."""
    fh = 3.2
    H = 6 + floors * fh
    core = rounded(w - 3, d - 3, 4)
    prism("glass", core, 6, H, 0)
    prism(wall, rounded(w, d, 5), 0, 6, 0.06)
    prism("glass_d", rounded(w - 1, d - 1, 4.5), 0.4, 5.4)
    for f in range(floors):
        y = 6 + f * fh
        prism(wall, rounded(w, d + (1.2 if f % 2 else 0.4), 5), y, y + 0.32, 0.05)
        if not far():
            prism("rail", rounded(w + 0.04, d + (1.24 if f % 2 else 0.44), 5), y + 0.32, y + 1.2, 0)
            prism("glass", rounded(w - 0.2, d + (1.0 if f % 2 else 0.2), 5), y + 0.32, y + 1.12, 0)
    # Fins between apartments.
    for k in range(-2, 3):
        box(wall, (k * w / 5.2, (6 + H) / 2, d / 2 - 0.6), (0.35, H - 6, 2.0))
        box(wall, (k * w / 5.2, (6 + H) / 2, -d / 2 + 0.6), (0.35, H - 6, 2.0))
    prism(wall, rounded(w - 2, d - 2, 4), H, H + 4, 0.06)
    prism("neon_c", rounded(w - 1.96, d - 1.96, 4), H + 2.2, H + 2.5)
    box("steel", (0, H + 5.5, 0), (w * 0.3, 3, d * 0.3), 0.05)
    # Lobby canopy and planters.
    box("trimw", (0, 5.2, d / 2 + 3), (w * 0.5, 0.4, 6), 0.1)
    for s in (-1, 1):
        cyl("trimw", (s * w * 0.22, 2.6, d / 2 + 5.5), 0.25, 5.2, 10)
        box("concrete", (s * w * 0.38, 0.4, d / 2 + 1.5), (4, 0.8, 1.6), 0.05)
        bush((s * w * 0.38, 0.7, d / 2 + 1.5), 0.9, "bush", 4, s)
    sign("neon_p", wall_frame((-w * 0.15, 0, d / 2 + 6.02), (1, 0, 0), (0, 0, 1)), 0, w * 0.3, 5.45, 6.1, 0.05)
    obj(name)


def office(name, w, d, floors):
    """A glass office tower: mullions, setbacks, a lit crown and a video screen."""
    fh = 3.8
    H = 5 + floors * fh
    prism("concrete", rounded(w + 2, d + 2, 1), 0, 5, 0.05)
    prism("glass_d", rounded(w + 1.6, d + 1.6, 1), 0.3, 4.6)
    top = H * 0.72
    for (y0, y1, ww, dd) in ((5, top, w, d), (top, H, w - 4, d - 4)):
        prism("glass_d", rounded(ww, dd, 0.6), y0, y1, 0)
        for (P, width) in box_walls(ww, dd):
            n = int(width / 2.6)
            for k in range(1, n):
                slab("steel", P, k * width / n - 0.08, k * width / n + 0.08, y0, y1, 0.0, 0.25)
            fl = int((y1 - y0) / fh)
            for f in range(fl + 1):
                slab("steel", P, 0, width, y0 + f * fh - 0.1, y0 + f * fh + 0.1, 0.0, 0.18)
    box("trim", (0, H + 1, 0), (w - 3, 2, d - 3), 0.05)
    prism("neon_y", rounded(w - 3.96, d - 3.96, 0.5), H - 0.6, H - 0.3)
    cyl("steel", (0, H + 7, 0), 0.25, 12, 6)
    ball("neon_p", (0, H + 13.2, 0), 0.35, 1)
    # Big screen on the front, over the podium.
    P = wall_frame((-w * 0.35, 0, d / 2 + 0.3), (1, 0, 0), (0, 0, 1))
    slab("trim", P, -0.3, w * 0.7 + 0.3, 6.5, 16.3, -0.3, 0.2)
    quad("screen", P(0, 6.8, 0.21), P(w * 0.7, 6.8, 0.21), P(w * 0.7, 16, 0.21), P(0, 16, 0.21))
    obj(name)


def shops(name, w, d, colors):
    """A row of two-storey shops: big windows, awnings, signs, a flat roof with rails."""
    n = len(colors)
    u = w / n
    for k, c in enumerate(colors):
        x0 = -w / 2 + k * u
        hgt = 7 + (k % 2) * 1.2
        box(c, (x0 + u / 2, hgt / 2, 0), (u - 0.05, hgt, d), 0.04)
        box("trimw", (x0 + u / 2, hgt + 0.2, 0), (u, 0.4, d + 0.3), 0.03)
        P = wall_frame((x0, 0, d / 2), (1, 0, 0), (0, 0, 1))
        slab("glass_d", P, 0.5, u - 0.5, 0.3, 3.0, 0.0, 0.14)
        slab("trim", P, 0.4, u - 0.4, 0.0, 0.3, 0.0, 0.12)
        windows(P, u, 3.6, 7, floor=3.4, win=1.4, gap=0.8, sill=0.7, wh=1.6, frame="trimw", margin=0.5)
        stripes = ["canvas_r", "canvas_t", "canvas_y", "canvas_r"][k % 4]
        awning("canvas_w", P, 0.3, u - 0.3, 3.4, 1.8, 0.5, stripes=stripes)
        sign(["neon_p", "neon_c", "neon_y", "neon_g"][k % 4], P, u * 0.2, u * 0.8, 4.3 if hgt < 7.5 else 4.4, 4.0 + 0.75 if hgt < 7.5 else 5.1, 0.12)
        # AC units and a sign on the side.
        box("steel", (x0 + u * 0.3, hgt + 0.9, -d * 0.2), (1.2, 1.0, 1.0), 0.04)
    obj(name)


def garage(name, w, d, levels):
    """An open parking garage: slabs on columns, a ramp, cars parked inside, lit signs."""
    lh = 3.2
    for l in range(levels + 1):
        y = l * lh
        box("concrete", (0, y + 0.15, 0), (w, 0.3, d), 0.03)
        if l > 0:
            for s in (-1, 1):
                box("conc2", (0, y + 0.75, s * (d / 2 - 0.1)), (w, 0.9, 0.2), 0.02)
                box("conc2", (s * (w / 2 - 0.1), y + 0.75, 0), (0.2, 0.9, d), 0.02)
            # Strip lights under each slab.
            for k in range(3):
                box("lamp", (-w / 3 + k * w / 3, y - 0.02, 0), (5, 0.06, 0.25))
    for i in range(6):
        for j in range(4):
            box("concrete", (-w / 2 + 1 + i * (w - 2) / 5, levels * lh / 2, -d / 2 + 1 + j * (d - 2) / 3), (0.6, levels * lh, 0.6))
    box("conc2", (w / 2 + 2, levels * lh / 2 + 1, 0), (4, levels * lh + 2, 6), 0.05)
    sign("neon_c", wall_frame((w / 2, 0, d / 2 + 0.05), (-1, 0, 0), (0, 0, 1)), 1, 7, levels * lh + 1.2, levels * lh + 2.6, 0.08)
    # A few cars on the top deck.
    for k, c in enumerate(("car_r", "car_w", "car_b", "car_k")):
        x = -w / 3 + k * w / 5
        box(c, (x, levels * lh + 0.95, -d / 4), (1.8, 0.7, 4.2), 0.15)
        box("glass_car", (x, levels * lh + 1.5, -d / 4 - 0.2), (1.5, 0.5, 2.0), 0.1)
    obj(name)


def lifeguard(name, a, b):
    """The famous lifeguard huts: a bright cabin on stilts, a ramp, a flag."""
    for x in (-1.2, 1.2):
        for z in (-1.2, 1.2):
            box("wood", (x, 1.25, z), (0.22, 2.5, 0.22))
    box("deck", (0, 2.55, 0.5), (3.6, 0.2, 4.2), 0.03)
    prism(a, rounded(3, 2.8, 0.8), 2.65, 4.9, 0.03)
    box(b, (0, 3.2, 0), (3.06, 0.35, 2.86))
    box(b, (0, 4.2, 0), (3.06, 0.2, 2.86))
    P = wall_frame((-1.5, 0, 1.42), (1, 0, 0), (0, 0, 1))
    slab("glass", P, 0.5, 2.5, 3.5, 4.4, 0.0, 0.1)
    prism(b, rounded(3.8, 3.6, 1), 4.9, 5.2, 0.05)
    cyl(a, (0, 5.5, 0), 1.2, 0.6, 12, r1=0.2)
    for x in (-1.7, 1.7):
        box("rail", (x, 3.1, 1.9), (0.06, 1.0, 1.0))
    box("rail", (0, 3.55, 2.55), (3.5, 0.06, 0.06))
    # Ramp down to the sand.
    import math as m
    ang = m.atan2(2.5, 4.5)
    box("deck", (0, 1.3, 4.6), (1.3, 0.15, 5.2), 0.02, 0)
    ob = last()
    ob.rotation_euler = (-ang, 0, 0)
    ob.location = G(0, 0, 0)
    bpy.context.view_layer.update()
    cyl("steel", (1.4, 6.3, -1.0), 0.04, 3, 5)
    box("red", (1.75, 7.3, -1.0), (0.7, 0.5, 0.03))
    obj(name)


def beachbar(name):
    """A tiki beach bar: deck, palm-thatch roof, bar counter, stools, lights."""
    box("deck", (0, 0.3, 0), (10, 0.6, 8), 0.03)
    for x in (-4.4, 4.4):
        for z in (-3.4, 3.4):
            cyl("wood", (x, 2.3, z), 0.16, 3.6, 7)
    prism("husk", [(-5.6, -4.6), (5.6, -4.6), (5.6, 4.6), (-5.6, 4.6)], 4.0, 4.2)
    bm_pts = [(-5.6, -4.6), (5.6, -4.6), (5.6, 4.6), (-5.6, 4.6)]
    cyl("husk", (0, 5.0, 0), 7.2, 1.8, 4, r1=0.3)
    last().rotation_euler = (0, 0, math.pi / 4)
    box("wood2", (0, 1.15, 1.5), (6, 1.1, 0.8), 0.04)
    box("wood", (0, 1.75, 1.5), (6.4, 0.1, 1.1), 0.02)
    for k in range(5):
        x = -2.4 + k * 1.2
        cyl("steel", (x, 0.95, 2.6), 0.04, 0.7, 5)
        cyl("canvas_r" if k % 2 else "canvas_t", (x, 1.32, 2.6), 0.22, 0.08, 8)
    for k in range(6):
        ball("lamp" if k % 2 else "neon_y", (-4.8 + k * 1.9, 3.9, 4.2), 0.14, 1)
    box("wood", (0, 2.5, -2.5), (6, 2.4, 0.3), 0.03)
    for k in range(5):
        cyl(["red", "yellow", "blue", "orange", "neon_g"][k], (-2 + k, 2.9, -2.3), 0.09, 0.5, 6)
    sign("neon_p", wall_frame((-2.0, 0, 4.62), (1, 0, 0), (0, 0, 1)), 0, 4, 3.4, 3.95, 0.06)
    obj(name)


def lamp2(name):
    """A double street light: tapered pole, two curved arms, lamp heads, a banner."""
    cyl("dark", (0, 4.5, 0), 0.1, 9, 8, r1=0.07)
    cyl("dark", (0, 0.4, 0), 0.2, 0.8, 8)
    for s in (-1, 1):
        tube("dark", [(0, 8.4, 0), (s * 0.6, 8.9, 0), (s * 1.5, 9.0, 0), (s * 2.1, 8.85, 0)], 0.05, 5)
        box("dark", (s * 2.1, 8.75, 0), (0.85, 0.18, 0.42), 0.04)
        box("lamp", (s * 2.1, 8.64, 0), (0.7, 0.04, 0.32))
    box("canvas_t", (0.35, 6.0, 0), (0.6, 1.6, 0.02))
    box("canvas_r", (-0.35, 6.0, 0), (0.6, 1.6, 0.02))
    obj(name)


def busstop(name):
    box("concrete", (0, 0.08, 0), (5.2, 0.16, 2.0), 0.02)
    for x in (-2.4, 2.4):
        box("steel", (x, 1.4, -0.7), (0.1, 2.6, 0.1))
    box("glass", (0, 1.4, -0.75), (4.8, 2.3, 0.04))
    box("steel", (0, 2.75, -0.1), (5.4, 0.12, 1.8), 0.03)
    box("wood2", (0, 0.55, -0.45), (3.0, 0.08, 0.45), 0.02)
    P = wall_frame((2.45, 0, -0.65), (0, 0, 1), (1, 0, 0))
    slab("trim", P, -0.2, 0.9, 0.3, 2.4, 0.0, 0.08)
    quad("screen", P(-0.1, 0.4, 0.09), P(0.8, 0.4, 0.09), P(0.8, 2.3, 0.09), P(-0.1, 2.3, 0.09))
    obj(name)


def billboard(name):
    """A big video billboard on two legs with a catwalk and spotlights."""
    for x in (-3.2, 3.2):
        cyl("steel", (x, 4.5, 0), 0.35, 9, 10)
    box("dark", (0, 12, 0), (12.6, 6.6, 0.5), 0.05)
    quad("screen", (-6, 9, 0.26), (6, 9, 0.26), (6, 15, 0.26), (-6, 15, 0.26))
    quad("screen", (6, 9, -0.26), (-6, 9, -0.26), (-6, 15, -0.26), (6, 15, -0.26))
    box("steel", (0, 8.6, 0.9), (12.4, 0.1, 1.2))
    box("steel", (0, 9.2, 1.45), (12.4, 0.05, 0.05))
    for k in range(4):
        x = -4.5 + k * 3
        box("dark", (x, 8.8, 1.3), (0.3, 0.3, 0.3))
        box("lamp", (x, 8.95, 1.3), (0.22, 0.03, 0.22))
    obj(name)


def kiosk(name):
    """A food truck with a hatch open, an awning, a menu board and a lit sign."""
    box("canvas_y", (0, 1.7, 0), (2.3, 2.4, 5.6), 0.15)
    box("trimw", (0, 0.65, 0), (2.36, 0.4, 5.62), 0.05)
    box("glass_car", (0, 2.1, 2.4), (2.1, 1.0, 0.9), 0.1)
    box("dark", (1.18, 1.9, -0.4), (0.04, 1.1, 2.8))
    quad("canvas_r", (1.17, 2.55, -1.8), (1.17, 2.55, 1.0), (2.2, 2.85, 1.0), (2.2, 2.85, -1.8))
    box("steel", (1.3, 1.3, -0.4), (0.3, 0.06, 2.8))
    sign("neon_p", wall_frame((1.2, 0, 1.2), (0, 0, -1), (1, 0, 0)), 0, 2.8, 3.0, 3.4, 0.03)
    for z in (1.6, -1.6):
        for s in (-1, 1):
            wheel(s * 1.05, 0.42, z, 0.42, 0.3)
    obj(name)


def stand(name, w):
    """A grandstand with a roof on columns, seat rows, sponsor screens and lights."""
    rows = 9
    for i in range(rows):
        y = 0.5 + i * 0.75
        z = 4.2 - i * 0.95
        box("concrete", (0, y / 2, z), (w, y, 0.95))
        box(["canvas_r", "canvas_w", "canvas_t"][i % 3], (0, y + 0.25, z + 0.15), (w - 0.6, 0.12, 0.45))
    box("conc2", (0, 3.6, -4.6), (w, 7.2, 0.4))
    for k in range(5):
        x = -w / 2 + 0.6 + k * (w - 1.2) / 4
        cyl("steel", (x, 6.2, -4.3), 0.2, 12.4, 8)
    quad("steel", (-w / 2 - 0.5, 12.3, -5.5), (w / 2 + 0.5, 12.3, -5.5), (w / 2 + 0.5, 11.4, 6.0), (-w / 2 - 0.5, 11.4, 6.0))
    quad("steel", (-w / 2 - 0.5, 12.3, -5.5), (-w / 2 - 0.5, 11.4, 6.0), (w / 2 + 0.5, 11.4, 6.0), (w / 2 + 0.5, 12.3, -5.5))
    box("dark", (0, 11.3, 6.0), (w + 1, 0.9, 0.2))
    for k in range(3):
        x = -w / 3 + k * w / 3
        quad("screen", (x - 4, 10.9, 6.11), (x + 4, 10.9, 6.11), (x + 4, 11.7, 6.11), (x - 4, 11.7, 6.11))
    box("dark", (0, 0.7, 5.0), (w, 1.4, 0.15))
    for k in range(int(w / 4)):
        quad("neon_p" if k % 2 else "neon_c", (-w / 2 + k * 4 + 0.3, 0.35, 5.08), (-w / 2 + k * 4 + 3.7, 0.35, 5.08), (-w / 2 + k * 4 + 3.7, 1.05, 5.08), (-w / 2 + k * 4 + 0.3, 1.05, 5.08))
    for x in (-w / 2 - 1, w / 2 + 1):
        cyl("steel", (x, 8, 5), 0.18, 16, 8)
        box("dark", (x, 16, 5.3), (2.2, 1.4, 0.4))
        box("lamp", (x, 16, 5.52), (2.0, 1.2, 0.03))
    obj(name)


def sedan(name, body, extra=None):
    car_shell(body, 4.5, 1.86, 0.62, -1.15, 1.25, body)
    if extra == "taxi":
        box("trim", (0, 1.76, 0.1), (0.9, 0.22, 0.35), 0.05)
        box("lamp", (0, 1.76, 0.28), (0.8, 0.16, 0.02))
        for s in (-1, 1):
            box("car_k", (s * 0.94, 0.8, 0), (0.02, 0.12, 3.6))
    if extra == "police":
        box("trim", (0, 1.74, 0), (1.3, 0.12, 0.3), 0.04)
        box("neon_c", (-0.35, 1.84, 0), (0.5, 0.12, 0.26))
        box("neon_p", (0.35, 1.84, 0), (0.5, 0.12, 0.26))
        for s in (-1, 1):
            box("car_k", (s * 0.94, 0.75, 0.2), (0.02, 0.45, 1.9))
    obj(name)


def van(name):
    car_shell("car_w", 5.2, 2.0, 1.15, 0.6, 2.2, "car_w", nose=0.3)
    box("car_w", (0, 1.6, -0.9), (1.98, 1.6, 3.4), 0.12)
    box("canvas_t", (0, 1.45, -0.9), (2.0, 0.5, 3.0))
    obj(name)


def bus(name):
    """A city bus: long body, a band of windows, a destination screen, wheels."""
    L, W = 12, 2.55
    box("bus", (0, 1.75, 0), (W, 2.6, L), 0.18)
    box("glass_car", (0, 2.2, 0.3), (W + 0.02, 1.1, L - 2.0))
    box("glass_car", (0, 1.9, L / 2 - 0.05), (W - 0.3, 1.6, 0.06))
    box("bus_s", (0, 1.15, 0), (W + 0.03, 0.35, L - 0.4))
    box("screen", (0, 2.9, L / 2 + 0.01), (1.8, 0.3, 0.03))
    for s in (-1, 1):
        box("lamp", (s * 0.95, 0.75, L / 2 + 0.01), (0.4, 0.15, 0.03))
        box("tail", (s * 1.0, 0.9, -L / 2 - 0.01), (0.3, 0.4, 0.03))
        for z in (L / 2 - 2.3, -L / 2 + 2.6):
            wheel(s * (W / 2 - 0.15), 0.5, z, 0.5, 0.3)
    box("steel", (0, 3.15, -1), (1.6, 0.3, 3), 0.08)
    obj(name)


def yacht(name):
    """A motor yacht: a sleek white hull, two decks of dark glass, rails, a radar mast."""
    L = 24
    side = [(-L / 2, 1.0), (-L / 2 + 1, -0.6), (L / 2 - 6, -0.9), (L / 2, 1.6), (L / 2 - 1, 2.3), (-L / 2, 2.0)]
    bm = bmesh.new()
    a = [bm.verts.new(G(-2.6, y, z)) for z, y in side]
    b = [bm.verts.new(G(2.6, y, z)) for z, y in side]
    m = [bm.verts.new(G(0, y - (0.5 if y < 1 else 0), z + (0.6 if z > 0 else 0))) for z, y in side]
    for i in range(len(side)):
        j = (i + 1) % len(side)
        bm.faces.new((a[i], a[j], m[j], m[i])); bm.faces.new((m[i], m[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bevel(link(bm, "white"), 0.08, 2)
    box("deck", (0, 2.05, -1), (4.6, 0.1, 18), 0.05)
    prism("white", rounded(4.2, 11, 1.5, cz=-1.5), 2.1, 4.0, 0.05)
    prism("glass_d", rounded(4.26, 10, 1.4, cz=-1.0), 2.6, 3.6)
    prism("white", rounded(3.4, 6.5, 1.2, cz=-2.5), 4.0, 5.6, 0.05)
    prism("glass_d", rounded(3.46, 5.5, 1.1, cz=-2.0), 4.4, 5.3)
    box("dark", (0, 1.1, 0), (5.25, 0.15, 20))
    cyl("steel", (0, 6.6, -3), 0.12, 2.2, 6)
    box("steel", (0, 7.6, -3), (1.6, 0.12, 0.2))
    obj(name)


def sailboat(name):
    L = 10
    side = [(-L / 2, 0.8), (-L / 2 + 1, -0.3), (L / 2 - 2, -0.4), (L / 2, 1.1)]
    bm = bmesh.new()
    a = [bm.verts.new(G(-1.6, y, z)) for z, y in side]
    b = [bm.verts.new(G(1.6, y, z)) for z, y in side]
    m = [bm.verts.new(G(0, y - 0.6, z)) for z, y in side]
    for i in range(len(side) - 1):
        bm.faces.new((a[i], a[i + 1], m[i + 1], m[i])); bm.faces.new((m[i], m[i + 1], b[i + 1], b[i]))
    bm.faces.new((a[0], m[0], b[0])); bm.faces.new((a[-1], b[-1], m[-1]))
    bm.faces.new(list(reversed(a)) + b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    link(bm, "white")
    box("deck", (0, 0.95, 0), (3.0, 0.08, 9.0))
    cyl("steel", (0, 7.5, 0.8), 0.08, 13, 6)
    quad("canvas_w", (0, 1.8, 0.7), (0, 13.6, 0.75), (0, 1.8, -3.8), (0, 1.8, 0.7))
    quad("canvas_w", (0, 1.8, 0.7), (0, 1.8, -3.8), (0, 13.6, 0.75), (0, 1.8, 0.7))
    quad("canvas_t", (0, 1.4, 1.0), (0, 13.2, 0.9), (0, 1.4, 4.6), (0, 1.4, 1.0))
    quad("canvas_t", (0, 1.4, 1.0), (0, 1.4, 4.6), (0, 13.2, 0.9), (0, 1.4, 1.0))
    obj(name)


def pier(name, L):
    """A wooden pier on piles with lamps along it and a hut at the end."""
    box("deck", (0, 2.0, L / 2), (4, 0.25, L), 0.02)
    for k in range(int(L / 4) + 1):
        for x in (-1.8, 1.8):
            cyl("wood", (x, 0.2, k * 4), 0.15, 4, 6)
        if k % 2 == 0:
            for x in (-1.9, 1.9):
                box("wood2", (x, 2.6, k * 4), (0.08, 1.0, 0.08))
    for x in (-1.9, 1.9):
        box("wood2", (x, 3.05, L / 2), (0.08, 0.08, L))
    for k in range(int(L / 12)):
        cyl("dark", (1.9, 3.6, 6 + k * 12), 0.05, 3, 6)
        ball("lamp", (1.9, 5.2, 6 + k * 12), 0.18, 1)
    prism("mint", rounded(5, 5, 0.6, cz=L - 2.5), 2.1, 5.0, 0.04)
    cyl("tile", (0, 6.2, L - 2.5), 3.9, 2.4, 4, r1=0.1)
    obj(name)


def heli(name):
    """A news helicopter (it follows the race)."""
    ball("car_w", (0, 0, 0.4), 1.25, 2, 0.85)
    ball("glass_car", (0, 0.15, 1.1), 0.95, 2, 0.75)
    tube("car_w", [(0, 0.2, -0.6), (0, 0.45, -3.5), (0, 0.7, -6.0)], 0.32, 8)
    box("bus_s", (0, 1.4, -6.0), (0.1, 1.4, 0.8), 0.05)
    box("car_w", (0, 0.75, -6.0), (1.6, 0.1, 0.5), 0.03)
    for s in (-1, 1):
        tube("steel", [(s * 0.9, -1.25, 1.6), (s * 0.95, -1.3, -1.4)], 0.06, 5)
        box("steel", (s * 0.8, -0.9, 0.4), (0.06, 0.7, 0.06))
    cyl("dark", (0, 1.3, 0.3), 0.15, 0.5, 6)
    box("dark", (0, 1.58, 0.3), (10.5, 0.04, 0.3))
    box("dark", (0, 1.6, 0.3), (0.3, 0.04, 10.5))
    ball("neon_p", (0, -0.9, 0.2), 0.12, 1)
    obj(name)


def planter(name):
    """A sidewalk planter: a concrete box with a hedge and flowers."""
    box("concrete", (0, 0.4, 0), (4, 0.8, 1.2), 0.06)
    for k in range(5):
        ball("bush", (-1.6 + k * 0.8, 1.0, 0), 0.55, 1, 0.8)
    for k in range(6):
        ball("flower", (-1.7 + k * 0.68, 1.35, (k % 2 - 0.5) * 0.4), 0.14, 1)
    obj(name)


# ── Build ────────────────────────────────────────────────────────────────────
def build():
    deco_hotel("deco_a", 16, 12, 4, "pink", "canvas_t", "neon_p")
    deco_hotel("deco_b", 13, 10, 3, "mint", "canvas_r", "neon_c")
    deco_hotel("deco_c", 18, 12, 5, "cream", "canvas_y", "neon_y")
    deco_hotel("deco_d", 14, 11, 3, "sky", "canvas_r", "neon_p")
    condo("condo_a", 24, 17, 18, "white")
    condo("condo_b", 22, 15, 24, "peach")
    office("office_a", 20, 20, 20)
    shops("shops_a", 28, 10, ["pink", "mint", "cream", "sky"])
    shops("shops_b", 24, 10, ["lilac", "peach", "white"])
    garage("garage", 34, 24, 3)
    lifeguard("guard_a", "pink", "canvas_t")
    lifeguard("guard_b", "canvas_y", "canvas_r")
    beachbar("beachbar")
    palm(12, 0.28, 10, seed=1); obj("palm_tall")
    palm(8.5, 0.16, 9, seed=3); obj("palm_mid")
    palm(10, 0.35, 8, seed=5); palm(7, -0.2, 8, seed=7); obj("palm_pair")
    lamp2("lamp2")
    busstop("busstop")
    billboard("billboard")
    kiosk("foodtruck")
    stand("stand", 34)
    sedan("sedan_r", "car_r")
    sedan("sedan_b", "car_b")
    sedan("sedan_w", "car_w")
    sedan("taxi", "taxi", "taxi")
    sedan("police", "police", "police")
    van("van")
    bus("bus")
    yacht("yacht")
    sailboat("sailboat")
    pier("pier", 60)
    heli("heli")
    planter("planter")


build_both(build)
export()
