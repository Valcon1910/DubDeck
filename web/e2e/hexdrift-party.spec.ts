import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Hexdrift party rooms: two pages in one browser share a stand-in for the
// live channel (fixtures/party-channel.js, used in development builds only).
// flow (lobby, laps, the month's guard, start, go, finish, podium, back) is
// what's checked; a circuit's laps are checked in the sim (a lap here would
// take minutes with software graphics).
const FAKE = fileURLToPath(new URL("./fixtures/party-channel.js", import.meta.url));

test("Party: two players join a room, race and see the results", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only (two 3D pages at once)");
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await ctx.addInitScript({ path: FAKE });
  const A = await ctx.newPage(), B = await ctx.newPage();

  await A.goto("/?as=a@x.test#/hexdrift/party");
  await A.getByRole("button", { name: "Make a room" }).click();
  await expect(A).toHaveURL(/#\/hexdrift\/party\/[A-Z]{6}$/);
  const code = A.url().split("/").pop()!;
  await expect(A.getByRole("textbox", { name: "Room link" })).toHaveValue(new RegExp(`#/hexdrift/party/${code}$`));

  await B.goto("/?as=b@x.test#/hexdrift/party");
  await B.getByLabel("Room code").fill(code.toLowerCase());
  await B.getByRole("button", { name: "Join" }).click();
  await expect(B.locator(".hx-party-list li")).toHaveCount(2);
  await expect(A.locator(".hx-party-list li")).toHaveCount(2);
  // Only the host (first in) picks; the other sees the choice. Circuits have laps.
  await expect(B.getByRole("combobox")).toHaveCount(0);
  await expect(A.getByRole("combobox")).toHaveValue("sunset-ring");
  await A.getByRole("radio", { name: "2", exact: true }).click();
  await expect(B.getByText("Sunset Ring")).toBeVisible();
  await expect(B.getByText("2 laps")).toBeVisible();
  // A sprint (start to finish): no laps to pick.
  await A.getByRole("combobox").selectOption("neon-downtown");
  await expect(A.getByRole("radiogroup", { name: "Laps" })).toHaveCount(0);
  await expect(B.getByText("Neon Downtown")).toBeVisible();

  // Near the month's allowance of live messages, no new races.
  await A.evaluate(() => { (window as unknown as { __hxUsage: number }).__hxUsage = 1_900_000; });
  await A.getByRole("button", { name: "Start anyway" }).click();
  await expect(A.getByText(/resting until next month/)).toBeVisible();
  await A.evaluate(() => { delete (window as unknown as { __hxUsage?: number }).__hxUsage; });

  await B.getByRole("button", { name: "I'm ready" }).click();
  await expect(A.locator(".hx-party-list li", { hasText: "b" })).toContainText("Ready");
  await A.getByRole("button", { name: "Start", exact: true }).click();
  await expect(A.getByText(/resting until next month/)).toHaveCount(0);

  // Both race, with a place in the top bar, once everyone has loaded.
  for (const p of [A, B]) {
    await expect(p.locator(".hx-place")).toBeVisible({ timeout: 60_000 });
    await expect(p.getByRole("button", { name: "Restart (R)" })).toHaveCount(0);
  }
  for (const p of [A, B]) await expect(p.locator(".hx-party-wait")).toHaveCount(0, { timeout: 30_000 });
  for (const p of [A, B]) await p.evaluate(() => { (window as unknown as { __hexdrift: { autopilot: boolean } }).__hexdrift.autopilot = true; });

  // Lined up side by side on the grid, then the race (the cars bump, so both just need to get there).
  for (const p of [A, B]) {
    await expect(p.getByRole("heading", { name: /wins?!/ })).toBeVisible({ timeout: 150_000 });
    await expect(p.locator(".hx-party-order li")).toHaveCount(2);
  }
  // Car updates go only when something changes: well under the 8 a second allowed.
  const sent = await A.evaluate(() => (window as unknown as { __hxBroadcasts: number }).__hxBroadcasts);
  expect(sent).toBeGreaterThan(5);
  await expect(B.getByRole("button", { name: "Race again" })).toHaveCount(0);
  await A.getByRole("button", { name: "Back to the lobby" }).click();
  await expect(B.locator(".hx-party-list li")).toHaveCount(2);

  // A community map: the host searches and picks one, everyone loads that exact version.
  await A.getByRole("button", { name: "Community map…" }).click();
  await A.getByRole("button", { name: /Party Test Map/ }).click();
  await expect(A.getByRole("combobox")).toHaveValue("cpartyt01-abc123");
  await expect(B.getByText("Party Test Map")).toBeVisible();
  await A.getByRole("button", { name: /^Start/ }).click();
  for (const p of [A, B]) await expect(p.locator(".hx-place")).toBeVisible({ timeout: 60_000 });

  // Leaving: the other page sees one player.
  await B.goto("/?as=b@x.test#/hexdrift");
  await A.reload();
  await expect(A.locator(".hx-party-list li")).toHaveCount(1);
  await ctx.close();
});
