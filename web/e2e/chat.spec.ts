import { expect, test, type Browser, type Page } from "@playwright/test";

// Chat against a real local Supabase. Needs `npx supabase start`,
// `npx supabase functions serve` (see supabase/tests/chat.test.mjs) and a dev
// server started with VORTEX_CHAT=1. Skipped unless CHAT_E2E=1.
const FN = process.env.CHAT_FN ?? "http://127.0.0.1:54321/functions/v1/vortex-login";
const SECRET = process.env.CHAT_SECRET ?? "local-test-secret-0123456789abcdef0123456789";

// A 2-frame 2×2 GIF (red, then blue).
const GIF2 = Buffer.from("R0lGODlhAgACAPABAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAACAoRRACH5BAAKAAAALAAAAAACAAIAgAAA/wAAAAIChFEAOw==", "base64");
// A 2×2 red PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAwMAAAA0BAf9mBnsAAAAASUVORK5CYII=", "base64");

test.skip(!process.env.CHAT_E2E, "needs a local Supabase (CHAT_E2E=1)");

/** A browser signed in as `email`; /chat-login plays the here.now proxy route. */
async function as(browser: Browser, email: string, viewport?: { width: number; height: number }, tour = false): Promise<Page> {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  if (!tour) await page.addInitScript(() => { try { localStorage.setItem("vortex.chatTour", "1"); } catch { /* */ } });
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

// A 1×1 GIF.
const GIF = Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

test("popups, media players, and swiping a chat away", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  const own = await as(browser, "own@x.test");
  const cy = await as(browser, "cy@x.test");
  await cy.goto("/#/");
  await own.goto("/#/chat");
  await own.getByRole("button", { name: "New chat" }).click();
  await own.getByRole("dialog").getByRole("button", { name: /Cy/ }).click();
  await expect(own.locator(".vx-chat-head")).toContainText("Cy");

  // A new message pops up in the top right on another page; tapping it opens the chat.
  const word = `ping-${Date.now()}`;
  await own.getByLabel("Message", { exact: true }).fill(word);
  await own.keyboard.press("Enter");
  const pop = cy.locator(".vx-pop", { hasText: word });
  await expect(pop).toBeVisible();
  await pop.locator(".vx-pop-main").click();
  await expect(cy.locator(".vx-msg").last()).toContainText(word);
  await expect(cy.locator(".vx-pop")).toHaveCount(0);

  // A GIF (pausable) and a video (own player with a download link).
  await own.locator('.vx-composer input[type="file"]').setInputFiles([
    { name: "dance.gif", mimeType: "image/gif", buffer: GIF },
    { name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("not really a video") },
  ]);
  await own.getByRole("button", { name: "Send" }).click();
  const gif = cy.locator(".vx-gif").last();
  await expect(gif.locator("img")).toBeVisible();
  await gif.getByRole("button", { name: /GIF/ }).click();
  await expect(gif.getByRole("button", { name: "Play GIF" })).toBeVisible();
  const vp = cy.locator(".vx-vp").last();
  await expect(vp.getByRole("button", { name: "Play clip.mp4" })).toBeVisible();
  await expect(vp.getByRole("link", { name: "Download clip.mp4" })).toHaveAttribute("href", /download=clip\.mp4/);
  // Pictures open full screen with a download button.
  await gif.getByRole("button", { name: "Open dance.gif" }).click();
  await expect(cy.locator(".vx-viewer").getByRole("link", { name: "Download" })).toBeVisible();
  await cy.keyboard.press("Escape");
  await expect(cy.locator(".vx-viewer")).toHaveCount(0);

  // Gaming Mode on (kept through a reload): no popups.
  await cy.goto("/#/");
  await cy.evaluate(() => sessionStorage.setItem("vortex.gaming", "1"));
  await cy.reload();
  await own.getByLabel("Message", { exact: true }).fill(`quiet-${word}`);
  await own.keyboard.press("Enter");
  await expect(cy.locator(".vx-side-nav .vx-unread, .vx-tile .vx-unread").first()).toBeVisible();
  await expect(cy.locator(".vx-pop")).toHaveCount(0);
  await cy.evaluate(() => sessionStorage.removeItem("vortex.gaming"));

  // Swipe the chat left, Delete, confirm: it leaves Cy's list (Own keeps it).
  await cy.reload(); // Gaming Mode off (it keeps links inside the game while on)
  await cy.goto("/#/chat");
  const row = cy.locator(".vx-chat-item").filter({ has: cy.locator("strong", { hasText: /^Own/ }) });
  const b = (await row.boundingBox())!;
  await cy.mouse.move(b.x + b.width - 20, b.y + b.height / 2);
  await cy.mouse.down();
  for (let i = 1; i <= 8; i++) await cy.mouse.move(b.x + b.width - 20 - i * 25, b.y + b.height / 2);
  await cy.mouse.up();
  await cy.locator(".vx-swipe-open").getByRole("button", { name: "Delete" }).click();
  await expect(cy.getByRole("dialog")).toContainText("keeps their copy");
  await cy.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);
  await expect(own.locator(".vx-msg").first()).toBeVisible();

  // A new message brings it back, without the old history.
  await own.getByLabel("Message", { exact: true }).fill(`again-${word}`);
  await own.keyboard.press("Enter");
  await expect(row).toBeVisible();
  await row.click();
  await expect(cy.locator(".vx-msg").last()).toContainText(`again-${word}`);
  await expect(cy.locator(".vx-msg", { hasText: word }).filter({ hasNotText: "again" })).toHaveCount(0);
});

test("first visit tour, emoji reactions live, and a cropped GIF picture", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  const ann = await as(browser, "ann@x.test", undefined, true);
  const bob = await as(browser, "bob@x.test");

  // The tour lights up your picture, then the picture and name in Settings.
  await ann.goto("/#/chat");
  const tour = ann.locator(".vx-tour");
  await expect(tour).toContainText("Your profile");
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour).toContainText("Change your picture");
  await expect(ann.locator("#vx-settings-title")).toBeVisible();
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour).toContainText("Change your name");
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour).toContainText("Find it again");
  await expect(ann.locator("#vx-settings-title")).toHaveCount(0);
  await tour.getByRole("button", { name: "Next" }).click();
  await tour.getByRole("button", { name: "Got it" }).click();
  await expect(tour).toHaveCount(0);
  await ann.reload();
  await expect(ann.locator(".vx-chat-list-head")).toBeVisible();
  await expect(tour).toHaveCount(0);

  // Ann reacts to her own message; Bob sees it live and adds his.
  await ann.getByRole("button", { name: "New chat" }).click();
  await ann.getByRole("dialog").getByRole("button", { name: /Bob/ }).click();
  const word = `react-${Date.now()}`;
  await ann.getByLabel("Message", { exact: true }).fill(word);
  await ann.keyboard.press("Enter");
  const annMsg = ann.locator(".vx-msg", { hasText: word });
  await annMsg.hover();
  await annMsg.getByRole("button", { name: "React" }).click();
  await ann.getByRole("menuitem", { name: "🔥" }).click();
  await expect(annMsg.locator(".vx-react.mine")).toContainText("1");

  await bob.goto("/#/chat");
  await bob.locator(".vx-chat-item").filter({ has: bob.locator("strong", { hasText: /^Ann$/ }) }).click();
  const bobMsg = bob.locator(".vx-msg", { hasText: word });
  await expect(bobMsg.locator(".vx-reacts .vx-react")).toContainText("🔥1");
  await bobMsg.locator(".vx-react", { hasText: "🔥" }).click();
  await expect(annMsg.locator(".vx-reacts .vx-react")).toContainText("🔥2");
  await bobMsg.locator(".vx-react", { hasText: "🔥" }).click();
  await expect(annMsg.locator(".vx-reacts .vx-react")).toContainText("🔥1");

  // A GIF picture is cropped in place and stays a GIF (so it keeps moving).
  await ann.locator(".vx-chat-me").click();
  const chooser = ann.waitForEvent("filechooser");
  await ann.getByRole("button", { name: "Change picture" }).click();
  await (await chooser).setFiles({ name: "me.gif", mimeType: "image/gif", buffer: GIF2 });
  await expect(ann.getByRole("heading", { name: "Crop your picture" })).toBeVisible();
  await ann.getByLabel("Zoom").fill("2");
  await ann.getByRole("button", { name: "Use picture" }).click();
  const img = ann.locator(".vx-set-profile .vx-avatar img");
  await expect(img).toHaveAttribute("src", /^data:image\/gif/);
  await expect(img).toHaveCSS("transform", /matrix\(2, 0, 0, 2/);
  // Everyone gets the uploaded GIF, with the same crop.
  await expect(bob.locator(".vx-chat-head .vx-avatar img")).toHaveAttribute("src", /\/pics\/.*\.gif$/, { timeout: 15_000 });
  await expect(bob.locator(".vx-chat-head .vx-avatar img")).toHaveCSS("transform", /matrix\(2, 0, 0, 2/);
});

test("group set so only admins can send: members read and react but can't write", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  const ann = await as(browser, "ann@x.test");
  const bob = await as(browser, "bob@x.test");
  await ann.goto("/#/chat");
  await ann.getByRole("button", { name: "New group" }).click();
  const name = `Notices ${Date.now() % 100000}`;
  await ann.getByLabel("Group name").fill(name);
  await ann.getByLabel("Only admins can send messages").check();
  await ann.getByRole("dialog").getByRole("button", { name: /Bob/ }).click();
  await ann.getByRole("button", { name: "Create group" }).click();
  await ann.getByLabel("Message", { exact: true }).fill("admins only here");
  await ann.keyboard.press("Enter");
  await expect(ann.locator(".vx-msg-mine").last()).toContainText("admins only here");

  await bob.goto("/#/chat");
  await bob.locator(".vx-chat-item", { hasText: name }).click();
  await expect(bob.locator(".vx-msg").last()).toContainText("admins only here");
  await expect(bob.getByLabel("Message", { exact: true })).toHaveCount(0);
  await expect(bob.locator(".vx-chat-readonly")).toContainText("Only admins can send");

  // Ann turns it off in Group info; Bob can write straight away.
  await ann.getByRole("button", { name: "Group info" }).click();
  await ann.getByLabel("Only admins can send messages").uncheck();
  await expect(bob.getByLabel("Message", { exact: true })).toBeVisible();
});
