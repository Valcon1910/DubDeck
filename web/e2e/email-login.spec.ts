import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Emailed-code sign-in. Runs when the backend is configured with SMTP pointing at a
// local sink that appends messages to DUBDECK_E2E_MAIL_LOG.
const MAIL_LOG = process.env.DUBDECK_E2E_MAIL_LOG;
const EMAIL = process.env.DUBDECK_E2E_EMAIL ?? "owner@example.com";

test.skip(!MAIL_LOG, "set DUBDECK_E2E_MAIL_LOG to run");

function latestCode(): string | null {
  const m = [...readFileSync(MAIL_LOG!, "utf8").matchAll(/sign-in code is (\d{6})/g)];
  return m.length ? m[m.length - 1][1] : null;
}

test("sign in with an emailed code and stay signed in", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "desktop only");
  await page.goto("/");
  await page.getByLabel("Email").fill(EMAIL);
  const before = latestCode();
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByLabel("Code")).toBeVisible();
  await expect.poll(() => latestCode()).not.toBe(before);

  await page.getByLabel("Code").fill("000000" === latestCode() ? "111111" : "000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("isn't right");

  await page.getByLabel("Code").fill(latestCode()!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Download", level: 1 })).toBeVisible();

  // Reopening the app later goes straight in.
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
});
