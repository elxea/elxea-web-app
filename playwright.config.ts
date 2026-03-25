import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  /* In CI, skip tests that require external services (Firebase, Shopify, etc.) */
  testIgnore: process.env.CI
    ? [
        "**/community.spec.ts",
        "**/membership.spec.ts",
        "**/subscription-management.spec.ts",
        "**/subscription-signup.spec.ts",
        "**/ms7-personalization.spec.ts",
        "**/staging-smoke.spec.ts",
      ]
    : ["**/staging-smoke.spec.ts"],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    locale: "ja-JP",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
