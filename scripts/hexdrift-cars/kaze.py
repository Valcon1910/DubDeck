# Kaze body for Hexdrift (a 90s twin-turbo coupe), built in Blender
# (headless):
#   blender -b -P scripts/hexdrift-cars/kaze.py -- out.glb
# Same conventions as coupe.py: game axes (x right, y up, z forward).
#
# The type: smooth and rounded, a low pointed nose with slim covered
# headlights, a bubble greenhouse, a short tail with four round lamps in a
# black panel and a tall hoop wing on the trunk.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from carkit import *

reset()

# prof(yb, hw, ymid, ws, ybelt, wg, yg, ytop)
S = [
    (2.42, prof(0.30, 0.82, 0.40, 0.78, 0.50, 0.56, 0.54, 0.55)),
    (2.30, prof(0.26, 0.94, 0.42, 0.90, 0.61, 0.62, 0.635, 0.645)),
    (1.95, prof(0.24, 1.00, 0.45, 0.97, 0.75, 0.66, 0.755, 0.765)),
    (1.45, prof(0.24, 1.02, 0.47, 0.99, 0.84, 0.70, 0.83, 0.85)),
    (0.95, prof(0.24, 1.00, 0.47, 0.98, 0.86, 0.74, 0.885, 0.905)),
    (0.55, prof(0.24, 0.99, 0.47, 0.96, 0.86, 0.68, 1.09, 1.13)),
    (0.10, prof(0.24, 0.99, 0.47, 0.96, 0.87, 0.64, 1.21, 1.25)),
    (-0.40, prof(0.24, 1.00, 0.48, 0.97, 0.88, 0.64, 1.19, 1.23)),
    (-0.95, prof(0.24, 1.03, 0.49, 1.00, 0.90, 0.70, 1.05, 1.08)),
    (-1.45, prof(0.25, 1.04, 0.50, 1.01, 0.92, 0.80, 0.94, 0.95)),
    (-2.00, prof(0.27, 1.01, 0.50, 0.98, 0.91, 0.84, 0.92, 0.93)),
    (-2.28, prof(0.32, 0.94, 0.52, 0.92, 0.90, 0.82, 0.90, 0.905)),
]
body = loft("Body", S, cap_front=2.48, cap_rear=-2.34, creases={4: 0.5, 3: 0.3, 2: 0.5, 5: 0.45, "ends": 0.6})
subdivide(body, 3)
for x, z, r in [(0.93, 1.45, 0.40), (0.95, -1.38, 0.42)]:
    for s in (1, -1):
        wheel_well(body, s * x, z, r + 0.065)
under_trim(body)
sharpen(body)

# ── Glass: a bubble greenhouse with black pillars ──
side = curve([(0.88, 0.885), (0.52, 1.085), (0.05, 1.20), (-0.42, 1.18), (-0.92, 1.035), (-1.06, 0.925)], sharp=(0, 5))
region(body, "glass", side, "side", ring=0.03)
ws = rounded([(-0.64, 0.94), (0.64, 0.94), (0.56, 1.205), (-0.56, 1.205)], 0.07)
region(body, "glass", onto(body, ws, "front", "top"), "top", ring=0.02)
rw = rounded([(-0.56, -0.58), (0.56, -0.58), (0.62, -1.18), (-0.62, -1.18)], 0.1)
region(body, "glass", rw, "top", ring=0.02)

# ── Front: slim covered headlights on the nose, a wide mouth, fog lamps ──
for s in (1, -1):
    m = lambda pts: [(s * x, z) for x, z in pts]
    lamp = curve(m([(0.48, 2.28), (0.84, 2.18), (0.90, 2.06), (0.64, 2.09), (0.46, 2.18)]), sharp=(0, 2))
    region(body, "gloss", lamp, "top", ring=0.014, ring_material="trim")
    for cx, cz in ((0.58, 2.205), (0.76, 2.15)):
        top_decal(body, "lamp", circle(s * cx, cz, 0.045, 16), 0.006)
    top_decal(body, "lamp", strip([(s * 0.50, 2.255), (s * 0.84, 2.17)], 0.012), 0.006)
    front_decal(body, "lamp", circle(s * 0.74, 0.37, 0.04, 14), 0.008)
mouth = rounded([(-0.70, 0.28), (0.70, 0.28), (0.64, 0.46), (-0.64, 0.46)], 0.06)
front_decal(body, "trim", mouth, 0.004)
for y in (0.33, 0.39):
    front_decal(body, "gloss", [(-0.62, y), (0.62, y), (0.62, y + 0.014), (-0.62, y + 0.014)], 0.008)
box("trim", (0, 0.25, 2.32), (1.6, 0.025, 0.2), bevel=0.008)

# ── Sides: a scoop behind the doors, skirts, mirrors, door gaps ──
side_decal(body, "trim", curve([(-0.62, 0.50), (-0.98, 0.53), (-0.98, 0.70), (-0.70, 0.68)], sharp=(0, 3)), 0.004)
side_decal(body, "trim", [(1.0, 0.27), (-0.95, 0.27), (-0.95, 0.35), (1.0, 0.35)], 0.004)
for s in (1, -1):
    mirror_pod(s, z=0.76, y=0.88)
GAP = 0.009
side_decal(body, "trim", strip(curve([(0.86, 0.37), (0.89, 0.62), (0.87, 0.88)], closed=False), GAP), 0.003)
side_decal(body, "trim", strip(curve([(-0.56, 0.37), (-0.60, 0.62), (-0.70, 0.90)], closed=False), GAP), 0.003)
side_decal(body, "chrome", [(-0.40, 0.78), (-0.24, 0.78), (-0.24, 0.80), (-0.40, 0.80)], 0.006)
top_decal(body, "trim", strip(curve([(-0.62, 0.96), (-0.66, 1.6), (-0.52, 2.16), (0.0, 2.34), (0.52, 2.16), (0.66, 1.6), (0.62, 0.96)], closed=False), GAP), 0.003)
top_decal(body, "trim", strip([(-0.62, 0.96), (0.62, 0.96)], GAP), 0.003)
top_decal(body, "trim", rounded([(-0.74, -1.28), (0.74, -1.28), (0.76, -2.24), (-0.76, -2.24)], 0.1), 0.003, ring=GAP)

# ── Rear: four round lamps in a black panel, a diffuser ──
rear_decal(body, "gloss", rounded([(-0.86, 0.62), (0.86, 0.62), (0.88, 0.83), (-0.88, 0.83)], 0.05), 0.004)
for s in (1, -1):
    for cx in (0.40, 0.66):
        rear_decal(body, "trim", circle(s * cx, 0.725, 0.092, 22), 0.006)
        rear_decal(body, "tail", circle(s * cx, 0.725, 0.075, 22), 0.009)
rear_decal(body, "trim", rounded([(-0.84, 0.30), (0.84, 0.30), (0.80, 0.50), (-0.80, 0.50)], 0.05), 0.004)
for i in range(-2, 3):
    box("trim", (i * 0.22, 0.33, -2.28), (0.02, 0.1, 0.2))

# ── The hoop wing (shown with the factory wing) ──
wing = [airfoil("paint", -0.86, 0.86, -1.86, 1.15, 0.34, -0.12, 0.1)]
for s in (1, -1):
    wing.append(plate("paint", [(-1.92, 0.90), (-2.06, 0.90), (-2.10, 1.17), (-1.96, 1.17)], 0.035, s * 0.66))
join("wing", wing)

finish(sys.argv[sys.argv.index("--") + 1])
