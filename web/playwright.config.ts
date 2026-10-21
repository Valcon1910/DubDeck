import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run the real UI (Vite dev server, which injects the backend
// key exactly like the here.now proxy route) against a real backend started
// with DUBDECK_DEV_LOGIN=1. See README → "Running the end-to-end tests".
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.DUBDECK_E2E_URL ?? "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 780 } } },
  ],
});
