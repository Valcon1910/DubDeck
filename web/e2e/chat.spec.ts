import { expect, test, type Browser, type Page } from "@playwright/test";

// Chat against a real local Supabase. Needs `npx supabase start`,
// `npx supabase functions serve` (see supabase/tests/chat.test.mjs) and a dev
// server started with VORTEX_CHAT=1. Skipped unless CHAT_E2E=1.
const FN = process.env.CHAT_FN ?? "http://127.0.0.1:54321/functions/v1/vortex-login";
const SECRET = process.env.CHAT_SECRET ?? "local-test-secret-0123456789abcdef0123456789";

// A 2×2 red PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAwMAAAA0BAf9mBnsAAAAASUVORK5CYII=", "base64");

test.skip(!process.env.CHAT_E2E, "needs a local Supabase (CHAT_E2E=1)");

/** A browser signed in as `email`; /chat-login plays the here.now proxy route. */
async function as(browser: Browser, email: string, viewport?: { width: number; height: number }): Promise<Page> {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  await page.route("**/.herenow/me", (r) => r.fulfill({ json: { email } }));
  await page.route("**/chat-login", async (r) => {
    const res = await fetch(FN, { method: "POST", headers: { "x-vortex-email": email, "x-vortex-secret": SECRET } });
    await r.fulfill({ status: res.status, contentType: "application/json", body: await res.text() });
  });
  return page;
}

test("two people chat live: DM, unread badge, reply, edit, delete, files and seen", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  const ann = await as(browser, "ann@x.test");
  const bob = await as(browser, "bob@x.test");
  await bob.goto("/#/");
  await ann.goto("/#/chat");

  // Ann starts a DM with Bob.
  await ann.getByRole("button", { name: "New chat" }).click();
  await ann.getByRole("dialog").getByRole("button", { name: /Bob/ }).click();
  await expect(ann.locator(".vx-chat-head")).toContainText("Bob");
  const word = `hello-${Date.now()}`;
  await ann.getByLabel("Message", { exact: true }).fill(word);
  await ann.keyboard.press("Enter");
  await expect(ann.locator(".vx-msg-mine").last()).toContainText(word);

  // Bob sees the unread badge on the home tile and in the menu, live.
  await expect(bob.locator(".vx-tile .vx-unread")).toHaveText(/^[1-9]/);
  await expect(bob.locator(".vx-side-nav .vx-unread")).toBeVisible();
  await expect(bob).toHaveTitle(/^\(\d+\)/);
  await bob.locator(".vx-tile", { hasText: "Chat" }).click();
  await bob.locator(".vx-chat-item").filter({ has: bob.locator("strong", { hasText: /^Ann$/ }) }).click();
  await expect(bob.locator(".vx-msg").last()).toContainText(word);
  await expect(bob.locator(".vx-chat-item[aria-current] .vx-unread")).toHaveCount(0);

  // Ann sees "Seen"; Bob replies with a file.
  await expect(ann.locator(".vx-msg-seen")).toHaveText("Seen");

  // Typing shows bouncing dots on the other side, and they go when the text is cleared.
  await bob.getByLabel("Message", { exact: true }).pressSequentially("typ");
  await expect(ann.locator(".vx-typing")).toBeVisible();
  await bob.getByLabel("Message", { exact: true }).fill("");
  await expect(ann.locator(".vx-typing")).toHaveCount(0);
  await bob.locator(".vx-msg", { hasText: word }).hover();
  await bob.locator(".vx-msg", { hasText: word }).getByRole("button", { name: "Reply" }).click();
  await expect(bob.locator(".vx-composer-bar")).toContainText("Replying to");
  await bob.locator('.vx-composer input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("top secret notes") });
  await bob.getByLabel("Message", { exact: true }).fill(`here you go ${word}`);
  await bob.getByRole("button", { name: "Send" }).click();
  const got = ann.locator(".vx-msg", { hasText: `here you go ${word}` }).last();
  await expect(got.locator(".vx-msg-quote")).toContainText(word);
  const link = got.locator("a.vx-msg-file");
  await expect(link).toContainText("notes.txt");
  await expect(link).toHaveAttribute("href", /^https?:/);
  const href = await link.getAttribute("href");
  expect(await (await fetch(href!)).text()).toBe("top secret notes");

  // Edit and delete.
  await ann.locator(".vx-msg-mine", { hasText: word }).hover();
  await ann.locator(".vx-msg-mine", { hasText: word }).getByRole("button", { name: "Edit" }).click();
  await ann.getByLabel("Message", { exact: true }).fill(`${word} (fixed)`);
  await ann.getByRole("button", { name: "Save" }).click();
  await expect(bob.locator(".vx-msg:not(.vx-msg-mine)", { hasText: `${word} (fixed)` })).toContainText("edited");
  ann.once("dialog", (d) => d.accept());
  await ann.locator(".vx-msg-mine", { hasText: `${word} (fixed)` }).hover();
  await ann.locator(".vx-msg-mine", { hasText: `${word} (fixed)` }).getByRole("button", { name: "Delete" }).click();
  await expect(bob.locator(".vx-bubble-deleted").first()).toHaveText(/Message deleted/);
});

test("groups: create with an icon, add and remove people, outsiders can't see it", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  const ann = await as(browser, "ann@x.test");
  const cy = await as(browser, "cy@x.test");
  const bob = await as(browser, "bob@x.test");
  await ann.goto("/#/chat");
  await cy.goto("/#/chat");
  await bob.goto("/#/chat");
  const name = `Squad ${Date.now() % 100000}`;

  await ann.getByRole("button", { name: "New group" }).click();
  const dlg = ann.getByRole("dialog");
  await dlg.locator('input[type="file"]').setInputFiles({ name: "icon.png", mimeType: "image/png", buffer: PNG });
  await expect(dlg.locator(".vx-group-icon img")).toBeVisible();
  await dlg.getByLabel("Group name").fill(name);
  await dlg.getByRole("button", { name: /Bob/ }).click();
  await dlg.getByRole("button", { name: "Create group" }).click();
  await expect(ann.locator(".vx-chat-head")).toContainText(name);
  await expect(ann.locator(".vx-chat-head img")).toBeVisible();
  await ann.getByLabel("Message", { exact: true }).fill("welcome!");
  await ann.keyboard.press("Enter");

  await expect(bob.locator(".vx-chat-item", { hasText: name })).toContainText("welcome!");
  await expect(cy.locator(".vx-chat-item", { hasText: name })).toHaveCount(0);

  // Ann adds Cy; Cy sees it. Then removes Bob; Bob loses it.
  await ann.getByRole("button", { name: "Group info" }).click();
  await ann.getByRole("button", { name: "Add people" }).click();
  await ann.getByRole("dialog").getByRole("button", { name: /Cy/ }).click();
  await ann.getByRole("dialog").getByRole("button", { name: /^Add 1/ }).click();
  await expect(cy.locator(".vx-chat-item", { hasText: name })).toBeVisible();
  await ann.getByRole("dialog").locator(".vx-chat-person", { hasText: "bob@x.test" }).getByRole("button", { name: "Remove" }).click();
  await expect(bob.locator(".vx-chat-item", { hasText: name })).toHaveCount(0);
  await expect(ann.getByRole("dialog")).toContainText("2 members");
});

test("phone: list and conversation are separate screens", async ({ browser }) => {
  const ann = await as(browser, "ann@x.test", { width: 360, height: 760 });
  await ann.goto("/#/chat");
  await ann.locator(".vx-chat-item").first().click();
  await expect(ann.locator(".vx-chat-list")).toBeHidden();
  await expect(ann.getByLabel("Message", { exact: true })).toBeVisible();
  await ann.getByRole("link", { name: "Back to chats" }).click();
  await expect(ann.locator(".vx-chat-list")).toBeVisible();
  const width = await ann.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);
});
