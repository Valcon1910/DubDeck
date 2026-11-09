import { expect, test } from "@playwright/test";

// The Vortex Engine downloader against a mocked YTStream API and video host.
// (The DubDeck backend tests live in e2e-dubdeck/ and need that backend running.)

const VIDEO = "https://rr1---sn-test.googlevideo.com/videoplayback?itag=18";
const AUDIO = "https://rr1---sn-test.googlevideo.com/videoplayback?itag=140";
const SILENT = "https://rr1---sn-test.googlevideo.com/videoplayback?itag=136";

const info = {
  status: "OK", id: "dQw4w9WgXcQ", title: "Test: video / title", lengthSeconds: "212", channelTitle: "Channel",
  thumbnail: [{ url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", width: 480, height: 360 }],
  formats: [{ itag: 18, url: VIDEO, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', height: 360, qualityLabel: "360p", contentLength: "2048" }],
  adaptiveFormats: [
    { itag: 136, url: SILENT, mimeType: 'video/mp4; codecs="avc1.4D401F"', height: 720, qualityLabel: "720p", contentLength: "4096" },
    { itag: 247, url: SILENT, mimeType: 'video/webm; codecs="vp9"', height: 720, qualityLabel: "720p" },
    { itag: 140, url: AUDIO, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 131000, contentLength: "1024",
      audioTrack: { audioIsDefault: true } },
    { itag: 140, url: AUDIO + "&dub", mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 132000,
      audioTrack: { audioIsDefault: false } },
  ],
};

test("look up a video and save the 360p file", async ({ page }) => {
  let requested = "";
  await page.route("**/yt/dl?**", (route) => {
    requested = route.request().url();
    return route.fulfill({ json: info, headers: { "x-ratelimit-requests-remaining": "42" } });
  });
  await page.route("https://rr1---sn-test.googlevideo.com/**", (route) =>
    route.fulfill({ body: Buffer.alloc(2048), headers: { "content-type": "video/mp4", "access-control-allow-origin": "*" } }));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vortex Engine" })).toBeVisible();
  await page.getByRole("link", { name: /Downloader/ }).first().click();

  await page.getByLabel("YouTube link").fill("not a link");
  await page.getByRole("button", { name: "Get formats" }).click();
  await expect(page.getByRole("alert")).toContainText("doesn't look like a YouTube link");

  await page.getByLabel("YouTube link").fill("https://youtu.be/dQw4w9WgXcQ?si=abc");
  await page.getByRole("button", { name: "Get formats" }).click();
  await expect(page.getByRole("heading", { name: info.title })).toBeVisible();
  expect(requested).toContain("id=dQw4w9WgXcQ");
  expect(requested).toContain("cgeo=CO");

  await expect(page.getByRole("link", { name: /Video 360p/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Audio · best for iPad/ })).toHaveCount(1); // dubbed track skipped
  await expect(page.getByRole("link", { name: /Video 720p/ })).toHaveCount(1); // H.264 only
  await expect(page.getByText("42 lookups left this month.")).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /Video 360p/ }).click();
  expect((await download).suggestedFilename()).toBe("Test video title.mp4");
  await expect(page.getByRole("status")).toContainText("Saved");
});

test("shows a clear message when the API key is missing", async ({ page }) => {
  await page.route("**/yt/dl?**", (route) => route.fulfill({ status: 403, json: { message: "not subscribed" } }));
  await page.goto("/#/downloader");
  await page.getByLabel("YouTube link").fill("dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Get formats" }).click();
  await expect(page.getByRole("alert")).toContainText("RapidAPI key");
});
