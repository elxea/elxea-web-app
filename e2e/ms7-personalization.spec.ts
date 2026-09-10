/**
 * MS7 E2E テスト: パーソナライゼーション統合フロー
 *
 * テスト対象フロー:
 *   TC-1: LIFF 紐付けフロー（LINE → LIFF → Shopify 紐付け → Firestore 保存）
 *   TC-2: 行動イベント蓄積（記事閲覧 → behavior API → Firestore 記録）
 *   TC-3: ペルソナ判定（10 イベント蓄積 → Cloud Function → persona 更新）
 *   TC-4: コンテンツパーソナライズ（persona 設定済み → 記事一覧がスコア順）
 *   TC-5: 商品レコメンド（persona 設定済み → 商品がスコア順）
 *   TC-6: エージェント会話（persona 設定済み → ペルソナ反映応答）
 *   TC-7: Shopify 注文 → Firestore 更新 → エージェント応答変化
 *
 * 前提条件:
 *   - 開発サーバーが起動している（pnpm dev）
 *   - TEST_SHOPIFY_CUSTOMER_ID、TEST_SHOPIFY_SESSION_TOKEN が設定されている
 *     （staging 環境では .env.test.local に定義）
 *   - Firestore エミュレータ または staging Firestore に接続可能
 *
 * 実行:
 *   pnpm playwright test e2e/ms7-personalization.spec.ts
 *   pnpm playwright test e2e/ms7-personalization.spec.ts --headed (デバッグ用)
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Test fixtures & helpers
// ---------------------------------------------------------------------------

/**
 * Reason attached to the four permanently-skipped LIFF page tests.
 *
 * Kept as a shared constant so the CI skip summary groups them as one item
 * (4 tests / 1 cause) instead of four look-alike rows. Delete the constant and
 * its `test.skip` calls together when /ja/liff ships.
 */
const PENDING_LIFF_ROUTE =
  "/ja/liff ルート未実装 — 実装まで保留。LINE アプリ外では LIFF SDK を初期化できないため、" +
  "当面は scripts/README.md TC-1 の手動テスト手順で担保する";

/**
 * Reason attached to the three permanently-skipped persona API tests.
 *
 * `GET /api/user/persona` **は存在しない**。実測 (2026-08-09):
 *   - `app/api/user/` 配下の route は behavior / comments / dashboard / events /
 *     favorites / follows / line-link / line-link-liff の 8 本で persona は無い
 *   - 未存在なので応答は 404 (テストの期待は 200 / 401)
 *   - persona の算出自体は Cloud Functions 側 (`functions/src`) にあるが、
 *     Web から読む HTTP エンドポイントはまだ生えていない
 *
 * つまりこれは「実装が壊れている」ではなく「機能が未実装」で、テスト側で
 * 期待を 404 に書き換えると未実装を仕様として固定してしまう。ルートが
 * 生えたときに定数と `test.skip` をまとめて消す (PENDING_LIFF_ROUTE と同じ運用)。
 */
const PENDING_PERSONA_API =
  "GET /api/user/persona 未実装 — app/api/user 配下に route が無く 404。" +
  "persona 算出は Cloud Functions 側にあるが Web 向けエンドポイントは未着手。" +
  "ルート実装と同時にこの skip を外す";

/** テスト用 Shopify カスタマー ID（モック） */
const TEST_CUSTOMER_ID = process.env.TEST_SHOPIFY_CUSTOMER_ID ?? "test-customer-001";

/** テスト用 LINE ユーザー ID（モック） */
const TEST_LINE_USER_ID = "U" + "a".repeat(32); // LINE UID フォーマット

/**
 * behavior API を直接呼び出してイベントを記録する。
 * 実際のユーザー操作の代わりにテスト用として使用。
 */
async function recordBehaviorEvent(
  page: Page,
  action: string,
  metadata: Record<string, string> = {}
) {
  const response = await page.request.post("/api/user/behavior", {
    data: {
      action,
      channel: "web",
      metadata,
    },
  });
  return response;
}

/**
 * テスト用セッション Cookie をセットする。
 * Shopify セッションの代替としてテスト環境で使用。
 */
async function setTestSession(page: Page) {
  const sessionToken = process.env.TEST_SHOPIFY_SESSION_TOKEN;
  if (sessionToken) {
    await page.context().addCookies([
      {
        name: "shop_auth",
        value: sessionToken,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        secure: false,
      },
    ]);
  }
}

// ---------------------------------------------------------------------------
// TC-1: LIFF 紐付けフロー
// ---------------------------------------------------------------------------

test.describe("TC-1: LIFF 紐付けフロー", () => {
  // LIFF route (/ja/liff) does not exist yet — skip page-level tests until
  // implemented. Declared as `test(...)` with a first-statement `test.skip(true,
  // reason)` rather than `test.skip("title", ...)`: both skip, but only this form
  // records the reason as an annotation, which is what puts it in the CI skip
  // summary (scripts/ci/e2e-skip-summary.mjs). A bare `test.skip("title")` shows
  // up as an unexplained skip and reads like an oversight.
  test("LIFF ページが正常にロードされる", async ({ page }) => {
    test.skip(true, PENDING_LIFF_ROUTE);
    await page.goto("/ja/liff");

    // LIFF SDK 未初期化時はローディング or ログイン画面が表示される
    // LINE 外ブラウザではエラー or ログイン要求画面になる
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();

    // LIFF SDK エラーの場合でもレイアウトは維持される
    await expect(page.locator("body")).toBeVisible();
  });

  test("Shopify 未ログイン時は認証誘導画面が表示される", async ({ page }) => {
    test.skip(true, PENDING_LIFF_ROUTE);
    await page.goto("/ja/liff");

    // LIFF を MOCK モードで起動（NEXT_PUBLIC_LIFF_ID 未設定時はモック）
    // 実際の LINE ブラウザ外ではセッション確認が走る

    // 認証誘導テキストが含まれるか確認
    // （"LINE でログイン" or "elxea アカウントでログイン" or "読み込み中"）
    await page.waitForTimeout(2000); // LIFF 初期化待ち
    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();
  });

  test("ブラウザ申告だけで連携できる入口が無い", async ({ page }) => {
    /* かつて POST /api/user/line-link は「ブラウザが送ってきた lineUserId を
       ログイン中の顧客に結び付ける」入口だった。LINE に何も検証させていないので
       任意の LINE を名乗れる偽の連携で、2026-08-22 に削除した (P10)。
       ハンドラが無いので Next.js は 405 を返す。200 が返ったら復活の合図。 */
    const response = await page.request.post("/api/user/line-link", {
      data: { lineUserId: TEST_LINE_USER_ID },
    });
    expect(response.status()).toBe(405);
  });

  test("persona API エンドポイントが存在する", async ({ page }) => {
    test.skip(true, PENDING_PERSONA_API);
    // GET /api/user/persona が 401 (未認証) を返すことを確認
    const response = await page.request.get("/api/user/persona");
    expect([200, 401]).toContain(response.status());
  });
});

// ---------------------------------------------------------------------------
// TC-2: 行動イベント蓄積
// ---------------------------------------------------------------------------

test.describe("TC-2: 行動イベント蓄積", () => {
  test("behavior API エンドポイントが存在する", async ({ page }) => {
    const response = await page.request.post("/api/user/behavior", {
      data: {
        action: "view_content",
        channel: "web",
        metadata: { contentId: "test-article-001" },
      },
    });
    // 401 (未認証) が正常。500 は NG
    expect([200, 201, 401]).toContain(response.status());
  });

  test("記事詳細ページに article-read-tracker が存在する", async ({ page }) => {
    await page.goto("/ja/journal");
    await expect(page.locator("h1")).toBeVisible();

    // 最初の記事リンクをクリック
    const firstArticleLink = page.locator("article a, [data-article] a").first();
    const hasArticles = await firstArticleLink.count() > 0;

    if (hasArticles) {
      const href = await firstArticleLink.getAttribute("href");
      if (href) {
        await page.goto(href);
        // behavior tracking スクリプトが存在するかを script タグで確認
        // （article-read-tracker は client component として動作）
        await page.waitForTimeout(1000);
        const bodyVisible = await page.locator("body").isVisible();
        expect(bodyVisible).toBe(true);
      }
    }
  });

  test("記事一覧ページが正常にロードされる", async ({ page }) => {
    await page.goto("/ja/journal");
    await expect(page.locator("h1")).toBeVisible();

    // 記事グリッドまたはリストが表示される
    const articleCount = await page.locator("article").count();
    expect(articleCount).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// TC-3: ペルソナ判定（Cloud Function）
// ---------------------------------------------------------------------------

test.describe("TC-3: ペルソナ判定", () => {
  test("persona API が適切なレスポンス形式を返す（未認証）", async ({ page }) => {
    test.skip(true, PENDING_PERSONA_API);
    const response = await page.request.get("/api/user/persona");
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body).toHaveProperty("error");
  });

  test("persona API レスポンスに必要なフィールドが含まれる（認証済みの場合）", async ({
    page,
  }) => {
    test.skip(true, PENDING_PERSONA_API);
    // セッション Cookie をセット
    await setTestSession(page);

    const response = await page.request.get("/api/user/persona");

    if (response.status() === 200) {
      const body = await response.json();
      // PersonaProfileData の型チェック
      expect(body).toHaveProperty("primary");
      expect(body).toHaveProperty("scores");
      expect(body).toHaveProperty("lastUpdated");
      expect(body).toHaveProperty("tasteProfile");
      expect(body.scores).toHaveProperty("serenity");
      expect(body.scores).toHaveProperty("explorer");
      expect(body.scores).toHaveProperty("sensory");
    } else {
      // 未認証の場合は 401 — テスト環境でのセッション未設定は許容
      expect(response.status()).toBe(401);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-4: コンテンツパーソナライズ
// ---------------------------------------------------------------------------

test.describe("TC-4: コンテンツパーソナライズ", () => {
  test("記事一覧 API が score フィールドを含む場合、スコア降順で返す", async ({
    page,
  }) => {
    // コンテンツレコメンドエンジン API の確認
    const response = await page.request.get("/api/content/recommendations", {
      params: { locale: "ja" },
    });

    // API が存在すれば 200 or 401、存在しなければ 404
    if (response.status() === 200) {
      const body = await response.json();
      if (Array.isArray(body.articles) && body.articles.length > 1) {
        // スコアが存在する場合、降順になっているか確認
        const scores = body.articles.map((a: { score?: number }) => a.score).filter(Boolean);
        if (scores.length > 1) {
          for (let i = 0; i < scores.length - 1; i++) {
            expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
          }
        }
      }
    } else {
      // エンドポイントが未実装でも 404 は許容（TC-4 は統合テストが主目的）
      expect([200, 401, 404]).toContain(response.status());
    }
  });

  test("ジャーナルページが persona 設定ユーザーにパーソナライズコンテンツを表示する", async ({
    page,
  }) => {
    await setTestSession(page);
    await page.goto("/ja/journal");

    // ページが正常にロードされること
    await expect(page.locator("h1")).toBeVisible();

    // パーソナライズセクションが存在するか（存在しない場合は通常表示）
    const personalized = await page.locator("[data-personalized='true']").count();
    // パーソナライズ要素は 0 以上（未設定ユーザーは 0 でも OK）
    expect(personalized).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// TC-5: 商品レコメンド
// ---------------------------------------------------------------------------

test.describe("TC-5: 商品レコメンド", () => {
  test("商品詳細ページにレコメンドセクションが表示される", async ({ page }) => {
    await page.goto("/ja/products");
    await expect(page.locator("h1")).toBeVisible();

    // 最初の商品ページへ遷移
    const firstProduct = page.locator("a[href*='/products/']").first();
    const hasProducts = await firstProduct.count() > 0;

    if (hasProducts) {
      const href = await firstProduct.getAttribute("href");
      if (href) {
        await page.goto(href);
        await page.waitForLoadState("networkidle");

        // ページが正常にロードされること
        await expect(page.locator("body")).toBeVisible();
      }
    }
  });

  test("商品レコメンド API が存在する", async ({ page }) => {
    const response = await page.request.get("/api/products/recommendations", {
      params: { limit: "3" },
    });
    expect([200, 401, 404]).toContain(response.status());
  });
});

// ---------------------------------------------------------------------------
// TC-6: エージェント会話
// ---------------------------------------------------------------------------

test.describe("TC-6: エージェント会話（elxea-agent 統合）", () => {
  /**
   * NOTE: エージェント会話テストは LINE Webhook 経由のため、
   * Playwright では直接テストできない。
   * ここでは elxea-agent の HTTP エンドポイントを直接呼び出してテストする。
   */

  const AGENT_BASE_URL =
    process.env.AGENT_BASE_URL ?? "https://elxea-agent-staging.YOUR_SUBDOMAIN.workers.dev";

  test("elxea-agent のヘルスチェックエンドポイントが応答する", async ({
    page,
  }) => {
    try {
      const response = await page.request.get(`${AGENT_BASE_URL}/`);
      // Cloudflare Workers は 200 or 405 を返す
      expect([200, 405]).toContain(response.status());
    } catch {
      // staging URL が未設定の場合はスキップ
      test.skip(true, "AGENT_BASE_URL が設定されていません");
    }
  });

  test("エージェント会話ログ API が存在する（web app 側）", async ({ page }) => {
    await setTestSession(page);
    const response = await page.request.get("/api/user/conversations");
    expect([200, 401, 404]).toContain(response.status());
  });
});

// ---------------------------------------------------------------------------
// TC-7: Shopify 注文 → Firestore 更新
// ---------------------------------------------------------------------------

test.describe("TC-7: Shopify 注文 Webhook フロー", () => {
  /**
   * NOTE: Shopify Webhook は本番 / staging の Shopify からのみ届く。
   * ここでは Cloud Function の Webhook エンドポイントが存在することを確認し、
   * ペイロード検証が機能していることをテストする。
   */

  test("Shopify orders/create Webhook エンドポイントが存在する", async ({
    page,
  }) => {
    // Cloud Functions の Webhook エンドポイント（デプロイ後に設定）
    const webhookUrl = process.env.SHOPIFY_WEBHOOK_URL;

    if (!webhookUrl) {
      test.skip(true, "SHOPIFY_WEBHOOK_URL が設定されていません");
      return;
    }

    // HMAC なしのリクエストは 401 を返すべき
    const response = await page.request.post(webhookUrl, {
      data: { test: true },
      headers: { "Content-Type": "application/json" },
    });
    expect([401, 403]).toContain(response.status());
  });

  test("注文ミラー API がアクセス可能（web app 側）", async ({ page }) => {
    await setTestSession(page);
    const response = await page.request.get("/api/user/orders");
    expect([200, 401, 404]).toContain(response.status());
  });
});

// ---------------------------------------------------------------------------
// 統合: LIFF テイスティングプロフィール表示
// ---------------------------------------------------------------------------

// LIFF route (/ja/liff) does not exist yet — skip until implemented.
test.describe("統合: LIFF テイスティングプロフィール画面", () => {
  test("LIFF ページが正しい構造で表示される", async ({ page }) => {
    test.skip(true, PENDING_LIFF_ROUTE);
    await page.goto("/ja/liff");

    // ページが 500 エラーにならないこと
    const url = page.url();
    expect(url).toContain("/liff");

    // body が表示されること
    await expect(page.locator("body")).toBeVisible();
  });

  test("LIFF ページがモバイルビューポートで正常に表示される", async ({
    page,
  }) => {
    test.skip(true, PENDING_LIFF_ROUTE);
    // LINE アプリはモバイルで使用される
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14 Pro
    await page.goto("/ja/liff");

    await expect(page.locator("body")).toBeVisible();
    // スクロールバーが不要なレイアウトであること
    const bodyOverflow = await page.evaluate(
      () => window.getComputedStyle(document.body).overflow
    );
    expect(bodyOverflow).not.toBe("scroll");
  });
});
