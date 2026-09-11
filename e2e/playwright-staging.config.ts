import { defineConfig } from "@playwright/test";

/**
 * Playwright config for staging smoke tests.
 * No webServer — tests run against an already-deployed staging URL.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "staging-smoke.spec.ts",
  fullyParallel: true,
  forbidOnly: true,
  retries: 2,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    locale: "ja-JP",
  },
});
