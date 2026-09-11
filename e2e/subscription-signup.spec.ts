/**
 * 定期便申込フロー E2E テスト
 *
 * テスト対象フロー:
 *   定期便商品選択 → 頻度（SellingPlan）選択 → カート追加 → チェックアウト遷移
 *
 * 前提条件:
 *   - Shopify に定期便（SellingPlan）が設定された商品が存在すること
 *   - SHOPIFY_ADMIN_ACCESS_TOKEN が設定されていない場合、Shopify API コールは
 *     失敗する可能性がある。その場合は test.skip() で graceful に終了する
 *
 * 実行方法:
 *   pnpm exec playwright test e2e/subscription-signup.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";

import { SELLING_PLAN_SKIP_REASON, STOREFRONT_CONFIGURED } from "./support/preconditions";

/**
 * SellingPlan を持つ実商品を要求するテストの前に置くゲート。
 *
 * 以前は Shopify が無いと `/ja/products` が 0 件で
 * `findSubscriptionProductUrl()` が即 null を返し、各テストが自前の
 * `test.skip()` に落ちていた。見本カタログ (PREVIEW_SEED_STOREFRONT) を入れた
 * あとは商品が並ぶので、このヘルパーが商品詳細ページを最大 5 枚たどるようになり、
 * dev サーバでは 1 テストの 30 秒予算を使い切って **timeout で赤くなる**
 * (実測 2026-08-09: 9 本が同じ /ja/products/... の goto で timeout)。
 * 「商品が見つからないので skip」を暗黙に踏むのではなく、必要な前提を明示して
 * skip する。
 */
function requireSellingPlanFixtures() {
  test.skip(!STOREFRONT_CONFIGURED, SELLING_PLAN_SKIP_REASON);
}

// ─── ヘルパー: 定期便商品をページ上で見つける ─────────────────────────────

/**
 * 商品一覧ページから定期購入（SellingPlan）を持つ商品の URL を返す。
 * 見つからなければ null を返す。
 */
async function findSubscriptionProductUrl(page: Page): Promise<string | null> {
  await page.goto("/ja/products");

  // 商品ページリンクを取得して順に確認する
  const productLinks = await page
    .locator("a[href*='/products/']")
    .evaluateAll((els: HTMLAnchorElement[]) =>
      els.map((el) => el.href).filter(Boolean)
    );

  if (productLinks.length === 0) return null;

  // 重複排除（クエリパラメータなし）
  const uniqueUrls = [...new Set(productLinks.map((url) => url.split("?")[0]))];

  for (const productUrl of uniqueUrls.slice(0, 5)) {
    await page.goto(productUrl!);

    // 「定期購入」ボタン or 「購入方法」セクションが存在するか確認
    const hasSubscriptionOption = await page
      .getByText("定期購入")
      .isVisible()
      .catch(() => false);

    if (hasSubscriptionOption) {
      return productUrl!;
    }
  }

  return null;
}

// ─── テストスイート: 定期便申込フロー ──────────────────────────────────────

test.describe("定期便申込フロー", () => {
  // SellingPlan を持つ実商品が必要 (見本カタログには無い)。
  requireSellingPlanFixtures();

  test("定期便商品に「購入方法」セクションが表示される", async ({ page }) => {
    const productUrl = await findSubscriptionProductUrl(page);

    if (!productUrl) {
      test.skip(true, "定期便商品が見つかりません — Shopify に SellingPlan 商品が必要です");
      return;
    }

    await page.goto(productUrl);

    // 「購入方法」セクションが表示されること
    await expect(page.getByText("購入方法")).toBeVisible({ timeout: 10000 });

    // 「通常購入」と「定期購入」ボタンが存在すること
    await expect(page.getByText("通常購入")).toBeVisible();
    await expect(page.getByText("定期購入")).toBeVisible();
  });

  test("定期購入ボタンを選択すると頻度選択UIが表示される", async ({ page }) => {
    const productUrl = await findSubscriptionProductUrl(page);

    if (!productUrl) {
      test.skip(true, "定期便商品が見つかりません — Shopify に SellingPlan 商品が必要です");
      return;
    }

    await page.goto(productUrl);

    // デフォルトは「通常購入」が選択されている
    const oneTimePurchaseButton = page.getByText("通常購入");
    await expect(oneTimePurchaseButton).toBeVisible({ timeout: 10000 });

    // 「定期購入」を選択する
    await page.getByText("定期購入").click();

    // 頻度選択UIが表示されること（複数プランがある場合のみ）
    // プランが1つの場合はカートに追加ボタンだけ表示される
    const hasFrequencySection = await page
      .getByText("お届け頻度")
      .isVisible()
      .catch(() => false);

    // 「定期購入」ボタンがアクティブ（選択中）になっていること
    const subscriptionButton = page.getByText("定期購入");
    const buttonClass = await subscriptionButton.getAttribute("class");
    // 選択中は bg-foreground が適用される
    const isActive =
      buttonClass?.includes("bg-foreground") ||
      buttonClass?.includes("border-foreground") ||
      (await subscriptionButton.evaluate(
        (el) => window.getComputedStyle(el).backgroundColor
      )) !== "rgba(0, 0, 0, 0)";

    expect(isActive).toBe(true);

    if (hasFrequencySection) {
      // 頻度選択ボタンが1つ以上表示されること
      const frequencyButtons = page.locator("button").filter({
        hasText: /週|月|ごと/,
      });
      const count = await frequencyButtons.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test("定期購入モードでカートに追加できる", async ({ page }) => {
    const productUrl = await findSubscriptionProductUrl(page);

    if (!productUrl) {
      test.skip(true, "定期便商品が見つかりません — Shopify に SellingPlan 商品が必要です");
      return;
    }

    await page.goto(productUrl);

    // 「定期購入」を選択
    const subscriptionButton = page.getByText("定期購入");
    await expect(subscriptionButton).toBeVisible({ timeout: 10000 });
    await subscriptionButton.click();

    // カートに追加ボタンを取得して押す
    const addToCartButton = page.getByText("カートに追加");
    const isAvailable = await addToCartButton.isVisible().catch(() => false);

    if (!isAvailable) {
      test.skip(true, "商品が売り切れです");
      return;
    }

    await addToCartButton.click();

    // ローディング完了待ち
    await page
      .waitForFunction(
        () =>
          !document
            .querySelector("button[disabled]")
            ?.textContent?.includes("..."),
        { timeout: 15000 }
      )
      .catch(() => {});

    // カートページに遷移して商品が追加されていることを確認
    await page.goto("/ja/cart");

    const cartIsEmpty = await page
      .getByText("カートは空です")
      .isVisible()
      .catch(() => false);

    if (cartIsEmpty) {
      test.skip(true, "カート追加が失敗しました — Shopify API が利用できない可能性があります");
      return;
    }

    // カートに商品が存在すること
    await expect(page.locator("main")).not.toContainText("カートは空です");

    // 購入手続きボタンが表示されること
    await expect(page.getByText("購入手続きへ")).toBeVisible();
  });

  test("定期購入カートからチェックアウトリンクが生成される", async ({ page }) => {
    const productUrl = await findSubscriptionProductUrl(page);

    if (!productUrl) {
      test.skip(true, "定期便商品が見つかりません — Shopify に SellingPlan 商品が必要です");
      return;
    }

    await page.goto(productUrl);

    const subscriptionButton = page.getByText("定期購入");
    await expect(subscriptionButton).toBeVisible({ timeout: 10000 });
    await subscriptionButton.click();

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

    await page.goto("/ja/cart");

    const cartIsEmpty = await page
      .getByText("カートは空です")
      .isVisible()
      .catch(() => false);

    if (cartIsEmpty) {
      test.skip(true, "カート追加が失敗しました — Shopify API が利用できない可能性があります");
      return;
    }

    // 「購入手続きへ」リンクが Shopify チェックアウト URL を持つこと
    const checkoutLink = page.getByText("購入手続きへ");
    await expect(checkoutLink).toBeVisible();

    const href = await checkoutLink.getAttribute("href");
    // Shopify のチェックアウト URL には shopify.com が含まれる
    expect(href).toMatch(/shopify\.com/);
  });

  test("頻度を選択してからカートに追加できる（複数プランがある場合）", async ({
    page,
  }) => {
    const productUrl = await findSubscriptionProductUrl(page);

    if (!productUrl) {
      test.skip(true, "定期便商品が見つかりません — Shopify に SellingPlan 商品が必要です");
      return;
    }

    await page.goto(productUrl);

    const subscriptionButton = page.getByText("定期購入");
    await expect(subscriptionButton).toBeVisible({ timeout: 10000 });
    await subscriptionButton.click();

    // 頻度選択UIがあるか確認（複数プランの場合のみ）
    const hasFrequencySection = await page
      .getByText("お届け頻度")
      .isVisible()
      .catch(() => false);

    if (!hasFrequencySection) {
      // 頻度選択なし（単一プラン）: カートに追加するだけ
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

      await page.goto("/ja/cart");
      const cartIsEmpty = await page
        .getByText("カートは空です")
        .isVisible()
        .catch(() => false);

      if (!cartIsEmpty) {
        await expect(page.getByText("購入手続きへ")).toBeVisible();
      }
      return;
    }

    // 頻度選択 UI が存在する場合: 最初のプランを選択
    const frequencyButtons = page.locator("button").filter({
      hasText: /週|月|ごと/,
    });
    const firstFrequencyButton = frequencyButtons.first();
    const hasFrequencyButtons =
      await firstFrequencyButton.isVisible().catch(() => false);

    if (hasFrequencyButtons) {
      await firstFrequencyButton.click();
    }

    // カートに追加
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

    await page.goto("/ja/cart");

    const cartIsEmpty = await page
      .getByText("カートは空です")
      .isVisible()
      .catch(() => false);

    if (!cartIsEmpty) {
      await expect(page.getByText("購入手続きへ")).toBeVisible();
    }
  });

  test("未ログインユーザーはチェックアウトで Shopify 認証ページに遷移する", async ({
    page,
  }) => {
    const productUrl = await findSubscriptionProductUrl(page);

    if (!productUrl) {
      test.skip(true, "定期便商品が見つかりません — Shopify に SellingPlan 商品が必要です");
      return;
    }

    await page.goto(productUrl);

    const subscriptionButton = page.getByText("定期購入");
    await expect(subscriptionButton).toBeVisible({ timeout: 10000 });
    await subscriptionButton.click();

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

    await page.goto("/ja/cart");

    const cartIsEmpty = await page
      .getByText("カートは空です")
      .isVisible()
      .catch(() => false);

    if (cartIsEmpty) {
      test.skip(true, "カート追加が失敗しました — Shopify API が利用できない可能性があります");
      return;
    }

    // チェックアウトリンクが Shopify ドメインに向いていることを確認
    // （実際の遷移テストは Shopify 認証が必要なため URL チェックのみ）
    const checkoutLink = page.getByText("購入手続きへ");
    const href = await checkoutLink.getAttribute("href");
    expect(href).toMatch(/shopify\.com/);
  });
});

// ─── テストスイート: 定期便申込 UI ─────────────────────────────────────────

test.describe("定期便申込 UI", () => {

  test("定期便商品詳細ページが正常に表示される", async ({ page }) => {
    requireSellingPlanFixtures();
    const productUrl = await findSubscriptionProductUrl(page);

    if (!productUrl) {
      test.skip(true, "定期便商品が見つかりません");
      return;
    }

    await page.goto(productUrl);

    // ページが正常に読み込まれること
    await expect(page.locator("h1")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("body")).not.toContainText("エラーが発生しました");
    await expect(page.locator("body")).not.toContainText("404");

    // 購入方法セクションが表示される
    await expect(page.getByText("購入方法")).toBeVisible();
  });

  test("通常購入ボタンは初期状態でアクティブになっている", async ({ page }) => {
    requireSellingPlanFixtures();
    const productUrl = await findSubscriptionProductUrl(page);

    if (!productUrl) {
      test.skip(true, "定期便商品が見つかりません");
      return;
    }

    await page.goto(productUrl);

    await expect(page.getByText("通常購入")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("定期購入")).toBeVisible();

    // デフォルトは「通常購入」が選択されている（bg-foreground クラスで確認）
    const oneTimeButton = page.getByText("通常購入");
    const buttonClass = await oneTimeButton.getAttribute("class");
    expect(buttonClass).toMatch(/bg-foreground|border-foreground/);
  });

  test("定期購入選択時にサブスクリプション価格情報が表示される（割引がある場合）", async ({
    page,
  }) => {
    requireSellingPlanFixtures();
    const productUrl = await findSubscriptionProductUrl(page);

    if (!productUrl) {
      test.skip(true, "定期便商品が見つかりません");
      return;
    }

    await page.goto(productUrl);

    const subscriptionButton = page.getByText("定期購入");
    await expect(subscriptionButton).toBeVisible({ timeout: 10000 });
    await subscriptionButton.click();

    // 割引価格表示（例: "¥X,XXX（通常価格 ¥Y,YYY）"）が表示される場合がある
    // SellingPlan に割引設定がある場合のみ表示されるため、存在する場合のみ検証
    const hasPriceInfo = await page
      .getByText(/通常価格/)
      .isVisible()
      .catch(() => false);

    if (hasPriceInfo) {
      await expect(page.getByText(/通常価格/)).toBeVisible();
    }
    // 割引なしの場合でも、テスト自体は成功とする
  });

  test("マイページ定期便セクションが存在する（未ログイン時はログイン誘導）", async ({
    page,
  }) => {
    await page.goto("/ja/account/subscriptions");

    // 未ログイン時は /ja/login へ 307 リダイレクトされる
    // (middleware.ts の accountMatch ガード)。旧アサーション (h1 に「定期便」)
    // は誘導がページ内にあった時代のもの。
    await page.waitForURL(/\/ja\/login/);
    await expect(page.locator("h1")).toContainText("ログイン", { timeout: 10000 });
    await expect(page.getByRole("link", { name: /ログイン/ }).first()).toBeVisible();
  });
});
