import { expect, test, type Page } from "@playwright/test";

// Hexdrift: the built-in racing game. Uses the DEV-only window.__hexdrift hook.
type Hook = { autopilot: boolean; hasGhost: boolean; race: { phase: string; tick: number; inputs: number[]; car: { speed: number; x: number; z: number } } };
const hook = (page: Page) => page.evaluate(() => {
  const g = (window as unknown as { __hexdrift?: Hook }).__hexdrift;
  return g ? { phase: g.race.phase, tick: g.race.tick, speed: g.race.car.speed, inputs: g.race.inputs.length, ghost: g.hasGhost, x: g.race.car.x, z: g.race.car.z } : null;
});
const autopilot = (page: Page) => page.evaluate(() => { (window as unknown as { __hexdrift: Hook }).__hexdrift.autopilot = true; });

// Skips the race-start cutscene (any key), then waits out the countdown. With
// software rendering frames are slow and the game clock runs behind real time,
// so sitting through the whole cutscene left no margin.
async function toGreenLight(page: Page) {
  await expect.poll(async () => (await hook(page)) !== null).toBe(true);
  await page.keyboard.press("x");
  await expect.poll(async () => (await hook(page))?.phase, { timeout: 30_000 }).toBe("running");
}

async function fresh(page: Page, map: string) {
  await page.goto(`/#/hexdrift/${map}`);
  await expect.poll(async () => (await hook(page)) !== null).toBe(true);
  await page.evaluate((m) => (window as unknown as { __hexdriftClear: (m: string) => Promise<void> }).__hexdriftClear(m), map);
  await page.reload();
  await expect.poll(async () => (await hook(page)) !== null).toBe(true);
}

test("Games page opens Hexdrift: title, five maps, a map's page, then the race", async ({ page }) => {
  await page.goto("/#/games");
  await page.getByRole("link", { name: /Hexdrift/ }).click();
  await expect(page).toHaveURL(/#\/hexdrift$/);
  await expect(page.getByRole("heading", { name: "HEXDRIFT" })).toBeVisible();
  await page.getByRole("link", { name: "Play" }).click();
  await expect(page.locator(".hx-map")).toHaveCount(5);
  await page.locator(".hx-map", { hasText: "Canyon Rush" }).click();
  await expect(page.getByRole("heading", { name: "Canyon Rush" })).toBeVisible();
  await expect(page.locator(".hx-detail-blurb")).not.toBeEmpty();
  await page.getByRole("link", { name: "Race" }).click();
  await expect(page).toHaveURL(/#\/hexdrift\/canyon-rush$/);
  // The race-start cutscene plays, and a key press skips it.
  await expect(page.locator(".hx-intro")).toBeVisible();
  await page.keyboard.press("x");
  await expect(page.locator(".hx-intro")).toBeHidden({ timeout: 10000 });
  await page.goto("/#/hexdrift");
  await page.getByRole("link", { name: /Back to Vortex/ }).click();
  await expect(page).toHaveURL(/#\/games$/);
});

test("driving: countdown, gas moves the car, R restarts, pause", async ({ page }) => {
  await page.goto("/#/hexdrift/neon-downtown");
  await expect(page.locator("canvas.hx-canvas")).toBeVisible();
  await toGreenLight(page);
  await page.keyboard.down("ArrowUp");
  await expect.poll(async () => (await hook(page))?.speed ?? 0).toBeGreaterThan(10);
  await page.keyboard.up("ArrowUp");
  await expect(page.locator(".hx-time")).not.toHaveText("0:00.000");
  await page.keyboard.press("r");
  expect((await hook(page))?.phase).toBe("countdown");
  await expect(page.locator(".hx-time")).toHaveText("0:00.000");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Paused" })).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("heading", { name: "Paused" })).toBeHidden();
});

test("a finished run is saved, then raced as a ghost with live splits", async ({ page }) => {
  await fresh(page, "glacier-run");
  expect((await hook(page))?.ghost).toBe(false);
  await autopilot(page);
  await expect(page.locator(".hx-final")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("First finish!")).toBeVisible();
  const final = (await page.locator(".hx-final").textContent())!;
  // The new best becomes the ghost; the same drive again matches it exactly.
  await expect.poll(async () => (await hook(page))?.ghost).toBe(true);
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await autopilot(page);
  await expect(page.locator(".hx-split")).toHaveText("±0.000", { timeout: 60_000 });
  await expect(page.locator(".hx-final")).toHaveText(final, { timeout: 90_000 });
  await page.getByRole("link", { name: "Maps" }).click();
  await expect(page.locator(".hx-map", { hasText: "Glacier Run" })).toContainText(final);
  await page.locator(".hx-map", { hasText: "Glacier Run" }).click();
  await expect(page.locator(".hx-detail-best")).toContainText(final);
  // Still there after a reload (stored in IndexedDB).
  await page.reload();
  await expect(page.locator(".hx-detail-best")).toContainText(final);
});

test("a reload in the middle of a run puts the car back where it was", async ({ page }) => {
  await page.goto("/#/hexdrift/desert-mirage");
  await toGreenLight(page);
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(2600);
  await page.evaluate(() => (window as unknown as { __hexdrift: { setPaused(p: boolean): void } }).__hexdrift.setPaused(true));
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(2200); // the run is saved every 2 seconds
  const before = (await hook(page))!;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Run restored" })).toBeVisible();
  const after = (await hook(page))!;
  expect(after.inputs).toBe(before.inputs);
  expect(after.x).toBeCloseTo(before.x, 6);
  expect(after.z).toBeCloseTo(before.z, 6);
  await page.getByRole("button", { name: "Carry on" }).click();
  await expect(page.getByRole("heading", { name: "Run restored" })).toBeHidden();
  // Going back to the maps ends it: no restore next time.
  await page.goto("/#/hexdrift/maps");
  await expect(page.locator(".hx-map")).toHaveCount(5);
  await page.goto("/#/hexdrift/desert-mirage");
  await expect.poll(async () => (await hook(page))?.phase).toBe("countdown");
});

test("Gaming Mode: one tap on, Back and links stay in the game, hold 3 s to turn off", async ({ page }) => {
  await page.goto("/#/hexdrift");
  await page.getByRole("button", { name: "Turn on Gaming Mode" }).click();
  const on = page.getByRole("button", { name: /Gaming Mode is on/ });
  await expect(on).toBeVisible();
  await expect(page.getByRole("link", { name: /Back to Vortex/ })).toHaveCount(0);
  await page.evaluate(() => { location.hash = "#/games"; });
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/#\/hexdrift$/);
  await expect(page.getByRole("heading", { name: "HEXDRIFT" })).toBeVisible();
  await page.goBack();
  await page.waitForTimeout(300);
  await expect(page.getByRole("heading", { name: "HEXDRIFT" })).toBeVisible();
  // A short press does nothing; holding for 3 seconds turns it off.
  const box = (await on.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up();
  await expect(on).toBeVisible();
  await page.mouse.down(); await page.waitForTimeout(3300); await page.mouse.up();
  await expect(page.getByRole("button", { name: "Turn on Gaming Mode" })).toBeVisible();
  await page.getByRole("link", { name: /Back to Vortex/ }).click();
  await expect(page).toHaveURL(/#\/games$/);
});

test("garage: free parts equip and stay, locked parts preview only, and the car uses the look", async ({ page }) => {
  await page.goto("/#/hexdrift");
  await page.getByRole("link", { name: /Garage/ }).first().click();
  await expect(page.locator(".hx-page-title")).toHaveText("Garage");
  await expect(page.locator(".hx-points")).toContainText("/ 20 medal points");
  // A free paint equips and is remembered.
  await page.getByRole("tab", { name: "Paint" }).click();
  await page.getByRole("button", { name: /^Ocean/ }).click();
  await expect(page.getByRole("button", { name: /^Ocean/ })).toHaveAttribute("aria-pressed", "true");
  // A locked car can be looked at but not equipped.
  await page.getByRole("tab", { name: "Car" }).click();
  await page.getByRole("button", { name: /^Formula X/ }).click();
  await expect(page.locator(".hx-preview-lock")).toContainText("Formula X: unlocks at 12 medal points");
  await expect(page.getByRole("button", { name: /^Grand Coupe/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^Cyber Rig/ }).click();
  await page.reload();
  await page.getByRole("tab", { name: "Paint" }).click();
  await expect(page.getByRole("button", { name: /^Ocean/ })).toHaveAttribute("aria-pressed", "true");
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem("hexdrift.look") ?? "{}"))).toMatchObject({ body: "rig", paint: "ocean" });
  // The game still starts with the new car.
  await page.goto("/#/hexdrift/neon-downtown");
  await expect(page.locator(".hx-time")).toBeVisible();
});

test("times from older physics keep their medal on maps that didn't change; changed maps drop them", async ({ page }) => {
  await page.goto("/#/hexdrift");
  await page.evaluate(() => {
    // An old step-1 style save: v4 (still counts) and v1 (from before the maps changed).
    localStorage.setItem("hexdrift.best.desert-mirage", JSON.stringify({ t: 1300, i: btoa("\u0010"), at: 1, v: 4 }));
    localStorage.setItem("hexdrift.best.canyon-rush", JSON.stringify({ t: 900, i: btoa("\u0010"), at: 1, v: 1 }));
  });
  await page.goto("/#/hexdrift/maps");
  await expect(page.locator(".hx-map", { hasText: "Desert Mirage" })).toContainText("0:21.667");
  await expect(page.locator(".hx-map", { hasText: "Desert Mirage" }).locator(".hx-medal-gold")).toBeVisible();
  await expect(page.locator(".hx-map", { hasText: "Canyon Rush" })).not.toContainText("0:15.000");
  await page.evaluate(() => localStorage.removeItem("hexdrift.legacy"));
});

test("keyboard hints show only where there's a keyboard", async ({ page, isMobile }) => {
  await page.goto("/#/hexdrift");
  await expect(page.locator(".hx-help")).toHaveCount(isMobile ? 0 : 1);
});

test("Map editor: make a map, add pieces, undo, drive it and set the author time", async ({ page, isMobile }) => {
  test.setTimeout(150_000);
  await page.goto("/#/hexdrift");
  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "My maps" })).toBeVisible();
  await page.locator(".hx-ed-theme", { hasText: "Baja" }).click();
  await expect(page).toHaveURL(/#\/hexdrift\/editor\/u[0-9a-z]+$/);
  // Computers open the studio: its road panel leads to the tiles.
  if (!isMobile) await page.getByRole("link", { name: "Edit tiles" }).click();
  // A starter track on the grid: tiles go in where the arrow is, before the finish.
  const info = page.locator(".hx-ed-info");
  await expect(info).toContainText("7 tiles");
  await page.getByRole("button", { name: "Curve right", exact: true }).click();
  await page.getByRole("button", { name: "Straight", exact: true }).click();
  await expect(info).toContainText("9 tiles");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(info).toContainText("8 tiles");
  // Edits are kept on the device.
  await page.reload();
  await expect(info).toContainText("8 tiles");
  await expect(page.locator(".hx-ed-problems")).toHaveCount(0);
  await expect(page.locator(".hx-ed-info")).toContainText("Drive to the finish");
  await page.getByRole("link", { name: "Drive" }).click();
  await expect(page).toHaveURL(/#\/hexdrift\/test\/u/);
  await expect.poll(async () => (await hook(page)) !== null).toBe(true);
  await autopilot(page);
  await expect(page.locator(".hx-finish")).toContainText("New author time", { timeout: 120_000 });
  await page.getByRole("link", { name: "Back to editor" }).click();
  await expect(page.locator(".hx-ed-info")).toContainText("Author");
});

test("Map editor: maps made from pieces still open in the piece editor", async ({ page }) => {
  await page.goto("/#/hexdrift");
  await page.evaluate(() => localStorage.setItem("hexdrift.mymaps.v1", JSON.stringify([{ v: 1, id: "upieces01", name: "Old map", theme: "miami", updated: 1,
    pieces: [{ k: "S", len: 80 }, { k: "R", a: 90, r: 60 }, { k: "S", len: 100 }, { k: "C" }, { k: "O", r: 14 }, { k: "S", len: 120 }] }])));
  await page.goto("/#/hexdrift/editor/upieces01");
  await expect(page.locator(".hx-ed-piece")).toHaveCount(6);
  await expect(page.locator(".hx-ed-piece").nth(4)).toContainText("Loop 14 m");
  await page.evaluate(() => localStorage.removeItem("hexdrift.mymaps.v1"));
});

test("Studio: insert parts and objects, edit, undo, folders, drive from here", async ({ page, isMobile }) => {
  test.skip(isMobile, "The studio is for computers");
  await page.goto("/#/hexdrift");
  await page.evaluate(() => localStorage.setItem("hexdrift.mymaps.v1", JSON.stringify([{ v: 1, id: "ustudio01", name: "Studio map", theme: "miami", updated: 1,
    pieces: [{ k: "S", len: 80 }, { k: "R", a: 90, r: 60 }, { k: "S", len: 100 }, { k: "C" }, { k: "L", a: 90, r: 60 }, { k: "S", len: 120 }] }])));
  await page.goto("/#/hexdrift/editor/ustudio01");
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("hexdrift.mymaps.v1")!)[0]);
  // The road panel is the piece editor's.
  await expect(page.locator(".hx-ed-piece")).toHaveCount(6);
  await page.getByRole("button", { name: "+ Insert" }).click();
  await page.getByRole("button", { name: "Block", exact: true }).click();
  await expect(page.locator(".hx-st-props h2")).toHaveText("Block");
  // Typed values are kept.
  const x = page.getByLabel("Position X", { exact: true });
  await x.fill("25");
  await x.press("Enter");
  await expect.poll(async () => (await saved()).parts?.[0]?.p[0]).toBe(25);
  await page.getByRole("button", { name: "Bouncy" }).click();
  await expect.poll(async () => (await saved()).parts?.[0]?.m).toBe("bouncy");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await saved()).parts?.[0]?.m).toBeUndefined();
  // A ready-made crane comes in its own folder.
  await page.getByRole("button", { name: "+ Insert" }).click();
  await page.getByRole("button", { name: "Crane" }).click();
  await expect(page.getByLabel("Folder name")).toHaveValue("Crane");
  await expect.poll(async () => (await saved()).parts?.length).toBe(9);
  // Objects from the theme's kit.
  await page.getByRole("button", { name: "+ Insert" }).click();
  await page.locator(".hx-st-objs .hx-chip-btn").first().click();
  await expect.poll(async () => (await saved()).objs?.length).toBe(1);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await saved()).objs?.length ?? 0).toBe(0);
  // The sky.
  await page.getByRole("button", { name: "Sky and land" }).click();
  await page.getByRole("button", { name: "Snow" }).click();
  await expect.poll(async () => (await saved()).env?.weather).toBe("snow");
  // A practice run from the middle of the view.
  await page.getByRole("button", { name: "Drive from here" }).click();
  await expect(page).toHaveURL(/#\/hexdrift\/test\/ustudio01\?from=/);
  await expect.poll(async () => (await hook(page)) !== null).toBe(true);
  await page.evaluate(() => localStorage.removeItem("hexdrift.mymaps.v1"));
});
