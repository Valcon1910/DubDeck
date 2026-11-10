// Combines YouTube's separate picture and sound files into one MP4, on this
// device, with ffmpeg compiled to WebAssembly. Nothing is re-encoded (stream
// copy), so it takes seconds, and "-shortest" trims any part where one of the
// two streams runs longer than the other (no silent tail at the end).
// The ffmpeg core (~32 MB, compressed in transit) is served from this site and
// loaded only the first time it's needed.

import type { FFmpeg } from "@ffmpeg/ffmpeg";

let loading: Promise<FFmpeg> | null = null;

function load(): Promise<FFmpeg> {
  loading ??= (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const ff = new FFmpeg();
    const base = new URL("/ffmpeg/", location.href).href;
    await ff.load({ coreURL: `${base}ffmpeg-core.js`, wasmURL: `${base}ffmpeg-core.wasm` });
    return ff;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

/** Start fetching ffmpeg early (e.g. while the video downloads). */
export function preloadMerger(): void {
  void load().catch(() => undefined);
}

export async function combine(
  video: Uint8Array, audio: Uint8Array, onProgress?: (p: number) => void,
): Promise<Uint8Array> {
  const ff = await load();
  const progress = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)));
  ff.on("progress", progress);
  try {
    await ff.writeFile("video.mp4", video);
    await ff.writeFile("audio.m4a", audio);
    const code = await ff.exec([
      "-i", "video.mp4", "-i", "audio.m4a",
      "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-shortest",
      "-movflags", "+faststart", "out.mp4",
    ]);
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
    const out = await ff.readFile("out.mp4");
    if (typeof out === "string" || out.length === 0) throw new Error("empty output");
    return out;
  } finally {
    ff.off("progress", progress);
    for (const f of ["video.mp4", "audio.m4a", "out.mp4"]) await ff.deleteFile(f).catch(() => undefined);
  }
}
