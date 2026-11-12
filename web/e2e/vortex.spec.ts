import { expect, test } from "@playwright/test";

// The Vortex Engine downloader against mocked RapidAPI services.
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

const details = { title: info.title, lengthSeconds: info.lengthSeconds, author: { title: info.channelTitle }, thumbnails: info.thumbnail };

/** The download server: start → progress → a finished file named like the video. */
async function mockServer(page: import("@playwright/test").Page, name = "Test video - title.mp4") {
  const starts: string[] = [];
  await page.route("**/sn/ajax/download.php?**", (route) => {
    starts.push(route.request().url());
    return route.fulfill({ json: { success: true, progress_url: "https://p.savenow.to/api/progress?id=x" } });
  });
  let polls = 0;
  await page.route((u) => u.hostname === "p.savenow.to", (route) => {
    polls++;
    return route.fulfill({ headers: { "access-control-allow-origin": "*" }, json: polls % 2
      ? { progress: 400, success: 0, text: "Downloading", download_url: null }
      : { progress: 1000, success: 1, text: "Finished", download_url: "https://leo3.savenow.to/api/v2/download/abc" } });
  });
  await page.route((u) => u.hostname === "leo3.savenow.to", (route) =>
    route.fulfill({ status: 200, body: Buffer.alloc(4096, 1),
      headers: { "content-type": "video/mp4", "content-disposition": `attachment; filename="${name}"` } }));
  return starts;
}

test("look up a video and save the 360p file", async ({ page }) => {
  let requested = "";
  await page.route("**/ys/video/details/**", (route) => {
    requested = route.request().url();
    return route.fulfill({ json: details, headers: { "x-ratelimit-requests-remaining": "42" } });
  });
  const starts = await mockServer(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vortex Engine" })).toBeVisible();
  await page.getByRole("link", { name: /Save YouTube/ }).click();

  await page.getByLabel("Search YouTube or paste a link").fill("https://youtu.be/dQw4w9WgXcQ?si=abc");
  await page.getByRole("button", { name: "Get formats" }).click();
  await expect(page.getByRole("heading", { name: info.title })).toBeVisible();
  expect(requested).toContain("id=dQw4w9WgXcQ");

  for (const q of ["1080p", "720p", "480p", "360p"]) await expect(page.getByRole("link", { name: new RegExp(`Video ${q}`) })).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Audio · best for iPad/ })).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Audio · MP3/ })).toHaveCount(1);
  await expect(page.getByText("42 lookups left this month.")).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /Video 360p/ }).click();
  await download;
  expect(starts[0]).toContain("format=360");
});

test("shows a clear message when the API key is missing", async ({ page }) => {
  await page.route("**/ys/video/details/**", (route) => route.fulfill({ status: 403, json: { message: "not subscribed" } }));
  await page.route("**/sn/ajax/download.php?**", (route) => route.fulfill({ status: 403, json: { message: "not subscribed" } }));
  await page.goto("/#/downloader");
  await page.getByLabel("Search YouTube or paste a link").fill("dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Get formats" }).click();
  await page.getByRole("link", { name: /Audio · MP3/ }).click();
  await expect(page.getByRole("alert")).toContainText("RAPIDAPI_KEY");
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
  let committed: { message: string; tree: string } | null = null; void committed;
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
  await openMenu(page);
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
  await page.route("**/ys/video/details/**", (route) => { requested = route.request().url(); return route.fulfill({ json: details }); });
  await page.goto("/#/downloader?hd");
  await page.getByLabel("Search YouTube or paste a link").fill("https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=https://www.youtube.com/watch%3Fv%3DofigWubFbr0&ved=2ahUKE&usg=AOvVaw2");
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
  await openMenu(page);
  await page.getByRole("link", { name: "Editor" }).click();
  await expect(page.getByRole("heading", { name: "Editor" })).toBeVisible();
});

test("720p with sound is prepared on the server, then saved", async ({ page }) => {
  await page.route("**/ys/video/details/**", (route) => route.fulfill({ json: details }));
  const starts = await mockServer(page);
  await page.goto("/#/downloader");
  await page.getByLabel("Search YouTube or paste a link").fill("dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Get formats" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /Video 720p/ }).click();
  const file = await download;
  expect(starts[0]).toContain("format=720");
  expect(starts[0]).toContain(encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
  expect(file.suggestedFilename()).toBe("Test video - title.mp4");
  await expect(page.getByRole("status")).toContainText("downloading");
  await expect(page.getByRole("link", { name: "Save video (720p)" })).toBeVisible();
});

/** On phones the categories are in the side menu. */
async function openMenu(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: "Open menu" });
  if (await btn.isVisible()) await btn.click();
}

test("account: name and picture at the top right, settings change the look for this person", async ({ page }) => {
  await page.route("**/.herenow/me", (route) => route.fulfill({ json: { email: "maria.lopez@school.edu.co" } }));
  await page.goto("/");
  const user = page.locator(".vx-user");
  await expect(user).toContainText("Maria Lopez");
  await user.click();
  await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByLabel("Full name", { exact: true }).fill("Majo");
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(user).toContainText("Majo");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload(); // remembered next time
  await expect(page.locator(".vx-user")).toContainText("Majo");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("search YouTube, open a channel, and pick a video to download", async ({ page }) => {
  const thumbs = (id: string) => [{ url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, width: 320 }, { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480 }];
  let searched = "";
  await page.route("**/ys/search/**", (route) => {
    searched = route.request().url();
    return route.fulfill({ json: { contents: [
      { type: "channel", channel: { channelId: "UC123", title: "Cool Channel", avatar: [{ url: "//yt3.ggpht.com/a.jpg", width: 88 }], stats: { subscribers: 1250000 } } },
      { type: "video", video: { videoId: "dQw4w9WgXcQ", title: "Found video", thumbnails: thumbs("dQw4w9WgXcQ"), lengthSeconds: 212, stats: { views: 1500 }, publishedTimeText: "2 years ago",
        author: { channelId: "UC123", title: "Cool Channel", avatar: [{ url: "https://yt3.ggpht.com/a.jpg", width: 68 }] } } },
    ] } });
  });
  let tab = "";
  await page.route("**/ys/channel/details/**", (route) => route.fulfill({ json: {
    channelId: "UC123", title: "Cool Channel", avatar: [{ url: "https://yt3.ggpht.com/a.jpg", width: 176 }],
    banner: { desktop: [{ url: "https://yt3.ggpht.com/banner.jpg", width: 2560 }] }, stats: { subscribers: 1250000, videos: 42 }, description: "Hello",
  } }));
  await page.route("**/ys/channel/videos/**", (route) => {
    tab = new URL(route.request().url()).searchParams.get("filter") ?? "";
    return route.fulfill({ json: { contents: [{ type: "video", video: { videoId: "abcdefghijk", title: `Latest ${tab}`, thumbnails: thumbs("abcdefghijk") } }] } });
  });
  let looked = "";
  await page.route("**/ys/video/details/**", (route) => { looked = route.request().url(); return route.fulfill({ json: details }); });

  await page.goto("/#/downloader");
  await page.getByLabel("Search YouTube or paste a link").fill("cool videos");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("button", { name: "Found video", exact: true })).toBeVisible();
  expect(new URL(searched).searchParams.get("q")).toBe("cool videos");
  await expect(page.locator(".vx-vthumb img").first()).toHaveAttribute("src", /hqdefault/); // biggest thumbnail
  await expect(page.getByText("1.3M subscribers")).toBeVisible();

  await page.getByRole("button", { name: /Cool Channel.*View channel/ }).click();
  await expect(page.getByRole("heading", { name: "Cool Channel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Latest videos_latest", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Shorts" }).click();
  await expect(page.getByRole("button", { name: "Latest shorts_latest", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to results" }).click();

  await page.getByRole("button", { name: "Found video", exact: true }).click();
  await expect(page.getByRole("heading", { name: info.title })).toBeVisible();
  expect(looked).toContain("id=dQw4w9WgXcQ");
  await expect(page.getByLabel("Search YouTube or paste a link")).toHaveValue("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("welcome with the full name, hide the side menu, clear search, not found page and log out", async ({ page }) => {
  await page.route("**/.herenow/me", (route) => route.fulfill({ json: { email: "maria.lopez@school.edu.co" } }));
  await page.route("https://gravatar.com/**", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Welcome" })).toContainText("Maria Lopez!");
  await expect(page.getByLabel("Your full name")).toHaveCount(0);

  const hide = page.getByRole("button", { name: "Hide menu" });
  if ((page.viewportSize()?.width ?? 0) > 860) {
    await hide.click();
    await expect(page.locator(".vx-side")).toBeHidden();
    await expect(page.locator(".vx-topnav").getByRole("link", { name: "Games" })).toBeVisible();
    await page.getByRole("button", { name: "Show side menu" }).click();
    await expect(page.locator(".vx-side")).toBeVisible();
  }

  await page.goto("/#/downloader");
  const box = page.getByLabel("Search YouTube or paste a link");
  await box.fill("something");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(box).toHaveValue("");

  await page.goto("/#/does-not-exist");
  await expect(page.getByRole("heading", { name: "This page got lost in the vortex" })).toBeVisible();
  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(page.getByRole("region", { name: "Welcome" })).toBeVisible();

  await page.locator(".vx-user").click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "You're signed out" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in again" }).click();
  await expect(page.getByRole("region", { name: "Welcome" })).toBeVisible();
});

test("empty channel tab falls back to the feed; Google goto links; select and download several", async ({ page }) => {
  await page.route("**/ys/channel/details/**", (route) => route.fulfill({ json: { channelId: "UC9", title: "Feed Channel" } }));
  await page.route("**/ys/channel/videos/**", (route) => route.fulfill({ json: { contents: [] } }));
  await page.route("**/yf/feeds/videos.xml?**", (route) => route.fulfill({ contentType: "application/xml", body:
    `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><title>Feed Channel</title>
    <entry><yt:videoId>aaaaaaaaaaa</yt:videoId><title>From feed one</title><published>2026-01-02T00:00:00Z</published></entry>
    <entry><yt:videoId>bbbbbbbbbbb</yt:videoId><title>From feed two</title><published>2026-01-03T00:00:00Z</published></entry></feed>` }));
  await page.route("**/ys/search/**", (route) => route.fulfill({ json: { contents: [
    { type: "channel", channel: { channelId: "UC9", title: "Feed Channel" } },
  ] } }));
  await page.route("**/gg/goto?**", (route) => route.fulfill({ contentType: "text/html", body: '<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;vl=en">go</a>' }));
  await page.route("**/ys/video/details/**", (route) => route.fulfill({ json: details }));

  await page.goto("/#/downloader");
  const box = page.getByLabel("Search YouTube or paste a link");
  await box.fill("https://www.google.com/goto?url=CAESbgHEIkXX&gsessionid=abc");
  await page.getByRole("button", { name: "Get formats" }).click();
  await expect(page.getByRole("heading", { name: info.title })).toBeVisible();
  await expect(box).toHaveValue("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

  await box.fill("feed channel");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: /Feed Channel.*View channel/ }).click();
  await expect(page.getByRole("button", { name: "From feed one", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Select videos" }).click();
  await page.getByRole("button", { name: "Select From feed one" }).click();
  await page.getByRole("button", { name: "Select From feed two" }).click();
  const bar = page.getByRole("region", { name: "Selected videos" });
  await expect(bar).toContainText("2 selected");
  const starts = await mockServer(page);
  let saved = 0;
  page.on("download", () => { saved++; });
  await bar.getByRole("button", { name: "Download all" }).click();
  await expect(page.getByRole("status").filter({ hasText: "All 2 videos were saved" })).toBeVisible({ timeout: 20000 });
  expect(starts.map((u) => new URL(u).searchParams.get("url"))).toEqual([
    "https://www.youtube.com/watch?v=aaaaaaaaaaa", "https://www.youtube.com/watch?v=bbbbbbbbbbb"]);
  expect(saved).toBe(2);
  await expect(bar).toBeHidden();
});
