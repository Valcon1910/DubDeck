import { expect, test, type Page } from "@playwright/test";

// Hexdrift: the built-in racing game. Uses the DEV-only window.__hexdrift hook.
type Hook = { autopilot: boolean; hasGhost: boolean; race: { phase: string; tick: number; inputs: number[]; car: { speed: number; x: number; z: number } } };
const hook = (page: Page) => page.evaluate(() => {
  const g = (window as unknown as { __hexdrift?: Hook }).__hexdrift;
  return g ? { phase: g.race.phase, tick: g.race.tick, speed: g.race.car.speed, inputs: g.race.inputs.length, ghost: g.hasGhost, x: g.race.car.x, z: g.race.car.z } : null;
});
const autopilot = (page: Page) => page.evaluate(() => { (window as unknown as { __hexdrift: Hook }).__hexdrift.autopilot = true; });

async function fresh(page: Page, map: string) {
  await page.goto(`/#/hexdrift/${map}`);
  await expect.poll(async () => (await hook(page)) !== null).toBe(true);
  await page.evaluate((m) => (window as unknown as { __hexdriftClear: (m: string) => Promise<void> }).__hexdriftClear(m), map);
  await page.reload();
  await expect.poll(async () => (await hook(page)) !== null).toBe(true);
}

test("Games page opens Hexdrift and its five maps", async ({ page }) => {
  await page.goto("/#/games");
  await page.getByRole("link", { name: /Hexdrift/ }).click();
  await expect(page).toHaveURL(/#\/hexdrift$/);
  await expect(page.getByRole("heading", { name: "HEXDRIFT" })).toBeVisible();
  await expect(page.locator(".hx-map")).toHaveCount(5);
  await page.getByRole("link", { name: /Back to Vortex/ }).click();
  await expect(page).toHaveURL(/#\/games$/);
});

test("driving: countdown, gas moves the car, R restarts, pause", async ({ page }) => {
  await page.goto("/#/hexdrift/neon-downtown");
  await expect(page.locator("canvas.hx-canvas")).toBeVisible();
  await expect.poll(async () => (await hook(page))?.phase, { timeout: 20_000 }).toBe("running");
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
  await expect(page.getByRole("button", { name: "Ghosts (G)" })).toBeVisible();
  await autopilot(page);
  await expect(page.locator(".hx-split")).toHaveText("±0.000", { timeout: 60_000 });
  await expect(page.locator(".hx-final")).toHaveText(final, { timeout: 90_000 });
  await page.getByRole("link", { name: "Maps" }).click();
  await expect(page.locator(".hx-map", { hasText: "Glacier Run" })).toContainText(final);
  // Still there after a reload (stored in IndexedDB).
  await page.reload();
  await expect(page.locator(".hx-map", { hasText: "Glacier Run" })).toContainText(final);
});

test("a reload in the middle of a run puts the car back where it was", async ({ page }) => {
  await page.goto("/#/hexdrift");
  await page.locator(".hx-map", { hasText: "Desert Mirage" }).click();
  await expect.poll(async () => (await hook(page))?.phase, { timeout: 20_000 }).toBe("running");
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
  await page.goto("/#/hexdrift");
  await page.locator(".hx-map", { hasText: "Desert Mirage" }).click();
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
  await page.getByRole("link", { name: /Garage/ }).click();
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
