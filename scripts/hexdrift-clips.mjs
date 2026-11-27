// Records the short clip on each built-in Hexdrift map's card (web/src/hexdrift/clips/<id>.mp4):
// the autopilot driving the best stretch of the map, seen from the race camera.
// Software rendering here is slow, so the game isn't run in real time: it's stepped
// a frame at a time and each frame is saved, then ffmpeg makes the video.
// Run it with the dev server up (cd web && npm run dev) after changing a map:
//   node scripts/hexdrift-clips.mjs [http://127.0.0.1:5173] [map-id ...]
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://127.0.0.1:5173";
const only = process.argv.slice(2).filter((a) => !a.startsWith("http"));
const out = fileURLToPath(new URL("../web/src/hexdrift/clips/", import.meta.url));
mkdirSync(out, { recursive: true });

const W = 640, H = 400, FPS = 30, SECONDS = 8;
// Maps the default autopilot can't finish cleanly drive with the tuning their medals came from.
const TUNE = { interstellar: { look: 6, corner: 15, gain: 1.8 } };

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(`${base}/#/games`);
const ids = await page.evaluate(async () => {
  const m = await import("/src/hexdrift/maps.ts");
  return [...m.MAPS, ...m.CIRCUITS].map((x) => x.id);
});
for (const id of ids) {
  if (only.length && !only.includes(id)) continue;
  await page.goto(`${base}/#/hexdrift/${id}`);
  await page.waitForFunction(() => window.__hexdrift);
  // Take over the clock, wait for the world to load, and skip the flyover.
  const start = await page.evaluate(async (tune) => {
    const g = window.__hexdrift;
    g.stop();
    g.setGraphics("high");
    let t = performance.now();
    for (let i = 0; i < 600 && g.loading; i++) { g.frame(t += 50); await new Promise((r) => setTimeout(r, 20)); }
    await new Promise((r) => setTimeout(r, 3000)); // the kit's models and textures
    g.endIntro();
    const { botInput } = await import("/src/hexdrift/sim/bot.ts");
    const R = await import("/src/hexdrift/sim/race.ts");
    g.autopilot = true;
    g.input = () => botInput(g.race, g.botAt, tune ?? undefined);
    // A dry run finds the clip's start: just before the first wall ride, or a bit after the start.
    const r = R.newRace(g.race.track), at = { i: 0 };
    let first = -1;
    while (r.phase !== "finished" && r.tick < R.COUNTDOWN + 120 * R.HZ) {
      R.step(r, botInput(r, at, tune ?? undefined));
      if (r.car.pipe >= 0 && first < 0) { first = r.tick; break; }
    }
    const s = first > 0 ? Math.max(R.COUNTDOWN + 30, first - 2.5 * R.HZ) : R.COUNTDOWN + 1.5 * R.HZ;
    window.__clip = { t };
    return s;
  }, TUNE[id] ?? null);
  // Drive there without drawing, then a second of drawn frames to settle the camera.
  await page.evaluate((start) => {
    const g = window.__hexdrift;
    while (g.race.tick < start - 60) g.tick(g.input());
  }, start);
  const dir = join(tmpdir(), `hexclip-${id}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  const total = FPS * SECONDS;
  for (let f = -FPS; f < total; f += 10) {
    const shots = await page.evaluate(({ f, n, fps }) => {
      const g = window.__hexdrift, c = window.__clip, canvas = document.querySelector("canvas.hx-canvas");
      const res = [];
      for (let k = 0; k < n; k++) {
        g.frameMs = 16;
        g.frame(c.t += 1000 / fps);
        if (f + k >= 0) res.push(canvas.toDataURL("image/jpeg", 0.92));
      }
      return res;
    }, { f, n: 10, fps: FPS });
    shots.forEach((u, k) => writeFileSync(join(dir, `${String(f + k + (10 - shots.length)).padStart(4, "0")}.jpg`), Buffer.from(u.split(",")[1], "base64")));
  }
  const file = `${out}${id}.mp4`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "%04d.jpg"),
    "-vf", `scale=${W}:${H}:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-preset", "slow", "-crf", "28",
    "-profile:v", "main", "-movflags", "+faststart", "-an", file]);
  rmSync(dir, { recursive: true, force: true });
  console.log(`${id}.mp4 ${(statSync(file).size / 1024).toFixed(0)} KB (from tick ${start})`);
}
await browser.close();
