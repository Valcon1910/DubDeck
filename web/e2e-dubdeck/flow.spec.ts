import { expect, test, type Page } from "@playwright/test";

// Full user flow against a real backend. Required env:
//   DUBDECK_E2E_EMAIL   an allowlisted email (backend runs with DUBDECK_DEV_LOGIN=1)
//   DUBDECK_E2E_MEDIA   URL of a small test video (served locally)
//   DUBDECK_E2E_SLOW    URL of the same file served slowly (for pause/resume)
//   DUBDECK_E2E_SHOTS   optional directory for screenshots
const EMAIL = process.env.DUBDECK_E2E_EMAIL ?? "owner@example.com";
const MEDIA = process.env.DUBDECK_E2E_MEDIA ?? "http://127.0.0.1:8765/test720.mp4";
const SLOW = process.env.DUBDECK_E2E_SLOW ?? "http://127.0.0.1:8766/test720.mp4";
const SHOTS = process.env.DUBDECK_E2E_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png`, fullPage: true });
}

async function signIn(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /DubDeck/ })).toBeVisible();
  await shot(page, "00-signin");
  await page.getByLabel(/Developer sign-in/).fill(EMAIL);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Download", level: 1 })).toBeVisible();
}

async function pasteAnywhere(page: Page, text: string) {
  // A real Ctrl+V on the page body (not in a text field).
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.locator("h1").first().click();
  await page.keyboard.press("ControlOrMeta+V");
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("sign-in is required and the key never reaches the browser", async ({ page }) => {
  const seen: string[] = [];
  page.on("request", (r) => seen.push(JSON.stringify(r.headers())));
  await signIn(page);
  // Phones show an avatar chip; tapping it reveals "Signed in as …".
  if (test.info().project.name === "phone") await page.locator(".user-chip-btn:visible").first().click();
  await expect(page.getByText("Signed in as").locator("visible=true").first()).toBeVisible();
  await expect(page.getByText(EMAIL).locator("visible=true").first()).toBeVisible();
  expect(seen.join("\n")).not.toMatch(/x-dubdeck-key/i);
  // Unknown email is refused.
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.getByLabel(/Developer sign-in/).fill("stranger@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("isn't allowed");
});

test("download audio with tags, then play, rename and delete it", async ({ page, isMobile }) => {
  await signIn(page);
  await pasteAnywhere(page, MEDIA);
  const card = page.locator("article.preview").first();
  await expect(card.getByRole("heading", { name: "test720" })).toBeVisible();
  await shot(page, "01-preview");

  await page.getByRole("radio", { name: "Audio" }).click();
  await page.getByRole("radio", { name: "MP3" }).click();
  await page.getByLabel("Bitrate").selectOption("256");
  await page.getByLabel("Title").fill("E2E Song");
  await page.getByLabel("Artist").fill("DubDeck Tests");
  await page.locator("#tpl").fill("{title} - {artist}");
  await expect(page.locator(".example")).toHaveText("E2E Song - DubDeck Tests.mp3");
  await page.getByRole("button", { name: /Download 1 item/ }).click();
  await expect(page.getByText("1 download added to the queue")).toBeVisible();

  await page.getByRole("link", { name: /Queue/ }).first().click();
  await expect(page.getByRole("heading", { name: "Queue", level: 1 })).toBeVisible();
  await page.getByRole("tab", { name: /History/ }).click();
  await expect(page.locator("li.job.is-completed", { hasText: "E2E Song" }).first()).toBeVisible({ timeout: 60_000 });
  await shot(page, "02-queue-history");

  await page.getByRole("link", { name: /Library/ }).first().click();
  await expect(page.getByRole("heading", { name: "Storage" })).toBeVisible();
  const tile = page.locator("li.file", { hasText: "E2E Song - DubDeck Tests" }).first();
  await expect(tile).toBeVisible();
  await expect(tile).toContainText("MP3 256k");
  await shot(page, "03-library");

  // Inline player streams straight from the backend through a signed URL.
  await tile.getByRole("button", { name: /^Play/ }).click();
  const audio = page.locator("dialog audio");
  await expect(audio).toHaveAttribute("src", /\/f\//);
  const src = (await audio.getAttribute("src"))!;
  const res = await page.request.get(src, { headers: { Range: "bytes=0-1023" } });
  expect(res.status()).toBe(206);
  await shot(page, "04-player");
  await page.keyboard.press("Escape");

  await tile.getByRole("button", { name: /^Rename/ }).click();
  await page.getByLabel("File name").fill("Renamed by E2E");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const renamed = page.locator("li.file", { hasText: "Renamed by E2E" }).first();
  await expect(renamed).toBeVisible();

  await renamed.getByRole("button", { name: /^Delete/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("File deleted")).toBeVisible();
  await expect(page.locator("li.file", { hasText: "Renamed by E2E" })).toHaveCount(0);
  if (isMobile) await noHorizontalScroll(page);
});

test("video download: pause, resume, finish, save to device", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "desktop only");
  await signIn(page);
  await page.locator("#urls").fill(SLOW);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.locator("article.preview h3").first()).toBeVisible();
  await page.getByRole("radio", { name: "Video" }).click();
  await page.getByLabel("Quality").selectOption("720");
  await page.getByRole("button", { name: /Download 1 item/ }).click();
  await page.getByRole("button", { name: "View queue" }).click();

  const job = page.locator("li.job").first();
  await expect(job.locator(".pill")).toHaveText(/Downloading/, { timeout: 30_000 });
  await expect(job.locator(".job-stats")).toContainText(/MB\/s/);
  await shot(page, "05-queue-progress");
  await job.getByRole("button", { name: "Pause" }).click();
  await expect(job.locator(".pill")).toHaveText("Paused");
  await job.getByRole("button", { name: "Resume" }).click();
  await expect(job.locator(".pill")).toHaveText(/Downloading|Working|Starting/);

  await page.getByRole("tab", { name: /History/ }).click();
  const done = page.locator("li.job.is-completed").first();
  await expect(done).toBeVisible({ timeout: 90_000 });
  const download = page.waitForEvent("download");
  await done.getByRole("button", { name: "Save to device" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.mp4$/);
});

test("friendly error for an unsupported link", async ({ page }) => {
  await signIn(page);
  await page.locator("#urls").fill("https://example.com/");
  await page.keyboard.press("Enter");
  await expect(page.locator("article.preview.is-error")).toContainText(/Unsupported site|Can't preview/, { timeout: 60_000 });
  await shot(page, "06-error");
});

test("settings sync to the server and survive a reload; presets", async ({ page, isMobile }) => {
  await signIn(page);
  await page.getByRole("link", { name: /Settings/ }).first().click();
  await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Dark" }).click();
  await page.getByRole("radio", { name: "Signal green" }).click();
  await expect(page.locator(".sync-badge")).toHaveText(/Synced/, { timeout: 10_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // Wipe the local cache: settings must come back from the backend.
  await page.evaluate(() => {
    const keep = localStorage.getItem("dubdeck.session");
    localStorage.clear();
    if (keep) localStorage.setItem("dubdeck.session", keep);
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("radio", { name: "Signal green" })).toHaveAttribute("aria-checked", "true");
  await shot(page, "07-settings-dark");
  if (isMobile) await noHorizontalScroll(page);

  // Rename and reorder a preset.
  const first = page.locator("li.preset").first();
  const name = (await first.locator(".preset-name").innerText()).split("\n")[0];
  await first.getByRole("button", { name: `Move ${name} down` }).click();
  await expect(page.locator("li.preset").nth(1)).toContainText(name);
  await page.locator("li.preset").nth(1).getByRole("button", { name: `Rename ${name}` }).click();
  await page.getByLabel("Preset name").fill("My favourite");
  await page.keyboard.press("Enter");
  await expect(page.locator("li.preset").nth(1)).toContainText("My favourite");
  await expect(page.locator(".sync-badge")).toHaveText(/Synced/, { timeout: 10_000 });

  // Restore light theme for the other tests' screenshots.
  await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Light" }).click();
  await page.getByRole("radio", { name: "Tape orange" }).click();
  await expect(page.locator(".sync-badge")).toHaveText(/Synced/, { timeout: 10_000 });
});

test("navigation and layout at this viewport", async ({ page, isMobile }) => {
  await signIn(page);
  for (const name of ["Queue", "Library", "Settings", "Download"]) {
    await page.getByRole("link", { name: new RegExp(name) }).first().click();
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, `08-nav-${name.toLowerCase()}`);
  }
  if (isMobile) {
    await expect(page.locator(".bottombar")).toBeVisible();
    await expect(page.locator(".sidebar")).toBeHidden();
  } else {
    await expect(page.locator(".sidebar")).toBeVisible();
    await page.keyboard.press("Alt+3");
    await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
  }
});

test("sign out returns to the sign-in screen", async ({ page }) => {
  await signIn(page);
  await page.locator(".user-chip-btn:visible").first().click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByLabel(/Developer sign-in/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/Developer sign-in/)).toBeVisible();
});
