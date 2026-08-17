import { execSync } from "node:child_process";
import path from "node:path";

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
 * starting even though it is up. The same Node-vs-Chromium split means specs
 * must read page HTML through the page, never through `context.request`. */
const FAKE_APEX_HOST = "www.elxea.test";
const PORT = 3310;
const baseURL = `http://${FAKE_APEX_HOST}:${PORT}`;

/* Evaluated here, in Node, at config load. Writing the literal string
 * "$(git rev-parse --short HEAD)" into `webServer.env` would pass the shell
 * syntax through verbatim (Playwright does not run env values through a shell),
 * so the meta-tag comparison in S0 would compare against a string that can
 * never match and the check would be permanently, invisibly green-by-accident. */
const commitSha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();


/* Paths resolve relative to this config file (i.e. `e2e/`), so artefact paths are
 * pinned to the repo root explicitly. `.gitignore` ignores `/test-results/` at
 * the root only; an `e2e/test-results/` directory would be untracked-but-not-
 * ignored noise in every `git status`. */
const repoRoot = path.resolve(__dirname, "..");

const STUB_PORT = 3311;
const LINE_STUB_PORT = 3312;
/* The stub appends one JSON line per hit here. Specs read this file to assert on
 * stub hits, which is what makes the assertion possible at all — see the
 * webServer comment below. */
const STUB_LOG = path.join(repoRoot, "test-results", "shopify-logout-stub-hits.jsonl");

/* The spec compares the page's build marker against this value, so the TEST
 * process needs it too — `webServer.env` only reaches the dev server. Setting it
 * here keeps a single evaluation feeding both sides; computing it independently
 * inside the spec would let the two drift and still agree by accident. */
process.env.VERCEL_GIT_COMMIT_SHA = commitSha;
/* Same reason: the spec reads the stub's hit log directly. */
process.env.SHOPIFY_LOGOUT_STUB_LOG = STUB_LOG;


export default defineConfig({
  testDir: ".",
  testMatch: ["**/auth-session-flow.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  /* The dev server compiles each route on first request, and a cold Turbopack
   * cache can push a first `/ja/account` hit past the 30s default — which shows
   * up as `ERR_ABORTED; maybe frame was detached?` rather than as a timeout, so
   * it reads like a product fault when it is harness latency. Ring 2 must run
   * against `next dev` (a production build would set Secure on the cookies and
   * they would not be stored over http), so the compile cost is unavoidable. */
  timeout: 120_000,
  outputDir: path.join(repoRoot, "test-results", "auth-flow-artifacts"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(repoRoot, "test-results", "auth-flow-report.json") }],
  ],
  use: {
    baseURL,
    locale: "ja-JP",
    /* Ring 2 traces would contain full request URLs, headers and cookies. This
     * suite only handles synthetic values, but keeping trace off here matches the
     * Ring 3 rule and removes the risk of the setting being copied to a config
     * that does touch real credentials. */
    trace: "off",
    launchOptions: {
      args: ["--host-resolver-rules=MAP *.elxea.test 127.0.0.1"],
    },
  },
  webServer: [
    /* The Shopify RP-initiated logout contract, as a REAL local process rather
     * than a `page.route` handler.
     *
     * Measured 2026-08-18 01:12 JST: a catch-all `context.route` saw the
     * /api/auth/logout navigation and every subresource but NEVER the
     * cross-origin redirect target — the browser went on to resolve DNS for it.
     * Playwright does not intercept the cross-origin hop of a top-level
     * navigation redirect, so asserting on stub hits via interception is
     * impossible. A real server both works and exercises a genuine network hop.
     *
     * `/health` is used for readiness because the logout path answers 400 to a
     * hint-less request — that IS the contract, and Playwright would read a 400
     * as "not ready yet". */
    /* LINE's API, so the /api/line-callback SUCCESS path is reachable. Those
     * calls are server-side, so no browser-level interception can stand in for
     * them — and without them the suite can only ever exercise this route's error
     * redirects, which is the blind spot that let a session-destroying change
     * pass fully green. */
    {
      command: `node scripts/e2e/line-api-stub.mjs ${LINE_STUB_PORT}`,
      cwd: repoRoot,
      url: `http://127.0.0.1:${LINE_STUB_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `node scripts/e2e/shopify-logout-stub.mjs ${STUB_PORT} ${STUB_LOG}`,
      cwd: repoRoot,
      url: `http://127.0.0.1:${STUB_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `pnpm dev --port ${PORT}`,
      cwd: repoRoot,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        /* Makes the shared-domain branch fire for *.elxea.test. */
        AUTH_COOKIE_APEX: "elxea.test",
        /* Any env-derived base URL must not fall back to localhost. */
        NEXTAUTH_URL: baseURL,
        /* Without this, the request-origin path in getBaseUrl() stays disabled
         * and post_logout_redirect_uri resolves to localhost:3310, leaving S4/S5
         * red even after the fix. */
        LINE_ALLOWED_CALLBACK_HOSTS: FAKE_APEX_HOST,
        /* Point the app at the local contract stub. It must be a reachable
         * origin: an unresolvable host would surface as a browser DNS error
         * rather than as the contract response the assertions are about. */
        SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_URL: `http://127.0.0.1:${STUB_PORT}/authentication/00000000/logout`,
        /* Lets the specs read the stub's hit log. */
        SHOPIFY_LOGOUT_STUB_LOG: STUB_LOG,
        /* Points the LINE callback at the local LINE stub. */
        LINE_API_BASE_URL: `http://127.0.0.1:${LINE_STUB_PORT}`,
        NEXT_PUBLIC_CHAT_API_URL: `http://127.0.0.1:${LINE_STUB_PORT}/api/chat`,
        AUTH_LINE_ID: "ring2-channel-id",
        AUTH_LINE_SECRET: "ring2-channel-secret",
        /* Telemetry off — the "no unexpected external hosts" assertion counts
         * every outbound host, and Sentry would make it non-deterministic. */
        NEXT_PUBLIC_SENTRY_DSN: "",
        /* Parity with the existing e2e job (ci.yml:313-329). Without these the
         * product / journal surfaces render differently than in the main suite. */
        PREVIEW_SEED_STOREFRONT: "1",
        /* Spread conditionally: assigning "" would OVERRIDE the value the dev
         * server would otherwise load from .env.local, and an empty projectId
         * makes the Sanity client throw on render. Only pass these through when
         * the surrounding environment (CI) actually supplies them. */
        ...(process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
          ? { NEXT_PUBLIC_SANITY_PROJECT_ID: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID }
          : {}),
        ...(process.env.NEXT_PUBLIC_SANITY_DATASET
          ? { NEXT_PUBLIC_SANITY_DATASET: process.env.NEXT_PUBLIC_SANITY_DATASET }
          : {}),
        /* Feeds the <meta name="x-elxea-commit"> build-identity check. */
        VERCEL_GIT_COMMIT_SHA: commitSha,
        /* Existing convention: the site-password gate would 307 every route. */
        SITE_PASSWORD: "",
      },
    },
  ],
});
