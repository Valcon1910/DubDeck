# Furia body for Hexdrift (a cab-forward, mid-engine supercar), built in
# Blender (headless):
#   blender -b -P scripts/hexdrift-cars/furia.py -- out.glb
# Same conventions as coupe.py: game axes (x right, y up, z forward), the
# game adds wheels, wings, roof extras and exhaust tips.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from carkit import *

reset()

# ── The body: a wedge nose, the cabin pushed forward, wide rear haunches ──
# prof(yb, hw, ymid, ws, ybelt, wg, yg, ytop)
S = [
    (2.50, prof(0.30, 0.84, 0.40, 0.80, 0.52, 0.60, 0.555, 0.56)),
    (2.38, prof(0.26, 0.96, 0.42, 0.92, 0.63, 0.64, 0.655, 0.65)),
    (2.05, prof(0.24, 1.04, 0.45, 1.00, 0.78, 0.62, 0.74, 0.72)),
    # Front fenders crest over the wheels; the hood dips between them.
    (1.50, prof(0.24, 1.08, 0.47, 1.03, 0.90, 0.62, 0.82, 0.79)),
    (1.05, prof(0.24, 1.02, 0.46, 0.99, 0.86, 0.62, 0.87, 0.86)),
    # The cabin: a long raked screen, roof peak just ahead of the middle.
    (0.60, prof(0.24, 0.99, 0.45, 0.96, 0.82, 0.60, 1.05, 1.08)),
    (0.10, prof(0.24, 0.99, 0.45, 0.96, 0.81, 0.56, 1.15, 1.18)),
    (-0.45, prof(0.24, 1.01, 0.46, 0.98, 0.83, 0.58, 1.10, 1.12)),
    # Behind it the engine cover slopes away between the rear haunches.
    (-0.95, prof(0.24, 1.08, 0.48, 1.04, 0.93, 0.64, 1.00, 1.00)),
    (-1.40, prof(0.25, 1.13, 0.50, 1.07, 1.00, 0.68, 0.98, 0.95)),
    (-1.85, prof(0.26, 1.10, 0.51, 1.05, 0.99, 0.68, 0.96, 0.93)),
    (-2.20, prof(0.30, 1.02, 0.53, 0.98, 0.95, 0.66, 0.94, 0.93)),
    (-2.36, prof(0.36, 0.92, 0.55, 0.90, 0.93, 0.62, 0.94, 0.94)),
]
body = loft("Body", S, cap_front=2.56, cap_rear=-2.42, creases={4: 0.45, 3: 0.25, 2: 0.5, 5: 0.35, "ends": 0.5})
subdivide(body, 3)

for x, z, r in [(0.94, 1.5, 0.39), (0.96, -1.4, 0.44)]:
    for s in (1, -1):
        wheel_well(body, s * x, z, r + 0.065)
under_trim(body)
sharpen(body)

# ── Glass, cut into the body's own surface: a big wrap-around screen,
# small side windows, black roof, a louvred engine cover ──
side = curve([(0.92, 0.87), (0.58, 1.02), (0.12, 1.11), (-0.36, 1.07), (-0.60, 0.95), (-0.62, 0.87)], sharp=(0, 5))
region(body, "glass", side, "side", ring=0.028)
side_decal(body, "chrome", strip(curve([(0.94, 0.852), (0.2, 0.846), (-0.66, 0.852)], closed=False), 0.014), 0.008)
ws = curve([(-0.68, 0.90), (0.68, 0.90), (0.52, 1.12), (-0.52, 1.12)], per=8)
region(body, "glass", onto(body, ws, "front", "top"), "top", ring=0.02)
region(body, "gloss", curve([(-0.42, 0.62), (0.42, 0.62), (0.45, 0.1), (0.44, -0.40), (-0.44, -0.40), (-0.45, 0.1)], sharp=(0, 1, 3, 4)), "top")
rw = curve([(-0.42, -0.52), (0.42, -0.52), (0.46, -0.88), (-0.46, -0.88)], per=8)
region(body, "glass", rw, "top", ring=0.018)
cover = curve([(-0.48, -1.0), (0.48, -1.0), (0.51, -1.42), (0.50, -1.82), (-0.50, -1.82), (-0.51, -1.42)], sharp=(0, 1, 3, 4))
region(body, "trim", cover, "top", ring=0.02)
for i in range(7):
    z = -1.06 - i * 0.11
    # Raised blades (the black panel is drawn with a depth bias, so paint
    # laid flush on it would hide).
    top_decal(body, "paint", [(-0.46, z), (0.46, z), (0.47, z - 0.045), (-0.47, z - 0.045)], 0.022)

# ── Front: slim angular lights, a wide mouth ──
for s in (1, -1):
    m = lambda pts: [(s * x, y) for x, y in pts]
    front_decal(body, "trim", curve(m([(0.42, 0.585), (0.66, 0.60), (0.90, 0.64), (0.95, 0.60), (0.86, 0.555), (0.60, 0.545), (0.44, 0.55)]), sharp=(0,)), 0.004)
    front_decal(body, "lamp", curve(m([(0.50, 0.578), (0.68, 0.59), (0.88, 0.625), (0.90, 0.605), (0.84, 0.57), (0.62, 0.562), (0.51, 0.564)]), sharp=(0,)), 0.008)
    front_decal(body, "lamp", m([(0.66, 0.52), (0.84, 0.53), (0.80, 0.545), (0.66, 0.537)]), 0.008)
    # Corner intakes with an accent blade.
    front_decal(body, "trim", curve(m([(0.56, 0.30), (0.90, 0.32), (0.92, 0.48), (0.74, 0.50), (0.58, 0.42)])), 0.004)
    front_decal(body, "accent", strip([(s * 0.60, 0.38), (s * 0.90, 0.405)], 0.016), 0.008)
mouth = curve([(-0.46, 0.30), (0.46, 0.30), (0.44, 0.40), (0.38, 0.47), (-0.38, 0.47), (-0.44, 0.40)], sharp=(0, 1))
front_decal(body, "trim", mouth, 0.004)
for y in (0.35, 0.40):
    front_decal(body, "gloss", [(-0.42, y), (0.42, y), (0.42, y + 0.014), (-0.42, y + 0.014)], 0.008)
box("trim", (0, 0.245, 2.32), (1.7, 0.025, 0.26), bevel=0.008)
box("accent", (0, 0.245, 2.45), (1.66, 0.022, 0.02), bevel=0.004)

# ── Sides: deep intakes ahead of the rear wheels, skirts, short doors ──
intake = curve([(-0.24, 0.44), (-0.86, 0.42), (-0.90, 0.64), (-0.84, 0.84), (-0.46, 0.83)], sharp=(0, 1))
side_decal(body, "trim", intake, 0.004)
side_decal(body, "accent", strip([(-0.26, 0.45), (-0.48, 0.83)], 0.03), 0.007)
for k in range(4):
    y = 0.50 + k * 0.08
    side_decal(body, "gloss", [(-0.86, y), (-0.36 - k * 0.04, y), (-0.36 - k * 0.04, y + 0.02), (-0.86, y + 0.02)], 0.007)
side_decal(body, "trim", [(1.05, 0.27), (-0.92, 0.27), (-0.92, 0.36), (1.05, 0.36)], 0.004)
side_decal(body, "accent", strip([(1.0, 0.36), (-0.88, 0.36)], 0.014), 0.007)
side_decal(body, "trim", strip(curve([(0.96, 0.38), (1.0, 0.62), (0.96, 0.85)], closed=False), 0.012), 0.004)
side_decal(body, "trim", strip(curve([(-0.20, 0.40), (-0.23, 0.62), (-0.32, 0.83)], closed=False), 0.012), 0.004)
side_decal(body, "chrome", [(-0.06, 0.74), (0.10, 0.74), (0.10, 0.765), (-0.06, 0.765)], 0.006)
for s in (1, -1):
    mirror_pod(s, z=0.84, y=0.86)

# ── Rear: a slim light bar under a ducktail lip, a big diffuser ──
for s in (1, -1):
    m = lambda pts: [(s * x, y) for x, y in pts]
    rear_decal(body, "gloss", curve(m([(0.0, 0.83), (0.70, 0.84), (0.94, 0.86), (0.96, 0.78), (0.70, 0.76), (0.0, 0.76)]), sharp=(0, 5)), 0.004)
    rear_decal(body, "tail", curve(m([(0.52, 0.825), (0.92, 0.845), (0.93, 0.80), (0.86, 0.79), (0.52, 0.80)]), sharp=(0, 4)), 0.008)
rear_decal(body, "tail", [(-0.52, 0.808), (0.52, 0.808), (0.52, 0.82), (-0.52, 0.82)], 0.008)
# Engine grille round the two high exhausts.
rear_decal(body, "trim", [(-0.56, 0.54), (0.56, 0.54), (0.56, 0.72), (-0.56, 0.72)], 0.004)
for y in (0.58, 0.64, 0.70):
    rear_decal(body, "gloss", [(-0.54, y), (0.54, y), (0.54, y + 0.012), (-0.54, y + 0.012)], 0.007)
rear_decal(body, "trim", [(-0.90, 0.30), (0.90, 0.30), (0.88, 0.50), (-0.88, 0.50)], 0.004)
for i in range(-3, 4):
    box("trim", (i * 0.22, 0.36, -2.30), (0.02, 0.12, 0.22))
box("gloss", (0, 0.935, -2.38), (1.3, 0.02, 0.10), bevel=0.006)

# ── Panel gaps ──
GAP = 0.009
top_decal(body, "trim", strip(curve([(-0.60, 1.0), (-0.64, 1.6), (-0.52, 2.20), (0.0, 2.38), (0.52, 2.20), (0.64, 1.6), (0.60, 1.0)], closed=False), GAP), 0.003)
top_decal(body, "trim", strip([(-0.60, 1.0), (0.60, 1.0)], GAP), 0.003)
side_decal(body, "trim", strip(curve([(1.98, 0.48), (2.16, 0.56), (2.36, 0.62)], closed=False), GAP), 0.003)
side_decal(body, "trim", strip(curve([(-1.92, 0.50), (-2.10, 0.62), (-2.30, 0.70)], closed=False), GAP), 0.003)

finish(sys.argv[sys.argv.index("--") + 1])
