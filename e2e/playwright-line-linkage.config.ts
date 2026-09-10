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
/**
 * 受け渡しホスト（本物の `access-auto.line.me` にあたる）。
 *
 * **わざと別の host 名にしてある。** 本物では認可ホストと受け渡しホストが別ホストで、
 * アプリに結び付いているのは後者だけである（`lib/line/endpoints.ts`）。同じ origin に
 * すると「タップの着地点が別ホストへ移ったこと」自体を検査できなくなり、着地点が
 * `access.line.me` に戻る退行が緑のまま通る。中身は同じ偽サーバーでよい。
 */
const LINE_HANDOFF_ORIGIN = `http://localhost:${LINE_PORT}`;
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
/**
 * 合体イベント（M-2）と消去（M-5）の鍵。**どちらも `SYNC_API_SECRET` とは別鍵**。
 *
 * 本物が鍵を分けているのには理由があり、その分離自体が検査対象になる。
 *   - 合体イベントの口は「この LINE とこの顧客は同一人物である」と宣言できる。
 *     通れば web-app は元の棚を消して荷物を移すので、取り返しがつかない
 *   - 消去の口は消すことしかしない。他の用途で配った鍵で開けさせない
 * ここで同じ値にすると、鍵を取り違える退行が偽物側で吸収されて見えなくなる。
 */
const LINKAGE_EVENT_SECRET = "fake-linkage-event-secret";
const ERASE_API_SECRET = "fake-erase-api-secret";
/** Shopify webhook の HMAC 鍵（S15 の customers/redact を署名するのに要る）。 */
const SHOPIFY_WEBHOOK_SECRET = "fake-shopify-webhook-secret";

const repoRoot = path.resolve(__dirname, "..");

/* 偽サーバーの叩かれ方を spec 側から読むためのログ。「本物に出ていっていない」ことと
 * 「鍵を付けて呼んでいる」ことは、外形（cookie や画面）だけでは確かめられない。 */
const LINE_HIT_LOG = path.join(repoRoot, "test-results", "fake-line-hits.jsonl");
const CX_HIT_LOG = path.join(repoRoot, "test-results", "fake-cx-agent-hits.jsonl");

/* spec 側からも同じ値を読む。ここで 1 回だけ評価して両側へ渡すのは、独立に組み立てると
 * 静かにずれて「たまたま緑」になりうるため（auth-flow config と同じ理由）。 */
process.env.E2E_LINE_ORIGIN = LINE_ORIGIN;
process.env.E2E_LINE_HANDOFF_ORIGIN = LINE_HANDOFF_ORIGIN;
process.env.E2E_CX_ORIGIN = CX_ORIGIN;
process.env.E2E_SHOPIFY_ORIGIN = SHOPIFY_ORIGIN;
process.env.E2E_LINE_HIT_LOG = LINE_HIT_LOG;
process.env.E2E_CX_HIT_LOG = CX_HIT_LOG;
process.env.E2E_BASE_HOST = `${FAKE_APEX_HOST}:${PORT}`;
/* S15（消去）は Shopify の webhook を偽造して叩くので、spec 側も同じ鍵で署名する。
   合成値であって本物の秘密ではない。 */
process.env.E2E_SHOPIFY_WEBHOOK_SECRET = SHOPIFY_WEBHOOK_SECRET;

/* テスト開始前に温めるルート。理由は e2e/support/warm-dev-server.ts に書いてある
 * （要約: `next dev` の初回コンパイルを、テストの制限時間ではなく globalSetup の
 * 予算で払わせる）。
 *
 * **suite が通る道を全部** 並べる。初版は 4 本しか無く、①→⑤ が実際に踏む
 * `/ja/login/complete`・`/api/line-callback`・`/api/user/line-link/*`・`/api/auth/*`
 * の初回コンパイルはテストの制限時間の中に残っていた。`waitForURL` が延々と待つ形で
 * 出るので、症状だけ見ると「連携が成立しない」というプロダクトの不具合に見える。
 *
 * API ルートは GET で叩く。POST 専用のものは 405 を返すが、**Next はどのメソッドが
 * export されているかを知るためにルートモジュールを読み込む**ので、405 でも
 * コンパイルは済む。応答は一切見ない。 */
process.env.E2E_WARMUP_BASE_URL = `http://127.0.0.1:${PORT}`;
process.env.E2E_WARMUP_PATHS = [
  /* 画面 */
  "/ja",
  "/ja/login",
  "/ja/login/complete",
  "/ja/account",
  /* LINE ログインの往復 */
  "/api/line-login/init",
  "/api/line-callback",
  /* メールログインの往復 */
  "/api/auth/login",
  "/api/auth/callback",
  "/api/auth/logout",
  /* マイページが描画時・描画後に叩くもの */
  /* 農家も `favorites` の 4 分類目になったので `/api/user/follows` は無い (J-5)。 */
  "/api/user/favorites",
  "/api/user/dashboard",
  "/api/user/events",
  /* 連携・解除 */
  "/api/user/line-link",
  "/api/user/line-link/init",
  "/api/user/line-link/callback",
  /* LINE トーク内 Account Link の受け口 (S13) と GDPR 消去 (S15)。
     どちらも POST 専用なので GET は 405 だが、Next はどのメソッドが export されて
     いるかを知るためにルートモジュールを読み込むので、405 でもコンパイルは済む。 */
  "/api/internal/linkage-established",
  "/api/webhooks/gdpr/customers-redact",
].join(",");
/* `/{locale}/account` は `middleware.ts` がセッション cookie の **有無** で門を張る。
 * cookie 無しの素の fetch は `/ja/login` へ折り返され、account ページ本体は 1 行も
 * コンパイルされない (緑の run でも `[warmup] /ja/account 8ms` と出ていた = 何もして
 * いない)。中身は検証されないので、合成値の cookie を 1 つ持たせて門を通す。
 * セッションとしては無効なままなので、ページは未ログインとして描画するか、その場で
 * エラーになる。**どちらでもよい** — 欲しいのはコンパイルだけ。 */
process.env.E2E_WARMUP_COOKIE = "line_session=warmup-not-a-session";

export default defineConfig({
  testDir: ".",
  /* `line-login-mobile.spec.ts` も同居させる。理由は偽アペックスが要ること —
   * `isTrustedAuthHost()` は自ホスト apex の配下しか通さないので、`localhost` の
   * 素の config では `/api/line-login/init` が 503 になり、LINE ボタンは常に
   * 「現在ご利用いただけません」になる。そこで回しても何も守れない。 */
  testMatch: ["**/line-linkage-flow.spec.ts", "**/line-login-mobile.spec.ts"],
  /* 初回コンパイルをテストの制限時間の外へ出す。詳細は同ファイルのコメント。 */
  globalSetup: require.resolve("./support/warm-dev-server"),
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
   * ならない（本番ビルドだと Secure cookie になり http では保存されない）。
   *
   * run 32620718882 の ① はこの形で 2.1 分かけて落ちた。ただしあの run は温めが
   * 入る前で、しかも `/ja/login` という**温めていれば防げた**ルートで落ちている。
   * つまりこの 180 秒は「温めが効かなかったときの保険」ではなく、温めに取りこぼしが
   * 無いことを前提にした余裕枠。取りこぼしを塞ぐのは warm-dev-server 側の仕事で、
   * 塞げなかったときは globalSetup が落ちる（黙って時間だけ伸ばさない）。 */
  timeout: 180_000,
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
      /* 偽 cx-agent には web-app の**素の origin**（127.0.0.1）を渡す。偽アペックスの
         名前解決は Chromium の `--host-resolver-rules` にしかなく、Node からは
         引けない。S13 の合体イベントはサーバ間の POST なので cookie は関係しない。 */
      command: `node scripts/e2e/fake-cx-agent-server.mjs ${CX_PORT} ${SYNC_API_SECRET} ${CX_HIT_LOG} http://127.0.0.1:${PORT} ${LINKAGE_EVENT_SECRET} ${ERASE_API_SECRET}`,
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
        /* 受け渡しホストは別 host 名で渡す（上の LINE_HANDOFF_ORIGIN の注記）。 */
        LINE_APP_HANDOFF_BASE_URL: LINE_HANDOFF_ORIGIN,
        AUTH_LINE_ID: LINE_LOGIN_CHANNEL_ID,
        AUTH_LINE_SECRET: "fake-line-login-secret",
        /* 連携（/{locale}/account からの導線）は LINE ログインとは別チャネル。
         * わざと別の ID にして、取り違えたら aud 不一致で落ちるようにしておく。 */
        LINE_LIFF_CHANNEL_ID: LINE_LINK_CHANNEL_ID,
        LINE_LIFF_CHANNEL_SECRET: "fake-line-link-secret",

        /* --- 偽 cx-agent（連携台帳の正本） --- */
        NEXT_PUBLIC_CHAT_API_URL: `${CX_ORIGIN}/api/chat`,
        SYNC_API_SECRET,
        /* 合体イベントの受け口（M-2 / S13）。未設定だと 503 で fail-closed に
           なるので、この env が無いと S13 は「合体が起きない」形で落ちる。 */
        LINKAGE_EVENT_SECRET,
        /* 消去（M-5 / S15）。**SYNC_API_SECRET と別鍵**であることに意味がある。 */
        ERASE_API_SECRET,
        /* GDPR webhook の署名検証（S15）。未設定だと handler が 500 を返す。 */
        SHOPIFY_WEBHOOK_SECRET,

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
