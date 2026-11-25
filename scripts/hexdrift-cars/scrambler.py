# Scrambler body for Hexdrift (a rally hatchback), built in Blender
# (headless):
#   blender -b -P scripts/hexdrift-cars/scrambler.py -- out.glb
# Same conventions as coupe.py: game axes (x right, y up, z forward).
#
# The type: short and tall, an upright hatch, box-flared arches over wide
# wheels, a big mesh grille, a roof scoop, hood vents, a spoiler on the
# hatch, mud flaps behind every wheel and a side stripe.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from carkit import *

reset()

# prof(yb, hw, ymid, ws, ybelt, wg, yg, ytop)
S = [
    (2.16, prof(0.32, 0.86, 0.50, 0.84, 0.70, 0.70, 0.73, 0.74)),
    (2.06, prof(0.27, 0.96, 0.52, 0.94, 0.78, 0.74, 0.80, 0.81)),
    (1.75, prof(0.25, 1.05, 0.54, 1.02, 0.86, 0.76, 0.88, 0.90)),
    (1.42, prof(0.25, 1.08, 0.55, 1.04, 0.88, 0.78, 0.91, 0.93)),
    (1.05, prof(0.25, 1.01, 0.55, 0.98, 0.90, 0.80, 0.94, 0.96)),
    (0.72, prof(0.25, 0.97, 0.55, 0.95, 0.91, 0.80, 0.98, 1.00)),
    (0.40, prof(0.25, 0.97, 0.55, 0.95, 0.92, 0.75, 1.29, 1.33)),
    (0.00, prof(0.25, 0.97, 0.55, 0.95, 0.93, 0.73, 1.41, 1.45)),
    (-0.70, prof(0.25, 1.00, 0.56, 0.97, 0.94, 0.73, 1.41, 1.45)),
    (-1.10, prof(0.25, 1.07, 0.57, 1.03, 0.96, 0.75, 1.39, 1.43)),
    (-1.55, prof(0.26, 1.08, 0.57, 1.04, 0.97, 0.77, 1.35, 1.39)),
    (-1.85, prof(0.28, 1.02, 0.58, 0.99, 0.96, 0.78, 1.29, 1.32)),
    (-2.00, prof(0.34, 0.96, 0.60, 0.94, 0.95, 0.78, 1.20, 1.22)),
]
body = loft("Body", S, cap_front=2.20, cap_rear=-2.04, creases={4: 0.8, 3: 0.65, 2: 0.7, 5: 0.8, "ends": 0.85})
subdivide(body, 3)
for x, z, r in [(0.97, 1.42, 0.40), (0.97, -1.38, 0.40)]:
    for s in (1, -1):
        wheel_well(body, s * x, z, r + 0.065)
under_trim(body)
sharpen(body)

# ── Glass: tall windows, black pillars, an upright hatch window ──
win = rounded([(0.66, 0.955), (0.34, 1.30), (-1.42, 1.335), (-1.70, 0.975)], 0.05)
region(body, "glass", win, "side", ring=0.03)
for z0 in (-0.28, -1.12):
    side_decal(body, "gloss", strip([(z0, 0.95), (z0 - 0.04, 1.34)], 0.07), 0.01)
ws = rounded([(-0.66, 1.02), (0.66, 1.02), (0.60, 1.31), (-0.60, 1.31)], 0.06)
region(body, "glass", onto(body, ws, "front", "top"), "top", ring=0.02)
region(body, "glass", rounded([(-0.66, 0.99), (0.66, 0.99), (0.60, 1.18), (-0.60, 1.18)], 0.06), "rear", ring=0.025)

# ── Roof scoop and hood vents ──
box("paint", (0, 1.475, 0.0), (0.42, 0.07, 0.46), bevel=0.025)
box("trim", (0, 1.48, 0.235), (0.34, 0.04, 0.02), bevel=0.005)
for s in (1, -1):
    region(body, "trim", rounded([(s * 0.18, 1.22), (s * 0.50, 1.22), (s * 0.48, 1.52), (s * 0.20, 1.52)], 0.04), "top")
    for k in range(3):
        top_decal(body, "paint", [(s * 0.19, 1.27 + k * 0.09), (s * 0.49, 1.27 + k * 0.09), (s * 0.49, 1.30 + k * 0.09), (s * 0.19, 1.30 + k * 0.09)], 0.02)

# ── Front: a big mesh grille, square-ish lamps, a skid plate ──
front_decal(body, "trim", rounded([(-0.74, 0.30), (0.74, 0.30), (0.68, 0.62), (-0.68, 0.62)], 0.05), 0.004)
for y in (0.36, 0.42, 0.48, 0.54):
    front_decal(body, "gloss", [(-0.66, y), (0.66, y), (0.66, y + 0.012), (-0.66, y + 0.012)], 0.008)
for s in (1, -1):
    m = lambda pts: [(s * x, y) for x, y in pts]
    front_decal(body, "trim", rounded(m([(0.50, 0.64), (0.86, 0.64), (0.86, 0.77), (0.54, 0.75)]), 0.03), 0.004)
    front_decal(body, "lamp", rounded(m([(0.55, 0.66), (0.83, 0.66), (0.83, 0.75), (0.57, 0.735)]), 0.025), 0.008)
box("metal", (0, 0.24, 2.10), (1.30, 0.03, 0.30), bevel=0.01)
box("accent", (0.42, 0.33, 2.21), (0.06, 0.06, 0.06), bevel=0.01)   # tow hook

# ── Sides: a stripe, skirts, mud flaps, mirrors, door gaps ──
side_decal(body, "accent", strip(curve([(1.05, 0.44), (0.0, 0.47), (-0.9, 0.62), (-1.35, 0.82)], closed=False), 0.10), 0.006)
side_decal(body, "trim", [(1.0, 0.27), (-0.92, 0.27), (-0.92, 0.35), (1.0, 0.35)], 0.004)
for s in (1, -1):
    mirror_pod(s, z=0.56, y=0.95)
    for z in (0.92, -1.90):
        box("trim", (s * 0.97, 0.26, z), (0.30, 0.30, 0.012), bevel=0.004)
        box("accent", (s * 0.97, 0.18, z - 0.008), (0.24, 0.04, 0.006))
GAP = 0.009
for z0 in (0.70, -0.30, -1.12):
    side_decal(body, "trim", strip([(z0, 0.37), (z0, 0.94)], GAP), 0.003)
top_decal(body, "trim", strip(curve([(-0.68, 0.76), (-0.72, 1.6), (-0.52, 2.08), (0.0, 2.14), (0.52, 2.08), (0.72, 1.6), (0.68, 0.76)], closed=False), GAP), 0.003)
top_decal(body, "trim", strip([(-0.68, 0.76), (0.68, 0.76)], GAP), 0.003)

# ── Rear: tall corner lamps, a black bumper, a big single exhaust ──
for s in (1, -1):
    m = lambda pts: [(s * x, y) for x, y in pts]
    rear_decal(body, "gloss", rounded(m([(0.70, 0.70), (0.93, 0.70), (0.93, 1.02), (0.74, 1.02)]), 0.03), 0.004)
    rear_decal(body, "tail", rounded(m([(0.73, 0.73), (0.90, 0.73), (0.90, 0.99), (0.76, 0.99)]), 0.025), 0.008)
rear_decal(body, "trim", rounded([(-0.94, 0.32), (0.94, 0.32), (0.94, 0.60), (-0.94, 0.60)], 0.04), 0.004)
rear_decal(body, "trim", strip([(-0.66, 0.92), (0.66, 0.92)], 0.012), 0.003)

# ── The hatch spoiler (shown with the factory wing) ──
wing = [airfoil("paint", -0.80, 0.80, -1.80, 1.40, 0.36, -0.10, 0.1)]
for s in (1, -1):
    wing.append(plate("paint", [(-1.76, 1.30), (-2.18, 1.30), (-2.20, 1.46), (-1.80, 1.48)], 0.03, s * 0.81))
join("wing", wing)

finish(sys.argv[sys.argv.index("--") + 1])
