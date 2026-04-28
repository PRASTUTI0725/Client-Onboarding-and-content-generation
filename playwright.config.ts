import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5174/content-calendar/";
const isCI = !!(process.env.CI || process.env.GITHUB_ACTIONS);

export default defineConfig({
  testDir: "./tests/playwright",
  timeout: 300_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ...(isCI ? ([["blob", { outputDir: "blob-report" }]] as const) : []),
  ],
  use: {
    baseURL,
    trace: isCI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
