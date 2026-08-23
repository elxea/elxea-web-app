import path from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * Ring 2 — LINE ログイン / メール連携 / 合体 / 解除 の受入シナリオ。
 *
 * ## 何に対して回すのか
 *
 * 外に出ていく先を 3 つとも偽物に置き換え、Next の dev サーバーだけが本物になる。
 *
 *   偽 LINE            … `scripts/e2e/fake-line-server.mjs`（authorize / token / profile / verify）
 *   偽 cx-agent        … `scripts/e2e/fake-cx-agent-server.mjs`（連携台帳の正本）
 *   偽 Shopify Account … `scripts/e2e/fake-shopify-account-server.mjs`（メールログインの OAuth）
 *   偽 Firestore       … プロセス内（`E2E_FIRESTORE_STUB=1` → instrumentation.ts が差し込む）
 *
 * **本物の LINE / Shopify / Firestore / cx-agent には一切接続しない。** 接続先はすべて
 * env で差し替えており、env を足さない通常起動では 1 バイトも挙動が変わらない。
 *
 * ## なぜ別 config なのか
 *
 * `playwright.config.ts` は `projects` を持たないので `use.baseURL` が全 spec 共通で、
 * ここで上書きすると既存 spec が全部この偽アペックスに向いてしまう。加えて Next 16 は
 * 同じディレクトリから 2 つ目の dev サーバーを起動しない。よって別 config + 別 CI ジョブ。
 * これは `playwright-auth-flow.config.ts` が先に敷いた形をそのまま踏襲している。
 *
 * ## なぜ偽アペックス（www.elxea.test）なのか
 *
 * `resolveCookieDomain()` は Host が `AUTH_COOKIE_APEX` の配下のときだけ共有 Domain を
 * 返す。`localhost` では `undefined` になり、**本番が通る分岐を一度も通らない**。
 * LINE のセッション cookie（`line_session` / `line_uid` …）はまさにその Domain 付きで
 * 発行されるので、localhost で回すと「合体したのに見えない」類の欠陥を取り逃がす。
 * Chromium の `--host-resolver-rules` で解決するため、DNS も /etc/hosts も要らない。
 */

const FAKE_APEX_HOST = "www.elxea.test";
const PORT = 3320;
const baseURL = `http://${FAKE_APEX_HOST}:${PORT}`;

const LINE_PORT = 3321;
const CX_PORT = 3322;
const SHOPIFY_PORT = 3323;

const LINE_ORIGIN = `http://127.0.0.1:${LINE_PORT}`;
const CX_ORIGIN = `http://127.0.0.1:${CX_PORT}`;
const SHOPIFY_ORIGIN = `http://127.0.0.1:${SHOPIFY_PORT}`;

/**
 * 合成の資格情報。**本物の値はここにも env にも一切現れない。**
 * 偽サーバーはこの値を「一致するかどうか」だけに使うので、秘密である必要がない。
 */
const LINE_LOGIN_CHANNEL_ID = "1000000001";
const LINE_LINK_CHANNEL_ID = "1000000002";
const SHOPIFY_CLIENT_ID = "fake-shopify-client-id";
const SYNC_API_SECRET = "fake-sync-api-secret";

const repoRoot = path.resolve(__dirname, "..");

/* 偽サーバーの叩かれ方を spec 側から読むためのログ。「本物に出ていっていない」ことと
 * 「鍵を付けて呼んでいる」ことは、外形（cookie や画面）だけでは確かめられない。 */
const LINE_HIT_LOG = path.join(repoRoot, "test-results", "fake-line-hits.jsonl");
const CX_HIT_LOG = path.join(repoRoot, "test-results", "fake-cx-agent-hits.jsonl");

/* spec 側からも同じ値を読む。ここで 1 回だけ評価して両側へ渡すのは、独立に組み立てると
 * 静かにずれて「たまたま緑」になりうるため（auth-flow config と同じ理由）。 */
process.env.E2E_LINE_ORIGIN = LINE_ORIGIN;
process.env.E2E_CX_ORIGIN = CX_ORIGIN;
process.env.E2E_SHOPIFY_ORIGIN = SHOPIFY_ORIGIN;
process.env.E2E_LINE_HIT_LOG = LINE_HIT_LOG;
process.env.E2E_CX_HIT_LOG = CX_HIT_LOG;
process.env.E2E_BASE_HOST = `${FAKE_APEX_HOST}:${PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: ["**/line-linkage-flow.spec.ts"],
  /* 受入シナリオは①→⑤が 1 本の物語で、しかも偽サーバーと偽 Firestore は
   * プロセス内の 1 つの状態を共有する。並列にすると互いの台帳を踏む。 */
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  /* リトライ 0。この suite が落ちるのは状態遷移が壊れたときで、再実行で緑になるなら
   * それは「たまに壊れる」であって見逃してよい理由にならない。待ちは Playwright の
   * 自動リトライ（expect / waitForURL）で吸収する。 */
  retries: 0,
  workers: 1,
  /* dev サーバーは初回アクセスでルートをコンパイルする。冷えた Turbopack では
   * `/ja/account` の初回が 30 秒を超えることがあり、それは `ERR_ABORTED` として
   * 現れるのでプロダクトの不具合に見えてしまう。Ring 2 は `next dev` でなければ
   * ならない（本番ビルドだと Secure cookie になり http では保存されない）。 */
  timeout: 120_000,
  outputDir: path.join(repoRoot, "test-results", "line-linkage-artifacts"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(repoRoot, "test-results", "line-linkage-report.json") }],
    ["junit", { outputFile: path.join(repoRoot, "test-results", "line-linkage-junit.xml") }],
  ],
  use: {
    baseURL,
    locale: "ja-JP",
    /* trace off: auth-flow config と同じ方針。ここは合成値しか扱わないが、
     * 「認証の往復を録らない」を config をまたいで同じ形にしておく。 */
    trace: "off",
    launchOptions: {
      args: [`--host-resolver-rules=MAP *.elxea.test 127.0.0.1`],
    },
  },
  webServer: [
    {
      command: `node scripts/e2e/fake-line-server.mjs ${LINE_PORT} ${LINE_ORIGIN} ${LINE_HIT_LOG}`,
      cwd: repoRoot,
      url: `${LINE_ORIGIN}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `node scripts/e2e/fake-cx-agent-server.mjs ${CX_PORT} ${SYNC_API_SECRET} ${CX_HIT_LOG}`,
      cwd: repoRoot,
      url: `${CX_ORIGIN}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `node scripts/e2e/fake-shopify-account-server.mjs ${SHOPIFY_PORT} ${SHOPIFY_ORIGIN} ${SHOPIFY_CLIENT_ID}`,
      cwd: repoRoot,
      url: `${SHOPIFY_ORIGIN}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `pnpm dev --port ${PORT}`,
      cwd: repoRoot,
      /* readiness は 127.0.0.1 で見る。Playwright の probe は Node で走り、
       * `--host-resolver-rules` は Chromium にしか効かないので、偽アペックスを
       * 指すと ENOTFOUND で「起動しなかった」と誤報される。 */
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        /* --- 偽アペックス（本番の cookie Domain 分岐を通すため） --- */
        AUTH_COOKIE_APEX: "elxea.test",
        NEXTAUTH_URL: baseURL,
        LINE_ALLOWED_CALLBACK_HOSTS: FAKE_APEX_HOST,

        /* --- 偽 LINE --- */
        LINE_AUTH_BASE_URL: LINE_ORIGIN,
        LINE_API_BASE_URL: LINE_ORIGIN,
        AUTH_LINE_ID: LINE_LOGIN_CHANNEL_ID,
        AUTH_LINE_SECRET: "fake-line-login-secret",
        /* 連携（/{locale}/account からの導線）は LINE ログインとは別チャネル。
         * わざと別の ID にして、取り違えたら aud 不一致で落ちるようにしておく。 */
        LINE_LIFF_CHANNEL_ID: LINE_LINK_CHANNEL_ID,
        LINE_LIFF_CHANNEL_SECRET: "fake-line-link-secret",

        /* --- 偽 cx-agent（連携台帳の正本） --- */
        NEXT_PUBLIC_CHAT_API_URL: `${CX_ORIGIN}/api/chat`,
        SYNC_API_SECRET,

        /* --- 偽 Shopify Customer Account（メールログイン） --- */
        SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: SHOPIFY_CLIENT_ID,
        SHOPIFY_CUSTOMER_ACCOUNT_AUTHORIZE_URL: `${SHOPIFY_ORIGIN}/authentication/oauth/authorize`,
        SHOPIFY_CUSTOMER_ACCOUNT_TOKEN_URL: `${SHOPIFY_ORIGIN}/authentication/oauth/token`,
        SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_URL: `${SHOPIFY_ORIGIN}/authentication/logout`,
        SHOPIFY_CUSTOMER_ACCOUNT_API_URL: `${SHOPIFY_ORIGIN}/account/customer/api/graphql`,

        /* --- 偽 Firestore（プロセス内） --- */
        E2E_FIRESTORE_STUB: "1",

        /* cookie の暗号化に使う。合成値で、本物の秘密ではない。 */
        SESSION_SECRET: "e2e-line-linkage-session-secret-0123456789abcdef",

        /* テレメトリ off — 外部ホストを数える assertion を非決定にしないため。 */
        NEXT_PUBLIC_SENTRY_DSN: "",
        /* 既存の e2e ジョブと同じ。無いと商品面の描画が変わる。 */
        PREVIEW_SEED_STOREFRONT: "1",
        /* サイトパスワードの門があると全ルートが 307 になる（既存の慣習）。 */
        SITE_PASSWORD: "",

        /* 空文字で上書きすると `.env.local` 由来の値を**消して**しまい、
         * projectId 空で Sanity クライアントが描画時に throw する。CI が供給した
         * ときだけ通す（auth-flow config と同じ扱い）。 */
        ...(process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
          ? { NEXT_PUBLIC_SANITY_PROJECT_ID: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID }
          : {}),
        ...(process.env.NEXT_PUBLIC_SANITY_DATASET
          ? { NEXT_PUBLIC_SANITY_DATASET: process.env.NEXT_PUBLIC_SANITY_DATASET }
          : {}),
      },
    },
  ],
});
