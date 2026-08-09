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
  /*
   * Reporters are declared here rather than passed with `--reporter` on the CI
   * command line, because the old CI invocation
   * (`--reporter=junit --output=test-results/e2e-junit.xml`) did not do what it
   * looks like: `--output` sets the *artifacts* directory, not the JUnit path,
   * so the XML went to stdout and `test-results/e2e-junit.xml` was never
   * written — the uploaded artifact had no report in it.
   *
   * The `json` report is what `scripts/ci/e2e-skip-summary.mjs` reads to publish
   * the skip count and reasons to the CI job summary. Without it, tests that
   * skip themselves at runtime (missing CRON_SECRET etc.) are indistinguishable
   * from tests that actually verified something — a green check that asserted
   * nothing. See docs/ci-gates.md.
   */
  reporter: process.env.CI
    ? [
        ["list"],
        ["html", { open: "never" }],
        ["json", { outputFile: "test-results/e2e-report.json" }],
        ["junit", { outputFile: "test-results/e2e-junit.xml" }],
      ]
    : "html",
  /* Betaの守備範囲 = 定期便・LINE連携・コミュニティを含む全部 (Setaka決定
   * 2026/08/08)。よって旧「外部サービスが要るものは全部CI除外」をやめ、
   * community / subscription-* / ms7-personalization の4 spec (68 tests) を
   * CI実行対象へ復帰させた。
   *
   * 残る2 specだけを除外し続ける。理由はいずれも「守備範囲外」ではない:
   * - membership.spec.ts (8 tests) … 会員ランク制度そのものが「無し」に決定済
   *   (2026/08/08)。仕様が消えたので復帰させず廃止候補として残置する。
   * - staging-smoke.spec.ts (4 tests) … ステージング公開後にしか意味がない。
   *   CIではなくデプロイ後ジョブへ移すのが正で、そのワークフロー改修は別件。
   */
  /* CI / 非CIで同じ2 specを外す。以前は三項演算子で書かれていたが両辺が同じ配列で、
   * 「CIだけ違う」と読めてしまう死んだ条件分岐だった。除外理由はどちらの環境でも
   * 同じ (仕様が消えた / ステージング前提) なので、条件を持たない1つの配列にする。 */
  testIgnore: ["**/membership.spec.ts", "**/staging-smoke.spec.ts"],
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
