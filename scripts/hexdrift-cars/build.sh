#!/bin/sh
# Rebuilds a Hexdrift car body from its Blender script and packs it for the game.
#   BLENDER=/path/to/blender sh scripts/hexdrift-cars/build.sh coupe
# Needs Blender 4.2 (run headless); writes web/src/hexdrift/cars/<car>.glb.
set -e
car=${1:?car name, e.g. coupe}
root=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
"${BLENDER:-blender}" -b -P "$root/scripts/hexdrift-cars/$car.py" -- "$tmp/$car.glb" | grep -E "TRIS|BOUNDS"
cd "$root/web" && node scripts/hexdrift-pack-car.mjs "$tmp/$car.glb" "src/hexdrift/cars/$car.glb" 0.45
rm -rf "$tmp"
