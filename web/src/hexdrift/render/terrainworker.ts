// Works out a road map's land (heights, colours, normals) off the main thread,
// so the race can start while it's being made.
import { terrainData, type Look } from "./roadworld.ts";
import type { Track } from "../sim/track.ts";

self.onmessage = (e: MessageEvent<{ track: Track; look: Look }>) => {
  try {
    const d = terrainData(e.data.track, e.data.look);
    (self as unknown as Worker).postMessage(d, [d.pos.buffer, d.col.buffer, d.nor.buffer, d.hs.buffer, d.valid.buffer]);
  } catch {
    (self as unknown as Worker).postMessage(null);
  }
};
