#!/bin/sh
# Rebuilds a Hexdrift car body (or the shared wheel set) from its Blender
# script and packs it for the game.
#   BLENDER=/path/to/blender sh scripts/hexdrift-cars/build.sh coupe
#   BLENDER=/path/to/blender sh scripts/hexdrift-cars/build.sh wheels
# Needs Blender 4.2 (run headless); writes web/src/hexdrift/cars/<name>.glb.
set -e
car=${1:?car name, e.g. coupe or wheels}
root=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
"${BLENDER:-blender}" -b -P "$root/scripts/hexdrift-cars/$car.py" -- "$tmp/$car.glb" | grep -E "TRIS|BOUNDS|PART"
# Bodies are simplified for phones; the wheels are already lean (and round
# things suffer most from simplifying).
keep=0.45; [ "$car" = wheels ] && keep=1
cd "$root/web" && node scripts/hexdrift-pack-car.mjs "$tmp/$car.glb" "src/hexdrift/cars/$car.glb" $keep
rm -rf "$tmp"
