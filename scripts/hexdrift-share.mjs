// Copies Hexdrift's physics and maps into the record checker (a Supabase
// function), so the server re-drives runs with exactly the game's code.
//   node scripts/hexdrift-share.mjs           copy
//   node scripts/hexdrift-share.mjs --check   fail if the copy is out of date
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const from = path.join(root, "web/src/hexdrift");
const to = path.join(root, "supabase/functions/_shared/hexdrift");
const files = {
  "math.ts": "sim/math.ts",
  "track.ts": "sim/track.ts",
  "race.ts": "sim/race.ts",
  "maps.ts": "maps.ts",
};
const head = "// Copied from web/src/hexdrift by scripts/hexdrift-share.mjs. Don't edit here.\n";
let stale = [];
fs.mkdirSync(to, { recursive: true });
for (const [name, src] of Object.entries(files)) {
  const text = head + fs.readFileSync(path.join(from, src), "utf8").replaceAll('"./sim/', '"./');
  const dest = path.join(to, name);
  const now = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : "";
  if (now === text) continue;
  if (process.argv.includes("--check")) stale.push(name);
  else fs.writeFileSync(dest, text);
}
if (stale.length) {
  console.error(`Out of date: ${stale.join(", ")}. Run node scripts/hexdrift-share.mjs`);
  process.exit(1);
}
