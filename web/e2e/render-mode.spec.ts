import { expect, test } from "@playwright/test";

// "Render free" mode: backend with DUBDECK_EPHEMERAL=1 and a passcode.
// Finished downloads must be saved to the device automatically.
const PASSCODE = process.env.DUBDECK_E2E_PASSCODE;
const MEDIA = process.env.DUBDECK_E2E_MEDIA ?? "http://127.0.0.1:8765/test720.mp4";
test.skip(!PASSCODE || !process.env.DUBDECK_E2E_EPHEMERAL, "set DUBDECK_E2E_PASSCODE and DUBDECK_E2E_EPHEMERAL");

test("paste, download, and the file saves to the device by itself", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Passcode").fill(PASSCODE!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Download", level: 1 })).toBeVisible();

  await page.locator("#urls").fill(MEDIA);
  await page.keyboard.press("Enter");
  await expect(page.locator("article.preview h3").first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("radio", { name: "Audio" }).click();

  const download = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: /Download 1 item/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.mp3$/);
  await expect(page.getByText(/^Ready:/)).toBeVisible();

  await page.getByRole("link", { name: /Library/ }).first().click();
  await expect(page.getByText(/This server is temporary/)).toBeVisible();
});
