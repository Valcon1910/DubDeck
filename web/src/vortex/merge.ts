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

/**
 * The inputs are read straight from the Blobs (WORKERFS) instead of being
 * copied into ffmpeg's memory, so only the result has to fit in memory.
 */
export async function combine(video: Blob, audio: Blob, onProgress?: (p: number) => void): Promise<Blob> {
  const ff = await load();
  const { FFFSType } = await import("@ffmpeg/ffmpeg");
  const progress = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)));
  ff.on("progress", progress);
  const dir = `/in${Date.now()}`;
  try {
    await ff.createDir(dir);
    await ff.mount(FFFSType.WORKERFS, { blobs: [{ name: "video.mp4", data: video }, { name: "audio.m4a", data: audio }] }, dir);
    const code = await ff.exec([
      "-i", `${dir}/video.mp4`, "-i", `${dir}/audio.m4a`,
      "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-shortest",
      "out.mp4",
    ]);
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
    const out = await ff.readFile("out.mp4");
    if (typeof out === "string" || out.length === 0) throw new Error("empty output");
    return new Blob([out as BlobPart], { type: "video/mp4" });
  } finally {
    ff.off("progress", progress);
    await ff.deleteFile("out.mp4").catch(() => undefined);
    await ff.unmount(dir).catch(() => undefined);
    await ff.deleteDir(dir).catch(() => undefined);
  }
}
