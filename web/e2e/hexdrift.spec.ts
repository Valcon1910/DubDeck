import { expect, test } from "@playwright/test";

// Hexdrift: the built-in racing game. Uses the DEV-only window.__hexdrift hook.
type Hook = { autopilot: boolean; race: { phase: string; tick: number; car: { speed: number } } };
const hook = (page: import("@playwright/test").Page) => page.evaluate(() => {
  const g = (window as unknown as { __hexdrift?: Hook }).__hexdrift;
  return g ? { phase: g.race.phase, tick: g.race.tick, speed: g.race.car.speed } : null;
});

test("Games page opens Hexdrift and its five maps", async ({ page }) => {
  await page.goto("/#/games");
  await page.getByRole("link", { name: /Hexdrift/ }).click();
  await expect(page).toHaveURL(/#\/hexdrift$/);
  await expect(page.getByRole("heading", { name: "HEXDRIFT" })).toBeVisible();
  await expect(page.locator(".hx-map")).toHaveCount(5);
  await page.getByRole("link", { name: /Back to Vortex/ }).click();
  await expect(page).toHaveURL(/#\/games$/);
});

test("driving: countdown, gas moves the car, R restarts", async ({ page }) => {
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
  // Pause and resume.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Paused" })).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("heading", { name: "Paused" })).toBeHidden();
});

test("the autopilot finishes a map and the best time is saved", async ({ page }) => {
  await page.goto("/#/hexdrift/glacier-run");
  await page.evaluate(() => localStorage.removeItem("hexdrift.best.glacier-run"));
  await expect.poll(async () => (await hook(page)) !== null).toBe(true);
  await page.evaluate(() => { (window as unknown as { __hexdrift: Hook }).__hexdrift.autopilot = true; });
  await expect(page.locator(".hx-final")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("First finish!")).toBeVisible();
  const final = await page.locator(".hx-final").textContent();
  await page.getByRole("link", { name: "Maps" }).click();
  await expect(page.locator(".hx-map", { hasText: "Glacier Run" })).toContainText(final!);
});
