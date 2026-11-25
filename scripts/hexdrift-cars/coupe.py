# Grand Coupe body for Hexdrift, built in Blender (headless):
#   blender -b -P scripts/hexdrift-cars/coupe.py -- out.glb
# Units are metres in the game's axes: x right, y up, z forward (the front
# of the car is +z). Wheels, wings, roof extras and exhaust tips are added by
# the game, so this file makes only the body shell and its details.
# Material names are the game's part names (paint, trim, glass, lamp, ...).
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from carkit import *

reset()

# ── The body: a subdivision cage of cross-sections, front to back ──
# prof(yb, hw, ymid, ws, ybelt, wg, yg, ytop):
#   yb bottom, hw/ymid widest point, ws/ybelt shoulder (fender line),
#   wg/yg top edge (hood edge or roof rail), ytop centre line on top.
S = [
    (2.47, prof(0.33, 0.80, 0.46, 0.76, 0.62, 0.62, 0.655, 0.665)),
    (2.36, prof(0.27, 0.93, 0.48, 0.89, 0.74, 0.70, 0.77, 0.775)),
    (2.05, prof(0.24, 1.00, 0.50, 0.97, 0.88, 0.72, 0.85, 0.83)),
    (1.50, prof(0.24, 1.05, 0.53, 1.01, 0.99, 0.74, 0.91, 0.87)),
    (1.00, prof(0.23, 1.01, 0.52, 0.98, 0.95, 0.75, 0.93, 0.90)),
    (0.72, prof(0.23, 0.99, 0.52, 0.96, 0.94, 0.76, 0.96, 0.95)),
    (0.42, prof(0.23, 0.99, 0.52, 0.96, 0.94, 0.70, 1.16, 1.20)),
    (0.08, prof(0.23, 0.99, 0.52, 0.95, 0.95, 0.66, 1.31, 1.37)),
    (-0.50, prof(0.23, 0.97, 0.52, 0.95, 0.96, 0.66, 1.31, 1.37)),
    (-0.98, prof(0.23, 1.00, 0.53, 0.98, 0.98, 0.68, 1.20, 1.26)),
    (-1.45, prof(0.24, 1.08, 0.56, 1.03, 1.01, 0.76, 1.04, 1.07)),
    (-1.90, prof(0.25, 1.03, 0.54, 0.99, 0.97, 0.80, 0.96, 0.97)),
    (-2.22, prof(0.28, 0.95, 0.54, 0.92, 0.92, 0.78, 0.93, 0.94)),
    (-2.40, prof(0.33, 0.84, 0.55, 0.81, 0.89, 0.72, 0.92, 0.93)),
]
body = loft("Body", S, cap_front=2.53, cap_rear=-2.45, creases={4: 0.8, 3: 0.45, 2: 0.55, 5: 0.25, "ends": 0.4})
subdivide(body, 3)

wheels = [(0.94, 1.5, 0.42), (0.95, -1.45, 0.43)]
for x, z, r in wheels:
    for s in (1, -1):
        wheel_well(body, s * x, z, r + 0.065)
under_trim(body)

# ── Glass, flush with the body: black borders, a slim chrome line ──
dlo = [(0.64, 0.965), (0.40, 1.11), (0.10, 1.26), (-0.45, 1.275), (-0.85, 1.19), (-1.15, 1.04), (-1.22, 0.985)]
side_decal(body, "glass", dlo, 0.006)
side_decal(body, "gloss", dlo, 0.006, ring=0.03)
side_decal(body, "chrome", strip([(0.66, 0.952), (-1.24, 0.972)], 0.022), 0.008)
ws = [(-0.60, 0.975), (0.60, 0.975), (0.53, 1.29), (-0.53, 1.29)]
front_decal(body, "glass", ws, 0.006)
front_decal(body, "gloss", ws, 0.006, ring=0.035)
rw = [(-0.55, 1.09), (0.55, 1.09), (0.46, 1.24), (-0.46, 1.24)]
rear_decal(body, "glass", rw, 0.006)
rear_decal(body, "gloss", rw, 0.006, ring=0.03)

# ── Front: slim swept headlights with an LED brow, a low wide intake ──
for s in (1, -1):
    m = lambda pts: [(s * x, y) for x, y in pts]
    front_decal(body, "trim", m([(0.40, 0.555), (0.62, 0.585), (0.86, 0.625), (0.93, 0.58), (0.88, 0.53), (0.62, 0.512), (0.44, 0.508)]), 0.004)
    front_decal(body, "lamp", m([(0.48, 0.543), (0.64, 0.566), (0.84, 0.60), (0.88, 0.575), (0.84, 0.545), (0.62, 0.528), (0.49, 0.526)]), 0.008)
    front_decal(body, "lamp", strip([(s * 0.42, 0.556), (s * 0.62, 0.586), (s * 0.86, 0.624)], 0.014), 0.009)
    front_decal(body, "trim", m([(0.62, 0.30), (0.86, 0.32), (0.84, 0.44), (0.68, 0.43)]), 0.004)
upper = [(-0.34, 0.47), (0.34, 0.47), (0.30, 0.55), (-0.30, 0.55)]
front_decal(body, "trim", upper, 0.004)
front_decal(body, "chrome", upper, 0.004, ring=0.012)
low = [(-0.58, 0.29), (0.58, 0.29), (0.54, 0.43), (-0.54, 0.43)]
front_decal(body, "trim", low, 0.004)
for y in (0.33, 0.37):
    front_decal(body, "gloss", [(-0.54, y), (0.54, y), (0.54, y + 0.014), (-0.54, y + 0.014)], 0.008)
box("trim", (0, 0.25, 2.24), (1.5, 0.03, 0.22), bevel=0.01)

# ── Sides: skirts, door lines, handles, a vent behind the front wheel ──
side_decal(body, "trim", [(1.02, 0.27), (-1.0, 0.27), (-1.0, 0.35), (1.02, 0.35)], 0.004)
side_decal(body, "trim", strip([(0.64, 0.36), (0.68, 0.62), (0.64, 0.955)], 0.012), 0.004)
side_decal(body, "trim", strip([(-0.95, 0.36), (-0.98, 0.62), (-1.20, 0.975)], 0.012), 0.004)
side_decal(body, "chrome", [(-0.50, 0.80), (-0.30, 0.80), (-0.30, 0.835), (-0.50, 0.835)], 0.006)
side_decal(body, "trim", [(0.74, 0.55), (0.97, 0.58), (0.97, 0.70), (0.76, 0.68)], 0.004)
for k in range(3):
    zz = 0.79 + k * 0.06
    side_decal(body, "chrome", [(zz, 0.565), (zz + 0.025, 0.567), (zz + 0.025, 0.675), (zz, 0.672)], 0.007)
for s in (1, -1):
    mirror_pod(s, z=0.58, y=0.99)

# ── Rear: light bar under a ducktail, diffuser, number plate ──
for s in (1, -1):
    m = lambda pts: [(s * x, y) for x, y in pts]
    rear_decal(body, "trim", m([(0.46, 0.70), (0.90, 0.71), (0.86, 0.81), (0.48, 0.80)]), 0.004)
    rear_decal(body, "tail", m([(0.50, 0.715), (0.87, 0.725), (0.84, 0.795), (0.51, 0.785)]), 0.008)
rear_decal(body, "tail", [(-0.50, 0.748), (0.50, 0.748), (0.50, 0.766), (-0.50, 0.766)], 0.008)
rear_decal(body, "trim", [(-0.78, 0.31), (0.78, 0.31), (0.72, 0.45), (-0.72, 0.45)], 0.004)
rear_decal(body, "gloss", [(-0.22, 0.50), (0.22, 0.50), (0.22, 0.62), (-0.22, 0.62)], 0.005)
for i in range(-3, 4):
    box("trim", (i * 0.2, 0.29, -2.29), (0.018, 0.09, 0.2))

finish(sys.argv[sys.argv.index("--") + 1])
