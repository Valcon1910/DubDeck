# The Space kit: a race through an orbital shipyard. Everything near the road
# hovers on thruster decks (there is no ground): nav beacons, solar arrays,
# comm dishes, cargo pods, hangar docks, habitat modules, a control spire, a
# grandstand and chevron boards. Out in the open (drawn only): asteroids,
# satellites, freighters and a ring station.
#   blender -b -P scripts/hexdrift-kit/space.py -- out.glb
import math, os, sys, random
sys.path.insert(0, os.path.dirname(__file__))
from kit import *

reset()
palette({
    # Hulls and structure.
    "hull": "#d9dde6", "hull2": "#aab1c0", "hull3": "#7c8496", "deck": "#3a3f52", "truss": "#5c6378", "dark": "#1b1d26",
    "orange": "#ff8a2a", "yellow": "#ffd23d", "red": "#e0364a", "blue": "#3a6bff", "panel": "#1f3a8a", "panel2": "#2c56c4",
    "gold": "#e8b84a", "trimw": "#ffffff", "cont_a": "#e05a2a", "cont_b": "#2a8ae0", "cont_c": "#e0c02a", "cont_d": "#6a7a8a",
    # Rock and the far things.
    "rock": "#5b5468", "rock2": "#7a7088", "rock3": "#433d50", "ice": "#bfe4ff",
    "canvas_r": "#e2475f", "canvas_w": "#f2f4fa", "seat_a": "#3a6bff", "seat_b": "#ff3df2", "seat_c": "#7cf7ff", "seat_d": "#ffd23d",
    # Special looks (the game knows these names).
    "glass": "#7fb2d9", "glass_d": "#3a5878", "glass_car": "#1c2633", "lamp": "#fff4d6", "screen": "#202838",
    "neon_c": "#7af0ff", "neon_p": "#ff8af0", "blink": "#ff4a3a", "arrow": "#7af0ff", "arrowl": "#7af0ff",
})


def hover(w, d, thrusters=True):
    """The thruster deck everything near the road floats on (top at y 0.3)."""
    box("deck", (0, 0.0, 0), (w, 0.6, d), 0.08 if not far() else 0)
    box("hull3", (0, -0.55, 0), (w * 0.8, 0.5, d * 0.8))
    if thrusters:
        for sx in (-1, 1):
            for sz in (-1, 1):
                x, z = sx * w * 0.3, sz * d * 0.3
                cyl("dark", (x, -1.0, z), 0.5, 0.5, 8)
                cyl("neon_c", (x, -1.3, z), 0.38, 0.12, 8)
    if not far():
        # Hazard edge along the front.
        for k in range(int(w / 1.2)):
            box("yellow" if k % 2 else "dark", (-w / 2 + 0.6 + k * 1.2, 0.31, d / 2 - 0.15), (1.2, 0.04, 0.3))


def beacon(name):
    """A nav beacon on a small hover pad: a slim pylon, a glowing ring and a blinking tip."""
    hover(1.6, 1.6, thrusters=False)
    cyl("neon_c", (0, -0.9, 0), 0.5, 0.15, 8)
    cyl("hull2", (0, 2.2, 0), 0.12, 4, 6)
    cyl("neon_p", (0, 3.0, 0), 0.4, 0.12, 10)
    cyl("hull", (0, 4.3, 0), 0.22, 0.4, 6, r1=0.1)
    ball("blink", (0, 4.6, 0), 0.16, 1)
    obj(name)


def solar(name):
    """A solar array: a truss boom with two wide panels, tilted to the sun."""
    hover(4, 3)
    box("truss", (0, 2.5, 0), (0.5, 4.4, 0.5))
    box("hull2", (0, 4.8, 0), (1.4, 1.0, 1.4), 0.05)
    for s in (-1, 1):
        box("truss", (s * 5.5, 4.8, 0), (9, 0.2, 0.2))
        for k in range(3 if not far() else 1):
            n = 3 if not far() else 1
            w = 8.4 / n
            x = s * (1.4 + w / 2 + k * w)
            box("panel" if (k % 2 == 0) else "panel2", (x, 4.8, 0), (w - 0.12, 2.8, 0.08), yaw=0, bv=0)
        if not far():
            for k in range(5):
                box("hull3", (s * (1.4 + k * 2.1), 4.8, 0.06), (0.06, 2.8, 0.04))
    obj(name)


def dish(name):
    """A comm dish on a lattice mast, aimed up and out."""
    hover(4, 4)
    for sx in (-1, 1):
        for sz in (-1, 1):
            tube("truss", [(sx * 1.4, 0.3, sz * 1.4), (sx * 0.4, 7, sz * 0.4)], 0.12, 4)
    if not far():
        for y in (2.2, 4.4):
            k = 1.4 - (y - 0.3) / 6.7 * 1.0
            for (a, b) in (((-k, -k), (k, -k)), ((k, -k), (k, k)), ((k, k), (-k, k)), ((-k, k), (-k, -k))):
                tube("truss", [(a[0], y, a[1]), (b[0], y, b[1])], 0.06, 4)
    box("hull2", (0, 7.3, 0), (1.4, 0.8, 1.4), 0.05)
    # The dish: a shallow cone opening up and toward the road.
    cyl("hull", (0, 9.2, 0.6), 4.2, 1.6, 16, r1=4.6 if far() else 4.8)
    cyl("hull3", (0, 8.4, 0.5), 1.2, 0.8, 10, r1=4.2)
    tube("truss", [(0, 9, 0.6), (0, 12.2, 0.9)], 0.08, 4)
    ball("neon_p", (0, 12.3, 0.9), 0.3, 1)
    obj(name)


def pods(name):
    """Cargo containers stacked on a pallet, strapped down."""
    hover(7, 3.4)
    cols = ["cont_a", "cont_b", "cont_c", "cont_d", "cont_b"]
    rnd = random.Random(3)
    for lv in range(2):
        for k in range(2 - lv):
            x = -1.6 + k * 3.2 + lv * 1.6
            c = cols[(k + lv * 2) % 5]
            box(c, (x, 0.3 + 1.3 + lv * 2.6, 0), (3.0, 2.5, 3.0), 0.06 if not far() else 0)
            if not far():
                for r in range(5):
                    box("dark", (x - 1.2 + r * 0.6, 0.3 + 1.3 + lv * 2.6, 1.52), (0.08, 2.3, 0.04))
                box("trimw", (x, 0.3 + 2.2 + lv * 2.6, 1.53), (1.6, 0.35, 0.02))
    obj(name)


def dock(name):
    """A hangar dock: a broad module with a lit bay door, a screen and neon trim."""
    W, H, D = 20, 11, 12
    hover(W + 2, D + 2)
    box("hull", (0, 0.3 + H / 2, 0), (W, H, D), 0.25 if not far() else 0)
    box("hull2", (0, 0.3 + H + 0.6, -1), (W - 3, 1.2, D - 3), 0.1 if not far() else 0)
    # The bay door, lit from inside.
    box("dark", (0, 0.3 + 3.6, D / 2 + 0.02), (10, 7.2, 0.1))
    box("glass_d", (0, 0.3 + 3.6, D / 2 + 0.05), (9.2, 6.6, 0.05))
    if not far():
        for k in range(5):
            box("hull3", (-3.6 + k * 1.8, 0.3 + 3.6, D / 2 + 0.08), (0.12, 6.6, 0.04))
    box("lamp", (0, 0.3 + 7.0, D / 2 + 0.09), (9.2, 0.18, 0.05))
    box("orange", (0, 0.3 + 7.6, D / 2 + 0.1), (11, 0.5, 0.25))
    for s in (-1, 1):
        box("yellow", (s * 5.4, 0.3 + 3.6, D / 2 + 0.1), (0.5, 7.2, 0.25))
        box("neon_c", (s * (W / 2 + 0.05), 0.3 + H / 2, D / 2 - 0.5), (0.12, H - 1, 0.12))
    box("neon_p", (0, 0.3 + H + 0.05, D / 2 + 0.05), (W, 0.14, 0.14))
    box("screen", (W / 2 - 3.5, 0.3 + 8.8, D / 2 + 0.06), (4.4, 2.4, 0.05))
    box("screen", (-W / 2 + 3.5, 0.3 + 8.8, D / 2 + 0.06), (4.4, 2.4, 0.05))
    if not far():
        for s in (-1, 1):
            for k in range(3):
                box("glass", (s * (W / 2 - 1.5 - k * 1.4), 0.3 + 5.0, D / 2 + 0.03), (0.9, 1.2, 0.04))
        cyl("hull3", (W / 2 - 3, 0.3 + H + 1.9, -2), 0.25, 2.4, 6)
        ball("blink", (W / 2 - 3, 0.3 + H + 3.2, -2), 0.25, 1)
    obj(name)


def hab(name):
    """A habitat module: a long pressurised can with window rows, on struts."""
    L, R = 16, 3.2
    hover(L + 1, 6)
    for s in (-1, 1):
        box("truss", (s * L * 0.3, 1.6, 0), (0.5, 2.6, 0.5))
    cyl("hull", (0, 2.9 + R, 0), R, L, 16, axis="x")
    for s in (-1, 1):
        cyl("hull2", (s * (L / 2 + 0.4), 2.9 + R, 0), R * 0.8, 0.8, 16, r1=R * 0.5 if s > 0 else None, axis="x")
        if s < 0:
            cyl("hull2", (s * (L / 2 + 0.4), 2.9 + R, 0), R * 0.5, 0.8, 16, r1=R * 0.8, axis="x")
    for k in range(4):
        cyl("hull3", (-L / 2 + 2 + k * (L - 4) / 3, 2.9 + R, 0), R + 0.08, 0.35, 16, axis="x")
    # Window band facing the road.
    n = 8 if not far() else 1
    if far():
        box("glass", (0, 2.9 + R + 0.4, R - 0.15), (L - 3, 1.0, 0.4))
    else:
        for k in range(n):
            box("glass", (-L / 2 + 2.4 + k * (L - 4.8) / (n - 1), 2.9 + R + 0.4, R - 0.12), (1.1, 1.0, 0.35))
    box("neon_c", (0, 2.9 + 2 * R + 0.02, 0), (L - 2, 0.1, 0.3))
    obj(name)


def spire(name):
    """The control spire: a tall mast with a lit control deck, aerials and beacons."""
    hover(6, 6)
    cyl("hull2", (0, 1.8, 0), 2.6, 3, 8, r1=1.6)
    cyl("hull", (0, 14, 0), 1.6, 22, 8, r1=1.1)
    for y in (8, 14, 20):
        cyl("hull3", (0, y, 0), 1.75 - (y - 3) * 0.022, 0.5, 8)
    # Control deck.
    cyl("hull", (0, 27, 0), 2.8, 2.0, 12, r1=4.2)
    cyl("glass", (0, 29, 0), 4.2, 2.0, 12, r1=4.4)
    cyl("hull", (0, 30.5, 0), 4.6, 1.0, 12, r1=2.0)
    cyl("neon_p", (0, 28, 0), 4.3, 0.2, 12)
    cyl("hull2", (0, 34, 0), 0.25, 6, 6, r1=0.1)
    ball("blink", (0, 37.1, 0), 0.35, 1)
    if not far():
        for k in range(3):
            a = k * 2.1
            tube("hull3", [(math.cos(a) * 2, 31, math.sin(a) * 2), (math.cos(a) * 2.6, 34.5, math.sin(a) * 2.6)], 0.07, 4)
            ball("blink", (math.cos(a) * 2.6, 34.6, math.sin(a) * 2.6), 0.15, 1)
    obj(name)


def stand(name, w):
    """A grandstand on a long hover deck, canopy and fans."""
    d, rows = 8, 7
    hover(w + 1, d + 1)
    for r in range(rows):
        y = 0.5 + r * 0.6
        box("hull2" if r % 2 else "hull", (0, 0.3 + y / 2, d / 2 - 1.0 - r * 0.95), (w, y, 0.95), 0.02 if not far() else 0)
    box("hull3", (0, 0.3 + 2.4, -d / 2 + 0.4), (w, 4.8, 0.4))
    for k in range(6):
        x = -w / 2 + 0.5 + k * (w - 1) / 5
        cyl("hull3", (x, 0.3 + 3.5, d / 2 - 0.4), 0.15, 7, 8)
    box("hull", (0, 0.3 + 7.2, 0.4), (w, 0.3, d + 0.6))
    box("neon_c", (0, 0.3 + 7.0, d / 2 + 0.7), (w, 0.14, 0.14))
    if not far():
        cols = ["seat_a", "seat_b", "seat_c", "seat_d", "canvas_w", "orange"]
        for r in range(rows):
            for k in range(int(w / 1.2)):
                if (k * 5 + r * 3) % 7 == 0: continue
                x = -w / 2 + 0.6 + k * 1.2
                y = 0.5 + r * 0.6
                z = d / 2 - 1.0 - r * 0.95
                box(cols[(k + r) % 6], (x, 0.3 + y + 0.42, z), (0.5, 0.6, 0.35), 0.04)
                ball("hull", (x, 0.3 + y + 0.9, z), 0.17, 1)
    obj(name)


def chevron(name, way):
    """A chevron board on a hover post (sequenced lamps)."""
    lamp = "arrow" if way > 0 else "arrowl"
    hover(2.6, 0.8, thrusters=False)
    cyl("neon_c", (0, -0.9, 0), 0.3, 0.12, 6)
    for s in (-1, 1):
        box("hull3", (s * 0.95, 1.2, -0.05), (0.12, 1.8, 0.12))
    box("dark", (0, 2.4, 0.0), (2.4, 1.0, 0.08), 0.02 if not far() else 0)
    box("neon_p", (0, 2.92, 0.0), (2.45, 0.05, 0.1))
    box("neon_p", (0, 1.88, 0.0), (2.45, 0.05, 0.1))
    if far():
        for c in (-0.72, 0.0, 0.72):
            box(lamp, ((c + 0.1) * way, 2.4, 0.06), (0.32, 0.6, 0.02))
        obj(name)
        return
    for c in (-0.72, 0.0, 0.72):
        for v in (-0.3, -0.15, 0.0, 0.15, 0.3):
            u = c + (0.3 - abs(v)) * 0.75
            x, y = u * way, 2.4 + v
            cyl("dark", (x, y, 0.05), 0.07, 0.03, 10, axis="z")
            cyl(lamp, (x, y, 0.065), 0.06, 0.02, 10, axis="z")
    obj(name)


# ── Open space (drawn only) ──────────────────────────────────────────────────
def asteroid(name, size, seed):
    """A lumpy rock: a squashed sphere with a few boulders stuck on."""
    rnd = random.Random(seed)
    ball("rock" if seed % 2 else "rock2", (0, 0, 0), size, 1 if far() else 2, 0.7 + rnd.random() * 0.25)
    for k in range(2 if far() else 6):
        a, b = rnd.random() * 6.28, (rnd.random() - 0.5) * 1.6
        r = size * (0.25 + rnd.random() * 0.25)
        c = (math.cos(a) * math.cos(b) * size * 0.8, math.sin(b) * size * 0.6, math.sin(a) * math.cos(b) * size * 0.8)
        ball("rock3" if k % 2 else "rock2", c, r, 1, 0.8)
    if seed == 3:
        ball("ice", (size * 0.3, size * 0.55, 0), size * 0.3, 1, 0.5)
    obj(name)


def satellite(name):
    """A small satellite: a gold box body, two panel wings, a dish."""
    box("gold", (0, 0, 0), (1.8, 1.8, 2.4), 0.05 if not far() else 0)
    for s in (-1, 1):
        box("truss", (s * 1.6, 0, 0), (1.4, 0.1, 0.1))
        box("panel2", (s * 4.2, 0, 0), (4.0, 0.06, 1.8))
    cyl("hull", (0, 1.4, 0.4), 0.2, 0.8, 10, r1=1.0)
    ball("blink", (0, -1.0, 0), 0.15, 1)
    obj(name)


def freighter(name):
    """A long cargo freighter: a spine of container racks, a bridge and glowing engines."""
    L = 70
    box("hull2", (0, 0, 0), (3, 3, L), 0.1 if not far() else 0)
    cols = ["cont_a", "cont_b", "cont_c", "cont_d"]
    n = 8
    for k in range(n):
        z = -L / 2 + 10 + k * (L - 22) / (n - 1)
        for (x, y) in ((-3.2, 0), (3.2, 0), (0, 3.2), (0, -3.2)) if not far() else ((0, 0),):
            if far():
                box(cols[k % 4], (0, 0, z), (9, 9, 5.2))
            else:
                box(cols[(k + int(x + y)) % 4], (x, y, z), (3.2, 3.2, 5.2), 0.05)
    box("hull", (0, 2, L / 2 - 4), (7, 7, 8), 0.2 if not far() else 0)
    box("glass", (0, 4, L / 2 + 0.05), (5, 1.2, 0.2))
    for s in (-1, 1):
        cyl("hull3", (s * 3, 0, -L / 2 - 1), 2, 4, 10, axis="z")
        cyl("neon_c", (s * 3, 0, -L / 2 - 3.1), 1.6, 0.3, 10, axis="z")
    box("blink", (0, 5.6, L / 2 - 4), (0.4, 0.4, 0.4))
    obj(name)


def ring(name):
    """A ring station: a wide wheel on four spokes round a hub, windows round the rim."""
    R, n = 60, 32 if not far() else 16
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        am = (a0 + a1) / 2
        L = 2 * R * math.sin(math.pi / n) + 0.4
        box("hull" if k % 4 else "hull2", (math.cos(am) * R, 0, math.sin(am) * R), (L, 7, 9), yaw=-am + math.pi / 2)
        if not far() and k % 2 == 0:
            box("glass", (math.cos(am) * (R + 4.55), 0.8, math.sin(am) * (R + 4.55)), (L * 0.7, 2.2, 0.2), yaw=-am + math.pi / 2)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        tube("truss", [(math.cos(a) * 6, 0, math.sin(a) * 6), (math.cos(a) * (R - 4), 0, math.sin(a) * (R - 4))], 1.2, 6)
    cyl("hull", (0, 0, 0), 8, 14, 12)
    cyl("neon_c", (0, 7.2, 0), 6, 0.6, 12)
    ball("blink", (0, 9, 0), 0.8, 1)
    obj(name)


# ── Build ────────────────────────────────────────────────────────────────────
def build():
    beacon("beacon")
    solar("solar")
    dish("dish")
    pods("pods")
    dock("dock")
    hab("hab")
    spire("spire")
    stand("stand", 30)
    chevron("chevron_r", 1)
    chevron("chevron_l", -1)
    asteroid("rock_a", 7, 1)
    asteroid("rock_b", 14, 2)
    asteroid("rock_c", 24, 3)
    satellite("satellite")
    freighter("freighter")
    ring("ring")


build_both(build)
export()
