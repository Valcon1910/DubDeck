// Renders the picture on each built-in Hexdrift map's card (web/src/hexdrift/thumbs/<id>.webp).
// Run it with the dev server up (cd web && npm run dev) after changing a map's look:
//   node scripts/hexdrift-thumbs.mjs [http://127.0.0.1:5173] [map-id ...]
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://127.0.0.1:5173";
const only = process.argv.slice(2).filter((a) => !a.startsWith("http"));
const out = fileURLToPath(new URL("../web/src/hexdrift/thumbs/", import.meta.url));

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(`${base}/#/games`);
const ids = await page.evaluate(async () => {
  const m = await import("/src/hexdrift/maps.ts");
  return [...m.MAPS, ...m.CIRCUITS].map((x) => x.id);
});
for (const id of ids) {
  if (only.length && !only.includes(id)) continue;
  // The first call builds the map's world and starts loading its kit; the second, once it's in, is the picture.
  const url = await page.evaluate(async (id) => {
    const m = await import("/src/hexdrift/maps.ts");
    const s = await import("/src/hexdrift/render/spectator.ts");
    const map = [...m.MAPS, ...m.CIRCUITS].find((x) => x.id === id);
    s.spectator().still(map, 64, 40);
    await new Promise((r) => setTimeout(r, 9000));
    return s.spectator().still(map, 960, 600, "image/webp", 0.8);
  }, id);
  const buf = Buffer.from(url.split(",")[1], "base64");
  writeFileSync(`${out}${id}.webp`, buf);
  console.log(`${id}.webp ${(buf.length / 1024).toFixed(0)} KB`);
}
await browser.close();
