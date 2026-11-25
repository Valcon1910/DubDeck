# Dune Runner body for Hexdrift (a desert trophy truck), built in Blender
# (headless):
#   blender -b -P scripts/hexdrift-cars/dune.py -- out.glb
# Same conventions as coupe.py: game axes (x right, y up, z forward).
#
# The type: sits high on long-travel suspension, wide fibreglass fenders
# over big off-road tyres, a short cab, an open bed with a tube cage and a
# spare tyre, a light bar on the roof and a tube bumper over a skid plate.
import sys, os, math
from mathutils import Matrix
sys.path.insert(0, os.path.dirname(__file__))
from carkit import *

reset()

# prof(yb, hw, ymid, ws, ybelt, wg, yg, ytop)
S = [
    (2.55, prof(0.82, 0.86, 0.98, 0.86, 1.13, 0.80, 1.17, 1.18)),
    (2.42, prof(0.74, 1.02, 1.00, 1.01, 1.18, 0.84, 1.22, 1.23)),
    (2.00, prof(0.72, 1.14, 1.02, 1.12, 1.22, 0.86, 1.26, 1.28)),
    (1.45, prof(0.72, 1.15, 1.02, 1.12, 1.25, 0.86, 1.29, 1.31)),
    (1.05, prof(0.70, 1.02, 1.02, 1.00, 1.28, 0.88, 1.32, 1.34)),
    # The cab: an upright screen, a flat roof, a straight back wall.
    (0.70, prof(0.68, 1.00, 1.02, 0.98, 1.30, 0.82, 1.67, 1.71)),
    (0.25, prof(0.68, 1.00, 1.02, 0.98, 1.31, 0.80, 1.85, 1.89)),
    (-0.40, prof(0.68, 1.00, 1.02, 0.98, 1.32, 0.80, 1.84, 1.88)),
    (-0.52, prof(0.68, 1.00, 1.02, 0.98, 1.32, 0.82, 1.72, 1.75)),
    (-0.62, prof(0.68, 1.01, 1.02, 0.99, 1.32, 0.88, 1.36, 1.37)),
    # The bed, between wide rear fenders.
    (-1.15, prof(0.70, 1.12, 1.04, 1.10, 1.30, 0.94, 1.34, 1.35)),
    (-1.60, prof(0.72, 1.15, 1.04, 1.12, 1.30, 0.96, 1.34, 1.35)),
    (-2.20, prof(0.74, 1.10, 1.04, 1.08, 1.28, 0.96, 1.32, 1.33)),
    (-2.48, prof(0.82, 1.00, 1.04, 0.98, 1.26, 0.92, 1.30, 1.31)),
]
body = loft("Body", S, cap_front=2.60, cap_rear=-2.53, creases={4: 0.9, 3: 0.5, 2: 0.6, 5: 0.9, "ends": 0.85})
subdivide(body, 3)
for x, z, r in [(1.02, 1.70, 0.50), (1.02, -1.62, 0.50)]:
    for s in (1, -1):
        wheel_well(body, s * x, z, r + 0.11)
under_trim(body)
sharpen(body)

# ── Glass ──
win = rounded([(0.62, 1.37), (0.36, 1.79), (-0.40, 1.79), (-0.44, 1.37)], 0.04)
region(body, "glass", win, "side", ring=0.03)
side_decal(body, "gloss", strip([(0.0, 1.37), (-0.02, 1.80)], 0.07), 0.01)
ws = rounded([(-0.74, 1.40), (0.74, 1.40), (0.68, 1.80), (-0.68, 1.80)], 0.05)
region(body, "glass", onto(body, ws, "front", "top"), "top", ring=0.022)
region(body, "glass", rounded([(-0.62, 1.44), (0.62, 1.44), (0.62, 1.72), (-0.62, 1.72)], 0.05), "rear", ring=0.02)

# ── The bed: a black liner, a spare tyre, the cage ──
region(body, "trim", rounded([(-0.86, -0.72), (0.86, -0.72), (0.86, -2.40), (-0.86, -2.40)], 0.06), "top")
tyre = lathe("spare", "trim", [(-0.15, 0.22), (-0.17, 0.31), (-0.17, 0.39), (-0.12, 0.43), (0.12, 0.43), (0.17, 0.39), (0.17, 0.31), (0.15, 0.22)], 28)
rim = lathe("spare-rim", "metal", [(-0.12, 0.0), (-0.12, 0.10), (-0.14, 0.22), (0.14, 0.22), (0.12, 0.10), (0.12, 0.0)], 20)
for ob in (tyre, rim):
    ob.data.transform(Matrix.Translation(G(0, 1.52, -1.55)) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
for s in (1, -1):
    tube("accent", [(s * 0.70, 1.86, -0.46), (s * 0.76, 1.80, -0.90), (s * 0.86, 1.38, -2.38)], 0.035)
    tube("accent", [(s * 0.86, 1.36, -1.10), (s * 0.78, 1.79, -0.95)], 0.028)
tube("accent", [(-0.76, 1.80, -0.90), (0.76, 1.80, -0.90)], 0.035)
tube("accent", [(-0.86, 1.40, -2.38), (0.86, 1.40, -2.38)], 0.035)
tube("accent", [(-0.80, 1.58, -1.74), (0.80, 1.58, -1.74)], 0.028)

# ── Roof light bar, tube bumper, skid plate ──
box("trim", (0, 1.925, 0.30), (1.34, 0.08, 0.12), bevel=0.012)
box("lamp", (0, 1.925, 0.365), (1.26, 0.04, 0.01))
for s in (1, -1):
tube("metal", [(-0.92, 0.98, 2.50), (-0.80, 0.86, 2.70), (0.80, 0.86, 2.70), (0.92, 0.98, 2.50)], 0.035, 8)
for s in (1, -1):
    tube("metal", [(s * 0.40, 0.86, 2.70), (s * 0.36, 1.10, 2.62)], 0.03, 8)
box("metal", (0, 0.66, 2.40), (1.20, 0.04, 0.50), bevel=0.012)

# ── Front: a black grille, slim lamps ──
front_decal(body, "trim", rounded([(-0.64, 0.92), (0.64, 0.92), (0.60, 1.12), (-0.60, 1.12)], 0.05), 0.004)
for y in (0.97, 1.03, 1.08):
    front_decal(body, "gloss", [(-0.58, y), (0.58, y), (0.58, y + 0.012), (-0.58, y + 0.012)], 0.008)
for s in (1, -1):
    m = lambda pts: [(s * x, y) for x, y in pts]
    front_decal(body, "trim", rounded(m([(0.66, 1.06), (0.94, 1.06), (0.94, 1.16), (0.66, 1.15)]), 0.03), 0.004)
    front_decal(body, "lamp", rounded(m([(0.69, 1.08), (0.91, 1.08), (0.91, 1.14), (0.69, 1.135)]), 0.02), 0.008)

# ── Sides: a stripe, mirrors, door gaps; rear: lamps, a tailgate line ──
side_decal(body, "accent", strip(curve([(0.95, 1.10), (0.0, 1.12), (-0.62, 1.16)], closed=False), 0.09), 0.006)
for s in (1, -1):
    mirror_pod(s, z=0.66, y=1.36, xb=1.0)
GAP = 0.009
for z0 in (0.66, -0.50):
    side_decal(body, "trim", strip([(z0, 0.80), (z0, 1.32)], GAP), 0.003)
for s in (1, -1):
    m = lambda pts: [(s * x, y) for x, y in pts]
    rear_decal(body, "tail", rounded(m([(0.68, 1.06), (0.92, 1.06), (0.92, 1.22), (0.70, 1.22)]), 0.025), 0.008)
rear_decal(body, "trim", strip([(-0.60, 1.20), (0.60, 1.20)], 0.012), 0.003)
rear_decal(body, "trim", rounded([(-0.96, 0.80), (0.96, 0.80), (0.96, 0.96), (-0.96, 0.96)], 0.04), 0.004)

finish(sys.argv[sys.argv.index("--") + 1])
