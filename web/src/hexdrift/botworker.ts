// Drives a map with the autopilot off the main thread (the editor's "Autopilot test").
import { roadDefOf, THEMES, type CustomMap } from "./sim/custom.ts";
import { buildRoadTrack } from "./sim/track.ts";
import { botInput } from "./sim/bot.ts";
import { newRace, step, COUNTDOWN, HZ } from "./sim/race.ts";

export type BotReply = { ok: true; ticks: number } | { ok: false; s: number; error?: string };

self.onmessage = (e: MessageEvent<CustomMap>) => {
  const m = e.data;
  try {
    const track = buildRoadTrack(roadDefOf(m), THEMES[m.theme].biome);
    const r = newRace(track);
    const at = { i: 0 };
    let far = 0, stuck = 0;
    for (let t = 0; t < COUNTDOWN + 400 * HZ; t++) {
      step(r, r.phase === "running" ? botInput(r, at) : 0);
      if (r.phase === "finished") { postMessage({ ok: true, ticks: r.finishTicks } satisfies BotReply); return; }
      if (at.i > far) { far = at.i; stuck = 0; } else if (r.phase === "running" && ++stuck > 20 * HZ) break;
    }
    const main = track.road!.strands[0].pts;
    postMessage({ ok: false, s: main[Math.min(main.length - 1, far * 2)].s } satisfies BotReply);
  } catch (err) {
    postMessage({ ok: false, s: 0, error: err instanceof Error ? err.message : "error" } satisfies BotReply);
  }
};
