import { execSync } from "node:child_process";

import { defineConfig } from "@playwright/test";

/**
 * Ring 2 — auth session flow, run behind a *fake apex*.
 *
 * Why a separate config instead of a project inside `playwright.config.ts`:
 * that config has no `projects`, so `use.baseURL` / `use.launchOptions` are
 * global to all 14 specs. Overriding `E2E_BASE_URL` there would repoint the
 * whole suite at the fake apex and break every existing spec. Next 16 also
 * refuses to start a second dev server from the same directory, so the two
 * suites cannot share a run — this config is driven by its own CI job.
 *
 * The point of the fake apex: `resolveCookieDomain()` only returns a shared
 * cookie Domain when the request Host is at or under `AUTH_COOKIE_APEX`. On
 * `localhost` it returns `undefined`, so the production code path — and the
 * Domain-scoped deletion that goes with it — is never exercised. Pointing
 * `*.elxea.test` at 127.0.0.1 inside Chromium and setting
 * `AUTH_COOKIE_APEX=elxea.test` makes the dev server take the exact same
 * branch production takes, with no DNS or /etc/hosts involvement.
 */

/* Asymmetry is deliberate and load-bearing.
 *
 * `baseURL` is the fake apex because only Chromium can resolve it (via
 * --host-resolver-rules). `webServer.url` is 127.0.0.1 because Playwright's
 * readiness probe runs in Node, which has no such mapping and would fail with
 * ENOTFOUND on `www.elxea.test` — the server would be reported as never
 * starting even though it is up. */
const FAKE_APEX_HOST = "www.elxea.test";
const PORT = 3310;
const baseURL = `http://${FAKE_APEX_HOST}:${PORT}`;

/* Evaluated here, in Node, at config load. Writing the literal string
 * "$(git rev-parse --short HEAD)" into `webServer.env` would pass the shell
 * syntax through verbatim (Playwright does not run env values through a shell),
 * so the meta-tag comparison in S0 would compare against a string that can
 * never match and the check would be permanently, invisibly green-by-accident. */
const commitSha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();

export default defineConfig({
  testDir: ".",
  testMatch: ["**/auth-session-flow.spec.ts", "**/gate0-auth-probe.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/auth-flow-report.json" }]],
  use: {
    baseURL,
    locale: "ja-JP",
    /* Ring 2 traces would contain full request URLs, headers and cookies. This
     * suite only ever handles synthetic values, but keeping trace off here
     * matches the Ring 3 rule and removes the risk of the setting being copied
     * to a config that does touch real credentials. */
    trace: "off",
    launchOptions: {
      args: [`--host-resolver-rules=MAP *.elxea.test 127.0.0.1`],
    },
  },
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      /* Makes the shared-domain branch fire for *.elxea.test. */
      AUTH_COOKIE_APEX: "elxea.test",
      /* Any env-derived base URL must not fall back to localhost. */
      NEXTAUTH_URL: baseURL,
      /* Without this, post_logout_redirect_uri resolves to localhost:3310 and
       * S4/S5 stay red even after the fix. */
      LINE_ALLOWED_CALLBACK_HOSTS: FAKE_APEX_HOST,
      /* Pin the Shopify logout endpoint so the contract stub has a single,
       * deterministic destination to intercept. */
      SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_URL:
        "https://shopify.test/authentication/00000000/logout",
      /* Telemetry off — the "no external requests" assertion counts every
       * outbound host, and Sentry would make it non-deterministic. */
      NEXT_PUBLIC_SENTRY_DSN: "",
      /* Parity with the existing e2e job (ci.yml:313-329). Without these the
       * product/journal surfaces render differently than in the main suite. */
      PREVIEW_SEED_STOREFRONT: "1",
      NEXT_PUBLIC_SANITY_PROJECT_ID: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? "",
      NEXT_PUBLIC_SANITY_DATASET: process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production",
      /* Feeds the <meta name="x-elxea-commit"> build-identity check. */
      VERCEL_GIT_COMMIT_SHA: commitSha,
      /* Existing convention: the site-password gate would 307 every route. */
      SITE_PASSWORD: "",
    },
  },
});
