import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Combines a real 4 s H.264 picture-only file with a 3 s AAC sound file in the
// browser (ffmpeg.wasm) and checks the saved MP4 has both and no silent tail.

const fixtures = path.join(import.meta.dirname, "fixtures");
const files: Record<string, Buffer> = {
  "136": readFileSync(path.join(fixtures, "video720.mp4")),
  "140": readFileSync(path.join(fixtures, "audio.m4a")),
};
const G = "https://redirector.googlevideo.com/videoplayback?itag=";

test("720p is combined with sound and named after the video", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one browser is enough");
  test.setTimeout(240_000);
  await page.route("**/yt/dl?**", (route) => route.fulfill({ json: {
    status: "OK", id: "dQw4w9WgXcQ", title: "Nandu: que paso", lengthSeconds: "4",
    formats: [],
    adaptiveFormats: [
      { itag: 136, url: G + "136", mimeType: 'video/mp4; codecs="avc1.4D401F"', height: 720, qualityLabel: "720p", contentLength: String(files["136"].length) },
      { itag: 140, url: G + "140", mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, contentLength: String(files["140"].length), audioTrack: { audioIsDefault: true } },
    ],
  } }));
  await page.route("**/gv/videoplayback?**", (route) => {
    const itag = new URL(route.request().url()).searchParams.get("itag")!;
    const body = files[itag];
    const [a, b] = (route.request().headers()["range"] ?? "bytes=0-").replace("bytes=", "").split("-").map(Number);
    const end = Math.min(Number.isFinite(b) ? b : body.length - 1, body.length - 1);
    return route.fulfill({ status: 206, body: body.subarray(a, end + 1),
      headers: { "content-type": "video/mp4", "content-range": `bytes ${a}-${end}/${body.length}` } });
  });

  await page.goto("/#/downloader?hd");
  await page.getByLabel("YouTube link").fill("https://www.google.com/url?sa=t&source=web&rct=j&url=https://www.youtube.com/watch%3Fv%3DdQw4w9WgXcQ&ved=x");
  await page.getByRole("button", { name: "Get formats" }).click();
  const row = page.getByRole("link", { name: /Video 720p/ });
  await expect(row).toContainText("combined on this device");

  const download = page.waitForEvent("download", { timeout: 200_000 });
  await row.click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Nandu_ que paso.mp4");
  const saved = path.join(info.outputDir, "out.mp4");
  await file.saveAs(saved);

  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", saved]).toString());
  const kinds = probe.streams.map((s: { codec_type: string }) => s.codec_type).sort();
  expect(kinds).toEqual(["audio", "video"]);
  expect(Number(probe.format.duration)).toBeLessThan(3.6); // trimmed to the sound's length
});
