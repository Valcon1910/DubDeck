# Zenith body for Hexdrift (a mid-engine track car; the game adds its big
# wing), built in Blender (headless):
#   blender -b -P scripts/hexdrift-cars/zenith.py -- out.glb
# Same conventions as coupe.py: game axes (x right, y up, z forward).
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from carkit import *

reset()

# ── The body: high fender crests, a narrow cabin, flying buttresses ──
# prof(yb, hw, ymid, ws, ybelt, wg, yg, ytop)
S = [
    (2.44, prof(0.30, 0.86, 0.38, 0.82, 0.50, 0.58, 0.53, 0.53)),
    (2.32, prof(0.26, 0.97, 0.40, 0.94, 0.62, 0.62, 0.62, 0.61)),
    (2.00, prof(0.24, 1.05, 0.44, 1.01, 0.80, 0.58, 0.72, 0.69)),
    (1.45, prof(0.24, 1.08, 0.46, 1.03, 0.92, 0.60, 0.80, 0.76)),
    (1.00, prof(0.24, 1.03, 0.46, 1.00, 0.88, 0.60, 0.86, 0.84)),
    (0.55, prof(0.24, 1.00, 0.45, 0.96, 0.84, 0.56, 1.06, 1.09)),
    (0.00, prof(0.24, 1.00, 0.45, 0.96, 0.84, 0.52, 1.16, 1.19)),
    (-0.50, prof(0.24, 1.03, 0.46, 0.99, 0.87, 0.56, 1.10, 1.12)),
    # Buttresses carry the roof line back; the engine deck sits between them.
    (-0.95, prof(0.24, 1.10, 0.48, 1.05, 0.96, 0.70, 1.02, 0.97)),
    (-1.40, prof(0.25, 1.14, 0.50, 1.08, 1.02, 0.72, 1.00, 0.92)),
    (-1.80, prof(0.26, 1.11, 0.52, 1.06, 1.00, 0.70, 0.98, 0.92)),
    (-2.12, prof(0.30, 1.03, 0.54, 0.99, 0.97, 0.66, 0.97, 0.95)),
    (-2.28, prof(0.36, 0.93, 0.56, 0.91, 0.95, 0.62, 0.96, 0.96)),
]
body = loft("Body", S, cap_front=2.50, cap_rear=-2.34, creases={4: 1.0, 3: 0.8, 2: 0.8, 5: 1.0, "ends": 0.9})
subdivide(body, 3)

for x, z, r in [(0.94, 1.45, 0.39), (0.96, -1.4, 0.44)]:
    for s in (1, -1):
        wheel_well(body, s * x, z, r + 0.065)
under_trim(body)
sharpen(body)

# ── Glass, cut into the body's own surface (no overlapping layers) ──
side = curve([(0.88, 0.86), (0.54, 1.03), (0.0, 1.13), (-0.40, 1.09), (-0.62, 0.96), (-0.62, 0.86)], sharp=(0, 5))
region(body, "glass", side, "side", ring=0.03)
region(body, "gloss", curve([(-0.40, 0.56), (0.40, 0.56), (0.43, 0.0), (0.42, -0.48), (-0.42, -0.48), (-0.43, 0.0)], sharp=(0, 1, 3, 4)), "top")
ws = curve([(-0.66, 0.88), (0.66, 0.88), (0.47, 1.14), (-0.47, 1.14)], per=8)
region(body, "glass", onto(body, ws, "front", "top"), "top", ring=0.02)
# Glass engine cover between the buttresses, with black ribs.
deck = curve([(-0.40, -0.62), (0.40, -0.62), (0.45, -1.30), (0.44, -1.95), (-0.44, -1.95), (-0.45, -1.30)], sharp=(0, 1, 3, 4))
region(body, "glass", deck, "top", ring=0.03)
for x in (-0.14, 0.14):
    top_decal(body, "gloss", strip([(x, -0.64), (x * 1.1, -1.93)], 0.03), 0.01)

# ── Front: a big hood vent, angular lights, a deep grille, canards ──
hood = [(-0.30, 1.30), (0.30, 1.30), (0.26, 1.78), (-0.26, 1.78)]
top_decal(body, "trim", hood, 0.004)
top_decal(body, "accent", hood, 0.004, ring=0.02)
for i in range(4):
    z = 1.36 + i * 0.11
    top_decal(body, "paint", [(-0.28, z), (0.28, z), (0.28, z + 0.035), (-0.28, z + 0.035)], 0.02)
for s in (1, -1):
    m = lambda pts: [(s * x, y) for x, y in pts]
    front_decal(body, "trim", curve(m([(0.40, 0.56), (0.68, 0.585), (0.92, 0.635), (0.95, 0.58), (0.80, 0.525), (0.56, 0.50), (0.42, 0.51)]), sharp=(0, 2)), 0.004)
    front_decal(body, "lamp", curve(m([(0.48, 0.555), (0.70, 0.575), (0.89, 0.615), (0.90, 0.595), (0.78, 0.55), (0.56, 0.528), (0.49, 0.532)]), sharp=(0, 2)), 0.008)
    front_decal(body, "lamp", strip([(s * 0.46, 0.505), (s * 0.60, 0.495)], 0.012), 0.008)
    front_decal(body, "trim", curve(m([(0.60, 0.29), (0.94, 0.31), (0.96, 0.47), (0.80, 0.49), (0.62, 0.41)]), sharp=(0, 1)), 0.004)
    box("trim", (s * 0.97, 0.43, 2.18), (0.22, 0.018, 0.22), bevel=0.005)
    box("accent", (s * 0.97, 0.36, 2.10), (0.18, 0.016, 0.18), bevel=0.004)
grille = [(-0.50, 0.29), (0.50, 0.29), (0.44, 0.47), (0.14, 0.49), (-0.14, 0.49), (-0.44, 0.47)]
front_decal(body, "trim", curve(grille, sharp=(0, 1)), 0.004)
for y in (0.34, 0.39, 0.44):
    front_decal(body, "gloss", [(-0.46, y), (0.46, y), (0.46, y + 0.014), (-0.46, y + 0.014)], 0.008)
box("trim", (0, 0.245, 2.28), (1.85, 0.025, 0.30), bevel=0.008)
box("accent", (0, 0.245, 2.42), (1.80, 0.022, 0.02), bevel=0.004)

# ── Sides: huge scoops with an accent blade, skirts ──
scoop = curve([(-0.28, 0.44), (-0.88, 0.42), (-0.90, 0.64), (-0.86, 0.86), (-0.38, 0.84)], sharp=(0, 1, 4))
side_decal(body, "trim", scoop, 0.004)
side_decal(body, "accent", strip([(-0.29, 0.45), (-0.39, 0.84)], 0.04), 0.007)
for k in range(3):
    y = 0.52 + k * 0.1
    side_decal(body, "gloss", [(-0.88, y), (-0.40, y), (-0.40, y + 0.022), (-0.88, y + 0.022)], 0.007)
side_decal(body, "trim", [(1.0, 0.27), (-0.92, 0.27), (-0.92, 0.37), (1.0, 0.37)], 0.004)
side_decal(body, "accent", strip([(0.96, 0.37), (-0.88, 0.37)], 0.016), 0.007)
side_decal(body, "trim", strip(curve([(0.92, 0.39), (0.95, 0.62), (0.92, 0.84)], closed=False), 0.012), 0.004)
side_decal(body, "trim", strip(curve([(-0.22, 0.42), (-0.25, 0.62), (-0.34, 0.84)], closed=False), 0.012), 0.004)
for s in (1, -1):
    mirror_pod(s, z=0.74, y=0.86)

# ── Rear: angular tail lights, a tall diffuser, the quad exhaust ──
for s in (1, -1):
    m = lambda pts: [(s * x, y) for x, y in pts]
    rear_decal(body, "gloss", curve(m([(0.34, 0.86), (0.94, 0.90), (0.96, 0.74), (0.62, 0.72), (0.34, 0.80)]), sharp=(0,)), 0.004)
    rear_decal(body, "tail", curve(m([(0.40, 0.845), (0.92, 0.88), (0.93, 0.83), (0.66, 0.79), (0.40, 0.815)]), sharp=(0,)), 0.008)
    rear_decal(body, "tail", m([(0.88, 0.82), (0.93, 0.82), (0.93, 0.75), (0.88, 0.75)]), 0.008)
rear_decal(body, "gloss", [(-0.34, 0.80), (0.34, 0.80), (0.34, 0.86), (-0.34, 0.86)], 0.004)
rear_decal(body, "trim", [(-0.32, 0.28), (0.32, 0.28), (0.32, 0.58), (-0.32, 0.58)], 0.004)
rear_decal(body, "trim", [(-0.92, 0.30), (0.92, 0.30), (0.90, 0.52), (-0.90, 0.52)], 0.004)
for i in (-2, -1, 1, 2):
    box("trim", (i * 0.3, 0.36, -2.22), (0.02, 0.14, 0.26))

# ── Panel gaps ──
GAP = 0.009
top_decal(body, "trim", strip(curve([(-0.58, 1.0), (-0.62, 1.6), (-0.52, 2.14), (0.0, 2.32), (0.52, 2.14), (0.62, 1.6), (0.58, 1.0)], closed=False), GAP), 0.003)
top_decal(body, "trim", strip([(-0.58, 1.0), (0.58, 1.0)], GAP), 0.003)
side_decal(body, "trim", strip(curve([(1.94, 0.48), (2.12, 0.56), (2.30, 0.62)], closed=False), GAP), 0.003)
side_decal(body, "trim", strip(curve([(-1.90, 0.50), (-2.06, 0.62), (-2.22, 0.72)], closed=False), GAP), 0.003)

finish(sys.argv[sys.argv.index("--") + 1])
