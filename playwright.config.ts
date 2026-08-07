import { defineConfig } from "@playwright/test";

/**
 * Base URL of the app under test. Overridable so a developer can point the
 * suite at an already-running dev server on a non-default port
 * (`E2E_BASE_URL=http://localhost:3100 pnpm test:e2e`).
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

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
    baseURL,
    trace: "on-first-retry",
    locale: "ja-JP",
  },
  webServer: {
    command: "pnpm dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    // The site-password gate (SITE_PASSWORD in .env.local) 307-redirects every
    // route to /site-password, which would make the whole suite unrunnable
    // locally. E2E always runs against an ungated app.
    env: { SITE_PASSWORD: "" },
  },
});
