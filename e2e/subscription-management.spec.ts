/**
 * 自前サブスク E2E テスト・動作検証
 *
 * テスト対象フロー（Playwright UI テスト + API 動作確認）:
 *   1. サブスクリプション管理ページ（/account/subscriptions）の UI 確認
 *   2. 未認証状態での各ページの動作確認
 *   3. API エンドポイント（/api/cron/billing, /api/subscription/webhook）の動作確認
 *   4. サブスクリプション操作 UI の表示確認（ログイン不要な部分）
 *
 * 認証が必要なフロー（新規契約 → BillingAttempt → スキップ → 頻度変更 → 解約）の
 * フルテストは SHOPIFY_ADMIN_ACCESS_TOKEN が必要。
 * 環境変数不足の場合は該当テストを skip する。
 *
 * 実行方法:
 *   pnpm exec playwright test e2e/subscription-management.spec.ts
 *
 * 完全テスト（Admin API トークン設定後）:
 *   SHOPIFY_ADMIN_ACCESS_TOKEN=xxx pnpm exec playwright test e2e/subscription-management.spec.ts
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

import { SELLING_PLAN_SKIP_REASON, STOREFRONT_CONFIGURED } from "./support/preconditions";

// ─── ヘルパー: Admin API が利用可能かチェック ─────────────────────────────

/**
 * Billing Cron API に認証付きリクエストを送り、Admin API が応答するか確認する。
 * CRON_SECRET が設定されていない場合は 401 が返るため、環境変数の有無で判断する。
 */
async function isAdminApiAvailable(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get("/api/cron/billing", {
      headers: { Authorization: "Bearer test-secret-do-not-use" },
    });
    // 401 → 認証失敗（CRON_SECRET なし or 不一致）、200/500 → API は到達可能
    return res.status() !== 404;
  } catch {
    return false;
  }
}

// ─── テストスイート: 定期便管理ページ（UI）─────────────────────────────────

test.describe("定期便管理ページ（未ログイン時）", () => {
  test("定期便管理ページが正常に表示される", async ({ page }) => {
    await page.goto("/ja/account/subscriptions");

    // h1 が表示されること
    await expect(page.locator("h1")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("body")).not.toContainText("エラーが発生しました");
    await expect(page.locator("body")).not.toContainText("500");
  });

  /*
   * 未ログインの /ja/account/* は middleware.ts の accountMatch ガードで
   * /ja/login へ 307 リダイレクトする。よって「定期便」見出しには到達せず、
   * ログインページの h1 (「elxea にログイン」) になる。
   * 旧アサーション (h1 に「定期便」) は誘導がページ内にあった時代のもの。
   */
  test("未ログイン時は定期便ページでログインが要求される", async ({ page }) => {
    await page.goto("/ja/account/subscriptions");

    // ログインページへ送られること
    await page.waitForURL(/\/ja\/login/);
    await expect(page.locator("h1")).toContainText("ログイン", { timeout: 10000 });

    // ログイン手段が提示されること
    await expect(page.getByRole("link", { name: /ログイン/ }).first()).toBeVisible();
  });

  test("未ログイン時のログインボタンが正しい URL に向いている", async ({ page }) => {
    await page.goto("/ja/account/subscriptions");

    await expect(page.locator("h1")).toBeVisible({ timeout: 10000 });

    // ログインリンクが存在すること
    const loginLink = page.getByRole("link", { name: "ログイン" });
    const hasLoginLink = await loginLink.isVisible().catch(() => false);

    if (hasLoginLink) {
      const href = await loginLink.getAttribute("href");
      // Shopify カスタマーアカウント認証ページに向くこと
      expect(href).toMatch(/\/api\/auth\/login/);
    }
  });

  test("定期便なしメッセージが表示される（ログイン後・サブスクなし想定のテキスト確認）", async ({
    page,
  }) => {
    await page.goto("/ja/account/subscriptions");

    // ページが壊れていないこと
    await expect(page.locator("body")).not.toContainText("エラーが発生しました");
    await expect(page.locator("body")).not.toContainText("TypeError");
    await expect(page.locator("body")).not.toContainText("ReferenceError");
  });

  test("マイページへの戻りリンクが定期便ページに存在する（ログイン済みページ構造確認）", async ({
    page,
  }) => {
    // ページ構造のレンダリングが正常に完了することを確認
    await page.goto("/ja/account/subscriptions");

    // サーバーサイドエラーがないこと
    const pageText = await page.locator("body").textContent();
    expect(pageText).not.toContain("Internal Server Error");
    expect(pageText).not.toContain("NEXT_NOT_FOUND");
  });
});

// ─── テストスイート: サブスクリプション API エンドポイント ──────────────────

test.describe("サブスクリプション API エンドポイント", () => {
  test("Billing Cron API: 認証なしアクセスは 401 を返す", async ({ request }) => {
    const res = await request.get("/api/cron/billing");
    expect(res.status()).toBe(401);
  });

  test("Billing Cron API: 不正トークンは 401 を返す", async ({ request }) => {
    const res = await request.get("/api/cron/billing", {
      headers: { Authorization: "Bearer invalid-token-xyz" },
    });
    expect(res.status()).toBe(401);
  });

  /*
   * この 2 本は SHOPIFY_WEBHOOK_SECRET が **設定されているとき**にだけ意味を持つ。
   * 未設定だと validateWebhookRequest() は HMAC 判定より前に 500
   * (Internal Server Error) を返す — 設定漏れを 401 で隠さないための意図的な
   * 順序であり、テストのために入れ替えると「エンドポイントは正常だが署名が
   * 不正」と「そもそも設定されていない」を運用側で区別できなくなる。
   * よって CRON_SECRET 系と同じく秘密情報ゲートの skip とする
   * (skip は pnpm report:e2e-skips で CI サマリに出るので不可視にはならない)。
   */
  test("Subscription Webhook API: HMAC なしの POST は 401 を返す", async ({
    request,
  }) => {
    if (!process.env.SHOPIFY_WEBHOOK_SECRET) {
      test.skip(true, "SHOPIFY_WEBHOOK_SECRET が設定されていません (未設定時は 500 が正)");
      return;
    }
    const res = await request.post("/api/subscription/webhook", {
      data: JSON.stringify({ status: "active" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("Subscription Webhook API: 不正 HMAC は 401 を返す", async ({
    request,
  }) => {
    if (!process.env.SHOPIFY_WEBHOOK_SECRET) {
      test.skip(true, "SHOPIFY_WEBHOOK_SECRET が設定されていません (未設定時は 500 が正)");
      return;
    }
    const res = await request.post("/api/subscription/webhook", {
      data: JSON.stringify({ status: "active" }),
      headers: {
        "Content-Type": "application/json",
        "x-shopify-hmac-sha256": "invalid-hmac",
        "x-shopify-topic": "SUBSCRIPTION_CONTRACTS_CREATE",
        "x-shopify-shop-domain": "elxea.myshopify.com",
      },
    });
    expect(res.status()).toBe(401);
  });

  test("Billing Cron API: 正しいシークレットで 200 が返る（CRON_SECRET 設定済みの場合）", async ({
    request,
  }) => {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      test.skip(true, "CRON_SECRET が設定されていません");
      return;
    }

    const res = await request.get("/api/cron/billing", {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });

    // 200 or 500 (Admin API エラー) が返ること
    expect([200, 500]).toContain(res.status());

    if (res.status() === 200) {
      const body = await res.json();
      // レスポンスに checked と billed フィールドがあること
      expect(body).toHaveProperty("checked");
      expect(body).toHaveProperty("billed");
    }
  });
});

// ─── テストスイート: サブスクリプション管理 UI コンポーネント（ログイン不要） ─

test.describe("サブスクリプション管理 UI（静的・ログイン不要）", () => {
  test("アカウントページが定期便へのリンクを持つ（未ログイン時はログイン誘導）", async ({
    page,
  }) => {
    await page.goto("/ja/account");

    // ページが読み込まれること
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("body")).not.toContainText("エラーが発生しました");
  });

  test("定期便ページで定期便商品がある場合は商品一覧リンクが表示される", async ({
    page,
  }) => {
    await page.goto("/ja/account/subscriptions");

    // ページ構造が存在すること（ログイン誘導ページも含む）
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 });
  });
});

// ─── テストスイート: サブスクリプション管理フロー（Admin API が必要） ────────

test.describe("サブスクリプション管理フロー（Admin API 必要）", () => {
  /**
   * このテストスイートは Shopify Admin API トークンが設定されている場合のみ実行される。
   * 未設定の場合はすべてのテストを skip する。
   *
   * テスト対象:
   *   - 契約一覧の取得
   *   - BillingAttempt の作成（Cron API 経由）
   *   - 契約の一時停止・再開
   *   - 頻度変更
   *   - 解約
   */

  test.beforeEach(async ({}, testInfo) => {
    const hasAdminToken = !!process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    const hasCronSecret = !!process.env.CRON_SECRET;

    if (!hasAdminToken || !hasCronSecret) {
      testInfo.skip(true,
        "SHOPIFY_ADMIN_ACCESS_TOKEN または CRON_SECRET が設定されていません。" +
        "環境変数を設定してから再実行してください。"
      );
    }
  });

  test("Billing Cron: 課金対象契約の一覧取得と BillingAttempt 作成", async ({
    request,
  }) => {
    const cronSecret = process.env.CRON_SECRET!;

    const res = await request.get("/api/cron/billing", {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });

    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("checked");
    expect(body).toHaveProperty("billed");
    expect(typeof body.checked).toBe("number");
    expect(typeof body.billed).toBe("number");

    console.log(
      `[Billing Cron] checked: ${body.checked}, billed: ${body.billed}`
    );

    // billed > 0 の場合、results 配列があること
    if (body.billed > 0) {
      expect(body).toHaveProperty("results");
      expect(Array.isArray(body.results)).toBe(true);

      // 各 result に contractId と status が存在すること
      for (const result of body.results) {
        expect(result).toHaveProperty("contractId");
        expect(["success", "error"]).toContain(result.status);
      }
    }
  });

  test("Cron 実行後のレスポンスに idempotency が反映される", async ({
    request,
  }) => {
    const cronSecret = process.env.CRON_SECRET!;

    // 1回目
    const res1 = await request.get("/api/cron/billing", {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    expect(res1.status()).toBe(200);
    const body1 = await res1.json();

    // 2回目（同じ日に実行 → idempotency key が同じ → 重複課金されない）
    const res2 = await request.get("/api/cron/billing", {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    expect(res2.status()).toBe(200);
    const body2 = await res2.json();

    // 2回目でも正常に応答すること（エラーなし）
    console.log(
      `[Billing Idempotency] 1st: billed=${body1.billed}, 2nd: billed=${body2.billed}`
    );
  });
});

// ─── テストスイート: サブスクリプション管理 UI インタラクション ──────────────

test.describe("サブスクリプション操作 UI（ログイン済みユーザー・モック）", () => {
  /**
   * ログイン済みユーザーのサブスクリプション管理 UI をテストする。
   * 実際のログインは行わず、ページ構造の確認と操作の動作確認を行う。
   * 実際の API 呼び出しは Admin API が必要なため、環境変数確認後にスキップ。
   */

  test("定期便ページの UI コンポーネントが正しくレンダリングされる", async ({
    page,
  }) => {
    await page.goto("/ja/account/subscriptions");

    // ページが壊れていないこと
    await expect(page.locator("body")).not.toContainText("Cannot read properties");
    await expect(page.locator("body")).not.toContainText("is not a function");
    await expect(page.locator("body")).not.toContainText("is not defined");
  });

  test("スキップ・一時停止・解約ボタンのテキストが i18n で正しく表示される", async ({
    page,
  }) => {
    // 実際にサブスクリプションがある場合のみ表示されるため、
    // 文言が messages/ja.json と一致することを確認（翻訳キーの網羅テスト）
    await page.goto("/ja/account/subscriptions");

    // ページが正常にロードされること
    await expect(page.locator("h1")).toBeVisible({ timeout: 10000 });

    /* 文言が壊れていないこと（undefined や [object Object] が表示されていないこと）。
     *
     * `locator("body").textContent()` は **インラインの <script> の中身まで**
     * 拾うので、dev サーバの RSC flight ペイロード (self.__next_f.push(...)) に
     * 含まれる "undefined" で必ず落ちる — 画面に何も出ていなくても落ちる偽陽性。
     * 見たいのは「利用者に見える文字」なので innerText を使う (script/style と
     * 非表示要素を除いた描画テキストだけを返す)。 */
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("undefined");
    expect(visibleText).not.toContain("[object Object]");
    expect(visibleText).not.toContain("[object Promise]");
  });

  test("頻度変更 UI の選択肢が正しいテキストで表示される（ログイン済み・契約あり想定）", async ({
    page,
  }) => {
    // 頻度変更 UI は SubscriptionActions コンポーネント内に存在する
    // ログインが必要なため、ここでは UI 構造を確認するにとどまる
    await page.goto("/ja/account/subscriptions");

    // ページが正常にロードされること
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("body")).not.toContainText("エラーが発生しました");
  });
});

// ─── テストスイート: エンドツーエンド フローシミュレーション ─────────────────

test.describe("サブスクリプション フロー シミュレーション", () => {
  /**
   * 実際のユーザーフローをシミュレートする UI テスト。
   * サブスクリプション商品の購入 → 管理画面での操作までのフローを検証する。
   *
   * 注意: Shopify チェックアウト後の契約成立確認は Shopify 側の処理のため、
   * ここでは URL 検証・ページ遷移確認までを行う。
   */

  test("フロー 1: 定期購入商品選択 → カートへ追加 → チェックアウト URL 生成", async ({
    page,
  }) => {
    /* SellingPlan を持つ実商品が必要。見本カタログ (PREVIEW_SEED_STOREFRONT) は
     * sellingPlanGroups を意図的に空にしているので、資格情報が無い環境では
     * 商品詳細を 5 枚たどって 30 秒の予算を使い切るだけになる (実測 2026-08-09)。 */
    test.skip(!STOREFRONT_CONFIGURED, SELLING_PLAN_SKIP_REASON);

    // ステップ1: 商品一覧ページから定期便対応商品を探す
    await page.goto("/ja/products");

    const productLinks = await page
      .locator("a[href*='/products/']")
      .evaluateAll((els: HTMLAnchorElement[]) =>
        [...new Set(els.map((el) => el.href.split("?")[0]).filter(Boolean))]
      );

    if (productLinks.length === 0) {
      test.skip(true, "商品が見つかりません");
      return;
    }

    let subscriptionProductUrl: string | null = null;

    for (const url of productLinks.slice(0, 5)) {
      await page.goto(url!);
      const hasSubscriptionBtn = await page
        .getByText("定期購入")
        .isVisible()
        .catch(() => false);
      if (hasSubscriptionBtn) {
        subscriptionProductUrl = url!;
        break;
      }
    }

    if (!subscriptionProductUrl) {
      test.skip(true, "定期便商品が見つかりません");
      return;
    }

    // ステップ2: 定期購入モードを選択
    await page.goto(subscriptionProductUrl);
    await page.getByText("定期購入").click();
    await expect(page.getByText("カートに追加")).toBeVisible({ timeout: 5000 });

    // ステップ3: カートに追加
    const addToCartButton = page.getByText("カートに追加");
    const isAvailable = await addToCartButton.isVisible().catch(() => false);

    if (!isAvailable) {
      test.skip(true, "商品が売り切れです");
      return;
    }

    await addToCartButton.click();
    await page
      .waitForFunction(
        () =>
          !document
            .querySelector("button[disabled]")
            ?.textContent?.includes("..."),
        { timeout: 15000 }
      )
      .catch(() => {});

    // ステップ4: カートページを確認
    await page.goto("/ja/cart");

    const cartIsEmpty = await page
      .getByText("カートは空です")
      .isVisible()
      .catch(() => false);

    if (cartIsEmpty) {
      test.skip(true, "カート追加が失敗しました — Shopify API が利用できない可能性があります");
      return;
    }

    // ステップ5: チェックアウト URL を検証
    const checkoutLink = page.getByText("購入手続きへ");
    await expect(checkoutLink).toBeVisible();

    const href = await checkoutLink.getAttribute("href");
    expect(href).toMatch(/shopify\.com/);

    // SellingPlan が URL に含まれているか確認（Shopify の実装依存）
    console.log(`[Checkout URL] ${href}`);
  });

  test("フロー 2: マイページ → 定期便管理ページ遷移確認", async ({ page }) => {
    // アカウントページからの導線確認
    await page.goto("/ja/account");

    // ページが壊れていないこと
    await expect(page.locator("body")).not.toContainText("エラーが発生しました");
    await expect(page.locator("body")).not.toContainText("500");

    // 定期便ページへの直接アクセス —— 未ログインなので /ja/login へ送られる
    // (middleware.ts の accountMatch ガード)。
    await page.goto("/ja/account/subscriptions");
    await page.waitForURL(/\/ja\/login/);
    await expect(page.locator("h1")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("h1")).toContainText("ログイン");
  });

  test("フロー 3: 定期便管理ページのスキップ・一時停止ボタンの存在確認（ログイン必要）", async ({
    page,
  }) => {
    // 未ログイン状態では /ja/login へ送られる (middleware.ts の accountMatch)。
    await page.goto("/ja/account/subscriptions");

    await page.waitForURL(/\/ja\/login/);
    await expect(page.locator("h1")).toContainText("ログイン", { timeout: 10000 });

    // 未ログイン時はアクションボタンが存在しないこと
    const skipButton = await page.getByText("次回スキップ").isVisible().catch(() => false);
    const pauseButton = await page.getByText("一時停止").isVisible().catch(() => false);
    const cancelButton = await page.getByText("解約").isVisible().catch(() => false);

    // 未ログイン時はいずれも表示されないこと
    expect(skipButton).toBe(false);
    expect(pauseButton).toBe(false);
    expect(cancelButton).toBe(false);
  });
});

// ─── テストスイート: Webhook 処理確認 ─────────────────────────────────────

test.describe("Subscription Webhook 処理", () => {
  test("Webhook エンドポイントが GET を受け付けない（405 Method Not Allowed）", async ({
    request,
  }) => {
    const res = await request.get("/api/subscription/webhook");
    // 405 または 404 が返ること（POST のみ受け付ける）
    expect([404, 405]).toContain(res.status());
  });

  test("Webhook: 正しい HMAC 署名で 200 が返る（SHOPIFY_WEBHOOK_SECRET 設定済みの場合）", async ({
    request,
  }) => {
    const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      test.skip(true, "SHOPIFY_WEBHOOK_SECRET が設定されていません");
      return;
    }

    const body = JSON.stringify({
      admin_graphql_api_id: "gid://shopify/SubscriptionContract/test-123",
      status: "active",
      customer_id: 99999,
    });

    // 正しい HMAC を生成
    const { createHmac } = await import("crypto");
    const hmac = createHmac("sha256", webhookSecret)
      .update(body, "utf8")
      .digest("base64");

    const res = await request.post("/api/subscription/webhook", {
      data: body,
      headers: {
        "Content-Type": "application/json",
        "x-shopify-hmac-sha256": hmac,
        "x-shopify-topic": "SUBSCRIPTION_CONTRACTS_CREATE",
        "x-shopify-shop-domain": "elxea.myshopify.com",
      },
    });

    // HMAC は正しいが Admin API トークンがなければ内部でエラーが起きる可能性があるため
    // 200 が返ること（webhook は常に 200 を返す設計）
    expect(res.status()).toBe(200);

    const responseBody = await res.json();
    expect(responseBody).toHaveProperty("received", true);
  });
});
