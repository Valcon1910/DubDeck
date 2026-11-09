import { expect, test } from "@playwright/test";

// Passcode sign-in. Runs when the backend has DUBDECK_OWNER_PASSCODE set and
// DUBDECK_E2E_PASSCODE holds the same value.
const PASSCODE = process.env.DUBDECK_E2E_PASSCODE;
test.skip(!PASSCODE, "set DUBDECK_E2E_PASSCODE to run");

test("sign in once with the passcode, then the app opens straight away", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Passcode").fill("wrong-passcode");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("isn't right");

  await page.getByLabel("Passcode").fill(PASSCODE!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Download", level: 1 })).toBeVisible();

  await page.goto("/queue");
  await expect(page.getByRole("heading", { name: "Queue", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Passcode")).toHaveCount(0);
});
