# Endura body for Hexdrift (an endurance hypercar, Le Mans style), built in
# Blender (headless):
#   blender -b -P scripts/hexdrift-cars/endura.py -- out.glb
# Same conventions as coupe.py: game axes (x right, y up, z forward).
#
# The type: very low and long, tall fender domes over the front wheels with
# a low nose between them, a narrow bubble cockpit, louvres on the fenders,
# big intakes ahead of the rear wheels, a shark fin running back to a
# full-width wing, and a light bar across the tail.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from carkit import *

reset()

# prof(yb, hw, ymid, ws, ybelt, wg, yg, ytop): here (ws, ybelt) is the
# fender crest and (wg, yg) the valley between the fender and the cockpit.
S = [
    (2.55, prof(0.20, 0.80, 0.28, 0.76, 0.36, 0.50, 0.40, 0.40)),
    (2.40, prof(0.20, 0.92, 0.32, 0.88, 0.50, 0.52, 0.48, 0.47)),
    (2.05, prof(0.20, 1.00, 0.40, 0.94, 0.74, 0.54, 0.56, 0.54)),
    (1.55, prof(0.20, 1.02, 0.45, 0.94, 0.88, 0.56, 0.62, 0.60)),
    (1.05, prof(0.20, 1.00, 0.45, 0.93, 0.83, 0.56, 0.66, 0.64)),
    (0.70, prof(0.20, 0.98, 0.44, 0.90, 0.74, 0.56, 0.86, 0.90)),
    (0.20, prof(0.20, 0.98, 0.44, 0.90, 0.72, 0.58, 1.02, 1.08)),
    (-0.40, prof(0.20, 1.00, 0.45, 0.92, 0.76, 0.56, 1.00, 1.05)),
    (-0.90, prof(0.20, 1.03, 0.46, 0.96, 0.84, 0.50, 0.94, 0.98)),
    (-1.50, prof(0.21, 1.05, 0.47, 0.98, 0.92, 0.46, 0.90, 0.92)),
    (-2.05, prof(0.23, 1.03, 0.48, 0.96, 0.92, 0.46, 0.88, 0.88)),
    (-2.38, prof(0.28, 0.96, 0.50, 0.92, 0.88, 0.46, 0.86, 0.86)),
]
body = loft("Body", S, cap_front=2.60, cap_rear=-2.43, creases={4: 0.85, 3: 0.5, 2: 0.6, 5: 0.55, "ends": 0.8})
subdivide(body, 3)
for x, z, r in [(0.93, 1.55, 0.40), (0.95, -1.50, 0.42)]:
    for s in (1, -1):
        wheel_well(body, s * x, z, r + 0.06)
under_trim(body)
sharpen(body)

# ── The bubble cockpit ──
side = curve([(0.62, 0.84), (0.24, 1.02), (-0.30, 1.01), (-0.70, 0.88)], sharp=(0, 3))
region(body, "glass", side, "side", ring=0.026)
ws = rounded([(-0.50, 0.72), (0.50, 0.72), (0.42, 1.02), (-0.42, 1.02)], 0.06)
region(body, "glass", onto(body, ws, "front", "top"), "top", ring=0.02)
region(body, "gloss", rounded([(-0.30, 0.18), (0.30, 0.18), (0.30, -0.55), (-0.30, -0.55)], 0.08), "top")

# ── Louvres on the front fenders, the engine cover ──
for s in (1, -1):
    region(body, "trim", rounded([(s * 0.64, 1.28), (s * 0.97, 1.28), (s * 0.97, 1.84), (s * 0.66, 1.84)], 0.04), "top")
    for k in range(5):
        z = 1.33 + k * 0.1
        top_decal(body, "paint", [(s * 0.65, z), (s * 0.96, z), (s * 0.96, z + 0.035), (s * 0.65, z + 0.035)], 0.022)
region(body, "trim", rounded([(-0.38, -1.05), (0.38, -1.05), (0.36, -1.85), (-0.36, -1.85)], 0.05), "top")
for k in range(6):
    z = -1.10 - k * 0.12
    for s in (1, -1):
        top_decal(body, "paint", [(s * 0.03, z), (s * 0.36, z), (s * 0.36, z - 0.04), (s * 0.03, z - 0.04)], 0.022)

# ── Front: slim LED strips on the fender fronts, a splitter, canards ──
for s in (1, -1):
    front_decal(body, "gloss", rounded([(s * 0.60, 0.48), (s * 0.94, 0.50), (s * 0.94, 0.66), (s * 0.62, 0.60)], 0.03), 0.004)
    front_decal(body, "lamp", strip([(s * 0.64, 0.535), (s * 0.91, 0.575)], 0.022), 0.008)
    front_decal(body, "lamp", strip([(s * 0.88, 0.53), (s * 0.90, 0.63)], 0.018), 0.008)
    box("trim", (s * 0.93, 0.36, 2.25), (0.20, 0.016, 0.22), bevel=0.004)
    box("trim", (s * 0.95, 0.44, 2.12), (0.16, 0.014, 0.18), bevel=0.004)
front_decal(body, "trim", rounded([(-0.40, 0.24), (0.40, 0.24), (0.36, 0.38), (-0.36, 0.38)], 0.04), 0.004)
box("trim", (0, 0.19, 2.42), (1.90, 0.025, 0.32), bevel=0.008)
box("accent", (0, 0.19, 2.58), (1.86, 0.022, 0.02), bevel=0.004)

# ── Sides: deep intakes ahead of the rear wheels, mirrors on the fenders ──
side_decal(body, "trim", curve([(-0.42, 0.28), (-1.02, 0.30), (-1.04, 0.64), (-0.66, 0.62)], sharp=(0, 1)), 0.004)
side_decal(body, "accent", strip(curve([(-0.44, 0.30), (-0.62, 0.46), (-0.68, 0.62)], closed=False), 0.03), 0.007)
side_decal(body, "trim", [(1.05, 0.22), (-0.90, 0.22), (-0.90, 0.30), (1.05, 0.30)], 0.004)
side_decal(body, "white", circle(0.20, 0.52, 0.135, 24), 0.006)    # number board (the game adds the number)
for s in (1, -1):
    mirror_pod(s, z=0.86, y=0.78, xb=0.66)

# ── Rear: a tail light bar, a tall diffuser ──
rear_decal(body, "gloss", [(-0.94, 0.76), (0.94, 0.76), (0.94, 0.84), (-0.94, 0.84)], 0.004)
rear_decal(body, "tail", strip([(-0.92, 0.80), (0.92, 0.80)], 0.03), 0.008)
rear_decal(body, "trim", rounded([(-0.90, 0.26), (0.90, 0.26), (0.86, 0.58), (-0.86, 0.58)], 0.04), 0.004)
for i in range(-3, 4):
    box("trim", (i * 0.24, 0.34, -2.33), (0.02, 0.16, 0.26))

# ── Shark fin (always), then the wing (shown with the factory wing) ──
plate("paint", [(-0.45, 1.02), (-2.02, 0.92), (-2.02, 1.18), (-1.72, 1.18)], 0.02)
wing = [airfoil("paint", -0.96, 0.96, -1.90, 1.16, 0.34, -0.06, 0.1)]
for s in (1, -1):
    wing.append(plate("paint", [(-1.86, 0.88), (-2.36, 0.86), (-2.38, 1.22), (-1.90, 1.22)], 0.02, s * 0.97))
join("wing", wing)

finish(sys.argv[sys.argv.index("--") + 1])
