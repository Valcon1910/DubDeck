# Grand Coupe body for Hexdrift, built in Blender (headless):
#   blender -b -P scripts/hexdrift-cars/coupe.py -- out.glb
# Units are metres in the game's axes: x right, y up, z forward (the front
# of the car is +z). Wheels, wings, roof extras and exhaust tips are added by
# the game, so this file makes only the body shell and its details.
# Material names are the game's part names (paint, trim, glass, lamp, ...).
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from carkit import *

reset()

# ── The body: a subdivision cage of cross-sections, front to back ──
# prof(yb, hw, ymid, ws, ybelt, wg, yg, ytop):
#   yb bottom, hw/ymid widest point, ws/ybelt shoulder (fender line),
#   wg/yg top edge (hood edge or roof rail), ytop centre line on top.
S = [
    (2.47, prof(0.32, 0.80, 0.45, 0.76, 0.60, 0.60, 0.625, 0.635)),
    (2.36, prof(0.27, 0.94, 0.47, 0.90, 0.73, 0.68, 0.75, 0.76)),
    (2.05, prof(0.24, 1.02, 0.50, 0.99, 0.89, 0.68, 0.85, 0.86)),
    (1.50, prof(0.24, 1.08, 0.53, 1.03, 1.00, 0.72, 0.90, 0.92)),
    (1.10, prof(0.23, 1.02, 0.52, 0.99, 0.96, 0.75, 0.93, 0.945)),
    (0.85, prof(0.23, 0.97, 0.50, 0.97, 0.95, 0.78, 0.965, 0.97)),
    # The greenhouse: low, wide, a raked screen and a long fastback.
    (0.50, prof(0.23, 0.95, 0.50, 0.97, 0.95, 0.76, 1.12, 1.15)),
    (0.15, prof(0.23, 0.95, 0.50, 0.96, 0.95, 0.74, 1.25, 1.29)),
    (-0.35, prof(0.23, 0.95, 0.50, 0.96, 0.96, 0.73, 1.27, 1.31)),
    (-0.85, prof(0.23, 0.99, 0.52, 0.98, 0.97, 0.74, 1.20, 1.24)),
    (-1.30, prof(0.24, 1.09, 0.56, 1.03, 1.00, 0.77, 1.09, 1.12)),
    (-1.72, prof(0.25, 1.06, 0.55, 1.01, 0.98, 0.80, 1.00, 1.02)),
    (-2.10, prof(0.27, 0.98, 0.54, 0.94, 0.95, 0.79, 0.965, 0.975)),
    (-2.40, prof(0.33, 0.84, 0.55, 0.82, 0.95, 0.72, 1.0, 1.01)),
]
body = loft("Body", S, cap_front=2.53, cap_rear=-2.45, creases={4: 1.0, 3: 0.7, 2: 0.8, 5: 0.9, "ends": 0.8})
subdivide(body, 3)

wheels = [(0.94, 1.5, 0.42), (0.95, -1.45, 0.43)]
for x, z, r in wheels:
    for s in (1, -1):
        wheel_well(body, s * x, z, r + 0.065)
under_trim(body)
sharpen(body)

# ── Glass, flush with the body: black borders, a slim chrome line ──
dlo = [(0.80, 0.97), (0.50, 1.10), (0.15, 1.215), (-0.35, 1.24), (-0.85, 1.165), (-1.30, 1.035), (-1.46, 0.99)]
# Black pillars around the side glass: the roof reads as its own panel.
side_decal(body, "gloss", [(0.84, 0.962), (0.52, 1.105), (0.15, 1.225), (-0.35, 1.248), (-0.85, 1.178), (-1.33, 1.05), (-1.56, 0.985)], 0.004)
side_decal(body, "glass", dlo, 0.008)
side_decal(body, "chrome", strip([(0.82, 0.956), (-1.48, 0.976)], 0.018), 0.008)
ws = [(-0.64, 1.0), (0.64, 1.0), (0.57, 1.235), (-0.57, 1.235)]
front_decal(body, "glass", ws, 0.006)
front_decal(body, "gloss", ws, 0.006, ring=0.018)
# Rear glass seen from above (x, z): follows the fastback, narrowing back.
rw = [(-0.60, -0.72), (-0.50, -1.50), (0.50, -1.50), (0.60, -0.72)]
top_decal(body, "glass", rw, 0.006)
top_decal(body, "gloss", rw, 0.006, ring=0.018)

# ── Front: slim swept headlights with an LED brow, a low wide intake ──
for s in (1, -1):
    m = lambda pts: [(s * x, y) for x, y in pts]
    front_decal(body, "trim", m([(0.40, 0.535), (0.62, 0.565), (0.86, 0.605), (0.93, 0.56), (0.88, 0.51), (0.62, 0.492), (0.44, 0.488)]), 0.004)
    front_decal(body, "lamp", m([(0.48, 0.523), (0.64, 0.546), (0.84, 0.58), (0.88, 0.555), (0.84, 0.525), (0.62, 0.508), (0.49, 0.506)]), 0.008)
    front_decal(body, "lamp", strip([(s * 0.42, 0.536), (s * 0.62, 0.566), (s * 0.86, 0.604)], 0.014), 0.009)
    front_decal(body, "trim", m([(0.64, 0.31), (0.84, 0.32), (0.84, 0.46), (0.78, 0.47), (0.66, 0.40)]), 0.004)
    front_decal(body, "gloss", m([(0.70, 0.345), (0.82, 0.35), (0.82, 0.365), (0.71, 0.36)]), 0.008)
upper = [(-0.32, 0.46), (0.32, 0.46), (0.28, 0.53), (-0.28, 0.53)]
front_decal(body, "trim", upper, 0.004)
front_decal(body, "chrome", upper, 0.004, ring=0.012)
low = [(-0.60, 0.28), (0.60, 0.28), (0.52, 0.42), (0.20, 0.44), (-0.20, 0.44), (-0.52, 0.42)]
front_decal(body, "trim", low, 0.004)
for y in (0.33, 0.37):
    front_decal(body, "gloss", [(-0.54, y), (0.54, y), (0.54, y + 0.014), (-0.54, y + 0.014)], 0.008)
box("trim", (0, 0.245, 2.2), (1.4, 0.025, 0.2), bevel=0.008)
box("accent", (0, 0.245, 2.30), (1.36, 0.022, 0.018), bevel=0.004)

# ── Sides: skirts, door lines, handles, a vent behind the front wheel ──
side_decal(body, "trim", [(1.02, 0.27), (-1.0, 0.27), (-1.0, 0.35), (1.02, 0.35)], 0.004)
side_decal(body, "trim", strip([(0.74, 0.36), (0.78, 0.62), (0.80, 0.955)], 0.012), 0.004)
side_decal(body, "trim", strip([(-0.85, 0.36), (-0.88, 0.62), (-0.98, 0.975)], 0.012), 0.004)
side_decal(body, "chrome", [(-0.50, 0.80), (-0.30, 0.80), (-0.30, 0.835), (-0.50, 0.835)], 0.006)
side_decal(body, "trim", [(0.74, 0.55), (0.97, 0.58), (0.97, 0.70), (0.76, 0.68)], 0.004)
for k in range(3):
    zz = 0.79 + k * 0.06
    side_decal(body, "chrome", [(zz, 0.565), (zz + 0.025, 0.567), (zz + 0.025, 0.675), (zz, 0.672)], 0.007)
for s in (1, -1):
    mirror_pod(s, z=0.68, y=0.99)

# ── Rear: a wrap-around LED bar under a ducktail, black diffuser ──
for s in (1, -1):
    m = lambda pts: [(s * x, y) for x, y in pts]
    rear_decal(body, "gloss", m([(0.0, 0.76), (0.62, 0.765), (0.88, 0.78), (0.92, 0.70), (0.86, 0.66), (0.60, 0.69), (0.0, 0.70)]), 0.004)
    rear_decal(body, "tail", m([(0.58, 0.745), (0.86, 0.76), (0.89, 0.705), (0.84, 0.68), (0.80, 0.73), (0.58, 0.73)]), 0.008)
rear_decal(body, "tail", [(-0.60, 0.738), (0.60, 0.738), (0.60, 0.752), (-0.60, 0.752)], 0.008)
rear_decal(body, "trim", [(-0.86, 0.30), (0.86, 0.30), (0.84, 0.52), (0.40, 0.50), (-0.40, 0.50), (-0.84, 0.52)], 0.004)
rear_decal(body, "gloss", [(-0.24, 0.53), (0.24, 0.53), (0.24, 0.64), (-0.24, 0.64)], 0.005)
for i in range(-3, 4):
    box("trim", (i * 0.2, 0.29, -2.29), (0.018, 0.12, 0.22))

# ── Panel gaps: hood, trunk, bumpers, fuel door ──
GAP = 0.009
top_decal(body, "trim", strip([(-0.66, 0.92), (-0.69, 1.6), (-0.63, 2.12), (-0.42, 2.28), (0.42, 2.28), (0.63, 2.12), (0.69, 1.6), (0.66, 0.92)], GAP), 0.003)
top_decal(body, "trim", strip([(-0.66, 0.92), (0.66, 0.92)], GAP), 0.003)
top_decal(body, "trim", [(-0.70, -1.60), (-0.73, -2.15), (-0.62, -2.33), (0.62, -2.33), (0.73, -2.15), (0.70, -1.60)], 0.003, ring=GAP)
side_decal(body, "trim", strip([(1.97, 0.52), (2.12, 0.62), (2.30, 0.69)], GAP), 0.003)
side_decal(body, "trim", strip([(-1.91, 0.52), (-2.08, 0.64), (-2.28, 0.70)], GAP), 0.003)
side_decal(body, "trim", [(-1.70 + 0.07 * math.cos(a * math.pi / 8), 0.80 + 0.07 * math.sin(a * math.pi / 8)) for a in range(16)], 0.003, ring=GAP)

finish(sys.argv[sys.argv.index("--") + 1])
