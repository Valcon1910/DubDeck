import { expect, test } from "@playwright/test";

// The Vortex Engine downloader against a mocked YTStream API and video host.
// (The DubDeck backend tests live in e2e-dubdeck/ and need that backend running.)

const VIDEO = "https://redirector.googlevideo.com/videoplayback?itag=18";
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
  // The 360p file arrives through the site's /gv relay in two ranged pieces.
  const ranges: string[] = [];
  await page.route("**/gv/videoplayback?**", (route) => {
    const range = route.request().headers()["range"] ?? "";
    ranges.push(range);
    const [a, b] = range.replace("bytes=", "").split("-").map(Number);
    const end = Math.min(b, 2047);
    return route.fulfill({ status: 206, body: Buffer.alloc(end - a + 1, 7),
      headers: { "content-type": "video/mp4", "content-range": `bytes ${a}-${end}/2048` } });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vortex Engine" })).toBeVisible();
  await page.getByRole("link", { name: /Save YouTube/ }).click();

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
  await expect(page.getByRole("link", { name: /Video 720p/ })).toHaveCount(1); // made on the server
  await expect(page.getByText("42 lookups left this month.")).toBeVisible();
  await expect(page.getByText("cobalt")).toHaveCount(0);

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /Video 360p/ }).click();
  const file = await download;
  // Chromium turns ":" into "_"; Safari keeps it.
  expect(file.suggestedFilename()).toBe("Test_ video - title.mp4");
  expect(ranges[0]).toBe("bytes=0-2047");
  await expect(page.getByRole("status")).toContainText("Saved");
});

test("shows a clear message when the API key is missing", async ({ page }) => {
  await page.route("**/yt/dl?**", (route) => route.fulfill({ status: 403, json: { message: "not subscribed" } }));
  await page.goto("/#/downloader");
  await page.getByLabel("YouTube link").fill("dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Get formats" }).click();
  await expect(page.getByRole("alert")).toContainText("RapidAPI key");
});

test("games page shows the published games, and long links stay inside their box", async ({ page }) => {
  await page.goto("/#/games");
  await expect(page.getByRole("heading", { name: "External games" })).toBeVisible();
  const cards = page.locator("a.vx-game");
  expect(await cards.count()).toBeGreaterThan(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("admin: opens without a token, add a game and an email, publish one commit", async ({ page }) => {
  const repo = "http://127.0.0.1:5173/gh/repos/Valcon1910/DubDeck";
  let sentAuth = false;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
  const blobs: string[] = [];
  let committed: { message: string; tree: string } | null = null;
  let treeBody: { tree: { path: string }[] } | null = null;
  await page.route("**/gh/**", async (route) => {
    if (route.request().headers()["authorization"]) sentAuth = true;
    const url = route.request().url();
    const method = route.request().method();
    if (url === repo) return route.fulfill({ json: { permissions: { push: true } } });
    if (url.endsWith("/user")) return route.fulfill({ json: { login: "owner" } });
    if (url.includes("/contents/web/content.json")) return route.fulfill({ json: { content: b64({ games: { items: [] } }) } });
    if (url.includes("/contents/config/allowed-emails.json")) return route.fulfill({ json: { content: b64({ emails: ["me@school.edu.co"], domains: [] }) } });
    if (url.endsWith("/git/ref/heads/main")) return route.fulfill({ json: { object: { sha: "base" } } });
    if (url.endsWith("/git/commits/base")) return route.fulfill({ json: { tree: { sha: "basetree" } } });
    if (url.endsWith("/git/blobs")) { blobs.push(route.request().postDataJSON().content); return route.fulfill({ json: { sha: `blob${blobs.length}` } }); }
    if (url.endsWith("/git/trees")) { treeBody = route.request().postDataJSON(); return route.fulfill({ json: { sha: "newtree" } }); }
    if (url.endsWith("/git/commits") && method === "POST") { committed = route.request().postDataJSON(); return route.fulfill({ json: { sha: "newcommit" } }); }
    if (url.endsWith("/git/refs/heads/main")) return route.fulfill({ json: {} });
    if (url.includes("/actions/runs")) return route.fulfill({ json: { workflow_runs: [{ name: "Deploy Vortex Engine to here.now", status: "completed", conclusion: "success" }] } });
    return route.fulfill({ status: 404, json: {} });
  });

  await page.goto("/#/admin");
  await expect(page.getByText("All changes saved")).toBeVisible();
  await expect(page.getByLabel("GitHub token")).toHaveCount(0);
  expect(sentAuth).toBe(false); // the site's /gh route adds the token, not the browser

  // Edit the home title in place, like Google Sites.
  const title = page.getByRole("textbox", { name: "Page title" });
  await title.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Hub");
  await expect(title).toHaveText("Vortex Engine Hub");

  await page.getByRole("tab", { name: "Games" }).first().click();
  await page.locator(".vx-game-add").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Krunker");
  await dialog.getByLabel("Link", { exact: true }).fill("krunker.io");
  await dialog.getByRole("button", { name: "Add game" }).click();
  await expect(page.getByText("krunker.io")).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Saved permanently")).toBeVisible();
  await expect(page.getByText("Live now")).toBeVisible({ timeout: 20_000 });

  expect(treeBody!.tree.map((f) => f.path)).toEqual(["web/content.json"]);
  const files = blobs.map((b) => JSON.parse(Buffer.from(b, "base64").toString()));
  const content = files.find((f) => f.games);
  expect(content.games.items).toHaveLength(1);
  expect(content.games.items[0]).toMatchObject({ name: "Krunker", url: "https://krunker.io" });
  expect(content.home.title).toBe("Vortex Engine Hub");
});

test("admin page: start a publish action and add someone to the access list", async ({ page }) => {
  await page.route("**/.herenow/me", (route) => route.fulfill({ json: { email: "valentino1910@icloud.com" } }));
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
  let dispatched = "";
  let refUpdated = "";
  const blobs: string[] = [];
  await page.route("**/gh/**", (route) => {
    const req = route.request();
    const url = req.url();
    if (url.includes("/dispatches")) { dispatched = url + " " + req.postData(); return route.fulfill({ status: 204, body: "" }); }
    if (url.includes("/actions/runs")) return route.fulfill({ json: { workflow_runs: [] } });
    if (url.includes("/contents/config/allowed-emails.json")) return route.fulfill({ json: { content: b64({ emails: ["me@school.edu.co"], domains: [] }) } });
    if (url.endsWith("/git/ref/heads/main")) return route.fulfill({ json: { object: { sha: "base" } } });
    if (url.endsWith("/git/commits/base")) return route.fulfill({ json: { tree: { sha: "t" } } });
    if (url.endsWith("/git/blobs")) { blobs.push(req.postDataJSON().content); return route.fulfill({ json: { sha: "b" } }); }
    if (url.endsWith("/git/trees")) return route.fulfill({ json: { sha: "nt" } });
    if (url.endsWith("/git/commits")) return route.fulfill({ json: { sha: "nc" } });
    if (url.includes("/git/refs/heads/")) { refUpdated = url; return route.fulfill({ json: {} }); }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Admin" }).click();
  await page.getByRole("button", { name: "Publish code to test site" }).click();
  await expect(page.getByRole("status")).toContainText("Started");
  expect(dispatched).toContain("deploy-test.yml/dispatches");

  await page.getByLabel("Email to add").fill("Friend@Example.com");
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await page.getByRole("button", { name: "Save access list" }).click();
  await expect(page.getByText("Applies to both sites")).toBeVisible();
  expect(refUpdated).toContain("/git/refs/heads/main");
  expect(JSON.parse(Buffer.from(blobs[0], "base64").toString()).emails).toEqual(["friend@example.com", "me@school.edu.co"]);
});

test("accepts Google redirect links and shows the tutorial", async ({ page }) => {
  let requested = "";
  await page.route("**/yt/dl?**", (route) => { requested = route.request().url(); return route.fulfill({ json: info }); });
  await page.goto("/#/downloader?hd");
  await page.getByLabel("YouTube link").fill("https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=https://www.youtube.com/watch%3Fv%3DofigWubFbr0&ved=2ahUKE&usg=AOvVaw2");
  await page.getByRole("button", { name: "Get formats" }).click();
  await expect(page.getByRole("heading", { name: info.title })).toBeVisible();
  expect(requested).toContain("id=ofigWubFbr0");

  await page.getByRole("button", { name: "How to save to Files" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Paste the link");
  for (let i = 0; i < 5; i++) await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog).toContainText("put it in Photos");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
});

test("the Editor button shows only for the editors' emails", async ({ page }) => {
  await page.route("**/.herenow/me", (route) => route.fulfill({ json: { email: "someone@else.com" } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vortex Engine" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Editor" })).toHaveCount(0);

  await page.unroute("**/.herenow/me");
  await page.route("**/.herenow/me", (route) => route.fulfill({ json: { email: "Vale.Conde.Arango@gmail.com" } }));
  await page.reload();
  await page.getByRole("link", { name: "Editor" }).click();
  await expect(page.getByRole("heading", { name: "Editor" })).toBeVisible();
});

test("when the relay is blocked, the error explains why and offers 360p", async ({ page }) => {
  const hd = { ...info, adaptiveFormats: [
    { itag: 136, url: "https://redirector.googlevideo.com/videoplayback?itag=136", mimeType: 'video/mp4; codecs="avc1.4D401F"', height: 720, qualityLabel: "720p", contentLength: "4096" },
    ...info.adaptiveFormats.filter((f) => f.itag === 140),
  ] };
  await page.route("**/yt/dl?**", (route) => route.fulfill({ json: hd }));
  await page.route("**/gv/**", (route) => route.fulfill({ status: 403, body: "no" }));
  await page.route("https://redirector.googlevideo.com/**", (route) => route.abort());
  await page.goto("/#/downloader?hd");
  await page.getByLabel("YouTube link").fill("dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Get formats" }).click();
  await page.getByRole("link", { name: /Video 720p/ }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("site relay: HTTP 403");
  await expect(alert.getByRole("button", { name: "Download Video 360p instead" })).toBeVisible();
});

test("720p with sound is prepared on the server, then saved", async ({ page }) => {
  await page.route("**/yt/dl?**", (route) => route.fulfill({ json: info }));
  let start = "";
  await page.route("**/sn/ajax/download.php?**", (route) => {
    start = route.request().url();
    return route.fulfill({ json: { success: true, progress_url: "https://p.savenow.to/api/progress?id=x" } });
  });
  let polls = 0;
  await page.route((u) => u.hostname === "p.savenow.to", (route) => {
    polls++;
    return route.fulfill({ headers: { "access-control-allow-origin": "*" }, json: polls < 2
      ? { progress: 400, success: 0, text: "Downloading", download_url: null }
      : { progress: 1000, success: 1, text: "Finished", download_url: "https://leo3.savenow.to/api/v2/download/abc" } });
  });
  // Like the real server: an attachment with the video's name, no CORS header.
  await page.route((u) => u.hostname === "leo3.savenow.to", (route) =>
    route.fulfill({ status: 200, body: Buffer.alloc(4096, 1),
      headers: { "content-type": "video/mp4", "content-disposition": 'attachment; filename="Test video - title.mp4"' } }));

  await page.goto("/#/downloader");
  await page.getByLabel("YouTube link").fill("dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Get formats" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /Video 720p/ }).click();
  const file = await download;
  expect(start).toContain("format=720");
  expect(start).toContain(encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
  expect(file.suggestedFilename()).toBe("Test video - title.mp4");
  await expect(page.getByRole("status")).toContainText("downloading");
  await expect(page.getByRole("link", { name: "Save video (720p)" })).toBeVisible();
});
