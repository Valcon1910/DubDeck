// Checks every built-in Hexdrift map and prints medal times from the autopilot.
//   node scripts/hexdrift-maps.ts
// Fails if a map overlaps itself or the autopilot can't finish it.
import { MAPS, trackOf } from "../src/hexdrift/maps.ts";
import { botRun, type BotTuning } from "../src/hexdrift/sim/bot.ts";
import { formatTime } from "../src/hexdrift/sim/race.ts";

let bad = false;
for (const m of MAPS) {
  const t = trackOf(m);
  const seen = new Map<string, string>();
  for (const p of t.pieces) {
    // Same cell and level (or touching levels on slopes) collide.
    const k = `${p.x},${p.z},${p.y}`;
    if (seen.has(k)) { console.log(`✗ ${m.name}: ${p.t} overlaps ${seen.get(k)} at ${k}`); bad = true; }
    seen.set(k, p.t);
  }
  const t0 = performance.now();
  // Try a few driving styles and keep the fastest (the author time).
  let run: ReturnType<typeof botRun> = null;
  for (const corner of [12, 15, 18, 22]) for (const look of [2, 3, 4]) for (const gain of [2.4, 3.5]) {
    const tune: BotTuning = { corner, look, gain };
    const r = botRun(t, tune, 90);
    if (r && (!run || r.ticks < run.ticks)) run = r;
  }
  const ms = (performance.now() - t0).toFixed(0);
  if (!run) { console.log(`✗ ${m.name}: the autopilot couldn't finish (${t.pieces.length} pieces)`); bad = true; continue; }
  const v = run.ticks;
  const medals = { vortex: Math.round(v * 0.97), gold: Math.round(v * 1.06), silver: Math.round(v * 1.22), bronze: Math.round(v * 1.5) };
  console.log(`✓ ${m.name}: ${formatTime(v)} (${t.pieces.length} pieces, simulated in ${ms} ms) medals: ${JSON.stringify(medals)}`);
}
process.exit(bad ? 1 : 0);
