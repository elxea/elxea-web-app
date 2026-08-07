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
  testIgnore: process.env.CI
    ? ["**/membership.spec.ts", "**/staging-smoke.spec.ts"]
    : ["**/membership.spec.ts", "**/staging-smoke.spec.ts"],
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
