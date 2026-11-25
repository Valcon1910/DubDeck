# Brawler body for Hexdrift (a 70s muscle fastback), built in Blender
# (headless):
#   blender -b -P scripts/hexdrift-cars/brawler.py -- out.glb
# Same conventions as coupe.py: game axes (x right, y up, z forward).
#
# The type: a long flat hood, an upright nose with round headlights in a
# full-width grille, a fastback roof, slab sides with a kick-up over the
# rear wheels, chrome bumpers, twin racing stripes, a wide tail-light panel.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from carkit import *

reset()

# prof(yb, hw, ymid, ws, ybelt, wg, yg, ytop)
S = [
    (2.44, prof(0.36, 0.90, 0.56, 0.89, 0.80, 0.84, 0.83, 0.84)),
    (2.36, prof(0.30, 0.96, 0.57, 0.95, 0.86, 0.86, 0.885, 0.89)),
    (2.00, prof(0.27, 0.98, 0.57, 0.97, 0.88, 0.84, 0.90, 0.91)),
    (1.45, prof(0.26, 0.99, 0.57, 0.98, 0.89, 0.84, 0.91, 0.93)),
    (0.95, prof(0.26, 0.99, 0.57, 0.98, 0.90, 0.84, 0.92, 0.95)),
    # The greenhouse: a short upright screen, then one long fastback line.
    (0.55, prof(0.26, 0.99, 0.57, 0.98, 0.90, 0.74, 1.17, 1.21)),
    (0.15, prof(0.26, 0.99, 0.57, 0.98, 0.91, 0.71, 1.29, 1.32)),
    (-0.35, prof(0.26, 1.00, 0.57, 0.99, 0.92, 0.71, 1.27, 1.30)),
    # Hips: the sides kick out over the rear wheels.
    (-0.90, prof(0.26, 1.04, 0.58, 1.03, 0.94, 0.74, 1.12, 1.15)),
    (-1.45, prof(0.26, 1.06, 0.58, 1.04, 0.95, 0.82, 0.985, 1.0)),
    (-2.00, prof(0.28, 1.03, 0.58, 1.01, 0.95, 0.88, 0.955, 0.965)),
    (-2.30, prof(0.33, 0.97, 0.58, 0.96, 0.94, 0.88, 0.945, 0.95)),
]
body = loft("Body", S, cap_front=2.49, cap_rear=-2.35, creases={4: 1.0, 3: 0.75, 2: 0.7, 5: 0.85, "ends": 0.95})
subdivide(body, 3)
for x, z, r in [(0.94, 1.45, 0.40), (0.96, -1.40, 0.42)]:
    for s in (1, -1):
        wheel_well(body, s * x, z, r + 0.065)
under_trim(body)
sharpen(body)

# ── Glass with chrome surrounds ──
side = curve([(0.86, 0.935), (0.52, 1.16), (0.05, 1.28), (-0.40, 1.265), (-0.92, 1.10), (-1.16, 0.965)], sharp=(0, 5))
region(body, "glass", side, "side", ring=0.022, ring_material="chrome")
side_decal(body, "chrome", strip([(-0.05, 0.94), (0.0, 1.27)], 0.03), 0.008)   # B-pillar trim
ws = rounded([(-0.62, 0.97), (0.62, 0.97), (0.57, 1.265), (-0.57, 1.265)], 0.06)
region(body, "glass", onto(body, ws, "front", "top"), "top", ring=0.022, ring_material="chrome")
rw = rounded([(-0.56, -0.62), (0.56, -0.62), (0.60, -1.22), (-0.60, -1.22)], 0.08)
region(body, "glass", rw, "top", ring=0.02, ring_material="chrome")

# ── Twin racing stripes (accent) over hood, roof and trunk ──
for x in (-0.2, 0.2):
    for z0, z1 in ((2.40, 1.0), (0.16, -0.50), (-1.32, -2.28)):
        top_decal(body, "accent", [(x - 0.09, z1), (x + 0.09, z1), (x + 0.09, z0), (x - 0.09, z0)], 0.004)
# Hood scoop with a black mouth.
box("paint", (0, 0.935, 1.55), (0.56, 0.08, 0.62), bevel=0.03)
box("trim", (0, 0.94, 1.865), (0.46, 0.05, 0.02), bevel=0.006)

# ── Front: full-width black grille, round headlights, chrome bumper ──
front_decal(body, "trim", [(-0.90, 0.50), (0.90, 0.50), (0.90, 0.80), (-0.90, 0.80)], 0.004)
front_decal(body, "chrome", [(-0.90, 0.50), (0.90, 0.50), (0.90, 0.80), (-0.90, 0.80)], 0.004, ring=0.014)
for y in (0.58, 0.66, 0.74):
    front_decal(body, "gloss", [(-0.38, y), (0.38, y), (0.38, y + 0.018), (-0.38, y + 0.018)], 0.008)
for s in (1, -1):
    for cx, r in ((0.72, 0.095), (0.52, 0.075)):
        front_decal(body, "chrome", circle(s * cx, 0.65, r + 0.018, 24), 0.007)
        front_decal(body, "lamp", circle(s * cx, 0.65, r, 24), 0.010)
    front_decal(body, "lamp", circle(s * 0.82, 0.43, 0.035, 12, 0.02), 0.01)   # indicators
box("chrome", (0, 0.42, 2.47), (1.94, 0.09, 0.12), bevel=0.03)
for s in (1, -1):
    box("chrome", (s * 0.97, 0.42, 2.34), (0.08, 0.09, 0.3), bevel=0.03)
box("trim", (0, 0.32, 2.38), (1.6, 0.06, 0.12), bevel=0.01)

# ── Sides: chrome rocker strip, side markers, a hip crease, door gaps ──
side_decal(body, "chrome", strip([(1.0, 0.36), (-1.0, 0.36)], 0.025), 0.007)
for s in (1, -1):
    mirror_pod(s, z=0.78, y=0.92)
for z, part in ((2.05, "lamp"), (-2.05, "tail")):
    side_decal(body, part, [(z - 0.08, 0.60), (z + 0.08, 0.60), (z + 0.08, 0.64), (z - 0.08, 0.64)], 0.006)
side_decal(body, "chrome", [(-0.42, 0.82), (-0.24, 0.82), (-0.24, 0.845), (-0.42, 0.845)], 0.006)
GAP = 0.009
side_decal(body, "trim", strip(curve([(0.88, 0.37), (0.90, 0.62), (0.88, 0.93)], closed=False), GAP), 0.003)
side_decal(body, "trim", strip(curve([(-0.62, 0.37), (-0.66, 0.62), (-0.74, 0.93)], closed=False), GAP), 0.003)
top_decal(body, "trim", strip([(-0.84, 0.98), (-0.86, 2.40)], GAP), 0.003)
top_decal(body, "trim", strip([(0.84, 0.98), (0.86, 2.40)], GAP), 0.003)
top_decal(body, "trim", strip([(-0.84, 0.98), (0.84, 0.98)], GAP), 0.003)
top_decal(body, "trim", [(-0.82, -1.30), (0.82, -1.30), (0.84, -2.28), (-0.84, -2.28)], 0.003, ring=GAP)

# ── Rear: a black tail panel with three lamps a side, chrome bumper,
# a small ducktail lip ──
rear_decal(body, "trim", [(-0.90, 0.60), (0.90, 0.60), (0.90, 0.86), (-0.90, 0.86)], 0.004)
rear_decal(body, "chrome", [(-0.90, 0.60), (0.90, 0.60), (0.90, 0.86), (-0.90, 0.86)], 0.004, ring=0.012)
for s in (1, -1):
    for k in range(3):
        x0 = 0.16 + k * 0.25
        rear_decal(body, "tail", [(s * x0, 0.64), (s * (x0 + 0.21), 0.64), (s * (x0 + 0.21), 0.82), (s * x0, 0.82)], 0.008)
box("chrome", (0, 0.43, -2.37), (1.94, 0.09, 0.12), bevel=0.03)
box("trim", (0, 0.32, -2.30), (1.5, 0.06, 0.12), bevel=0.01)
box("paint", (0, 0.985, -2.22), (1.62, 0.035, 0.16), bevel=0.012)

finish(sys.argv[sys.argv.index("--") + 1])
