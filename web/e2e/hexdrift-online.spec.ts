import { expect, test } from "@playwright/test";
import { MAPS, trackOf } from "../src/hexdrift/maps.ts";
import { botRun, DEFAULT_BOT } from "../src/hexdrift/sim/bot.ts";
import { PHYSICS_V } from "../src/hexdrift/sim/race.ts";

// Hexdrift's online records against a real local Supabase (see
// supabase/tests/hexdrift.test.mjs for the setup). Skipped unless CHAT_E2E=1.
const BASE = process.env.SUPA_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.CHAT_SECRET ?? "local-test-secret-0123456789abcdef0123456789";
const SERVICE = process.env.SERVICE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

test.skip(!process.env.CHAT_E2E, "needs a local Supabase (CHAT_E2E=1)");

const login = async (email: string) =>
  (await fetch(`${BASE}/functions/v1/vortex-login`, { method: "POST", headers: { "x-vortex-email": email, "x-vortex-secret": SECRET } })).json();

test("world record ghost, server-checked finish, leaderboard and player page", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  test.setTimeout(120_000);
  const map = MAPS[0];
  await fetch(`${BASE}/rest/v1/hexdrift_records?map=eq.${map.id}`, { method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });

  // Bob sets the record first (the fastest of a few autopilot styles).
  let best = botRun(trackOf(map), DEFAULT_BOT, 120)!;
  for (const corner of [9, 12, 18]) for (const look of [3, 4]) {
    const r = botRun(trackOf(map), { corner, look, gain: 2.4 }, 120);
    if (r && r.ticks < best.ticks) best = r;
  }
  const bob = await login("bob@x.test");
  const sent = await fetch(`${BASE}/functions/v1/hexdrift-v${PHYSICS_V}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bob.access_token}`, apikey: bob.anonKey },
    body: JSON.stringify({ map: map.id, ticks: best.ticks, inputs: Buffer.from(Uint8Array.from(best.inputs)).toString("base64"), v: PHYSICS_V }),
  });
  expect(sent.status).toBe(200);

  // Ann sees it on the menu and races Bob's gold ghost.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route("**/.herenow/me", (r) => r.fulfill({ json: { email: "ann@x.test" } }));
  await page.route("**/chat-login", async (r) => {
    const res = await fetch(`${BASE}/functions/v1/vortex-login`, { method: "POST", headers: { "x-vortex-email": "ann@x.test", "x-vortex-secret": SECRET } });
    await r.fulfill({ status: res.status, contentType: "application/json", body: await res.text() });
  });
  await page.goto("/#/hexdrift");
  await page.evaluate(() => new Promise<void>((ok) => { const r = indexedDB.deleteDatabase("hexdrift"); r.onsuccess = r.onerror = r.onblocked = () => ok(); }));
  await page.reload();
  await expect(page.locator(".hx-map-li").first().locator(".hx-map-wr")).toContainText("Bob");
  await page.getByRole("link", { name: `${map.name}`, exact: false }).first().click();
  await expect(page.locator(".hx-wr-chip")).toContainText("Bob");

  // Drive it on autopilot; the server re-drives the run and ranks it.
  await page.evaluate(() => { (window as unknown as { __hexdrift: { autopilot: boolean } }).__hexdrift.autopilot = true; });
  await expect(page.locator(".hx-online")).toContainText(/Online rank #2 of 2|World record/, { timeout: 60_000 });
  await page.locator(".hx-online").getByRole("link", { name: "Leaderboard" }).click();
  await expect(page.locator(".hx-board li")).toHaveCount(2);
  await expect(page.locator(".hx-board li.me")).toContainText("(you)");
  await expect(page.locator(".hx-card").nth(2)).toContainText("2");

  // Bob's player page lists his record.
  await page.locator(".hx-board li").first().locator(".hx-board-who").click();
  await expect(page.locator(".hx-page-title")).toContainText("Bob");
  await expect(page.locator(".hx-board li").first()).toContainText(map.name);
  await expect(page.locator(".hx-board li").first()).toContainText("👑");
  await ctx.close();
});
