import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Hexdrift party rooms: two pages in one browser share a stand-in for the
// live channel (fixtures/party-channel.js, used in development builds only).
// The car links need a TURN relay, so they stay "connecting" here; the room's
// flow (lobby, start, go, finish, results, back) is what's checked.
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
  // Only the host (first in) picks; the other sees the choice.
  await expect(B.getByRole("combobox")).toHaveCount(0);
  await A.getByRole("combobox").selectOption({ index: 1 });
  const mapName = (await A.getByRole("combobox").locator("option:checked").innerText()).split(" · ")[0];
  await expect(B.getByText(mapName, { exact: false })).toBeVisible();

  await B.getByRole("button", { name: "I'm ready" }).click();
  await expect(A.locator(".hx-party-list li", { hasText: "b" })).toContainText("Ready");
  await A.getByRole("button", { name: "Start", exact: true }).click();

  // Both race, with a place in the top bar, once everyone has loaded.
  for (const p of [A, B]) {
    await expect(p.locator(".hx-place")).toBeVisible({ timeout: 60_000 });
    await expect(p.getByRole("button", { name: "Restart (R)" })).toHaveCount(0);
  }
  for (const p of [A, B]) await expect(p.locator(".hx-party-wait")).toHaveCount(0, { timeout: 30_000 });
  for (const p of [A, B]) await p.evaluate(() => { (window as unknown as { __hexdrift: { autopilot: boolean } }).__hexdrift.autopilot = true; });

  for (const p of [A, B]) {
    await expect(p.getByRole("heading", { name: /Results/ })).toBeVisible({ timeout: 150_000 });
    await expect(p.locator(".hx-party-order li")).toHaveCount(2);
  }
  await expect(B.getByRole("button", { name: "Race again" })).toHaveCount(0);
  await A.getByRole("button", { name: "Back to the lobby" }).click();
  await expect(B.locator(".hx-party-list li")).toHaveCount(2);

  // Leaving: the other page sees one player.
  await B.goto("/?as=b@x.test#/hexdrift");
  await expect(A.locator(".hx-party-list li")).toHaveCount(1);
  await ctx.close();
});
