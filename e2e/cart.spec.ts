import { test, expect } from "@playwright/test";

import {
  STOREFRONT_CONFIGURED,
  addToCart,
  gotoNonEmptyCart,
  openPurchasableProduct,
} from "./support/preconditions";

test.describe("Cart", () => {
  test("cart page shows empty state initially", async ({ page }) => {
    await page.goto("/ja/cart");

    // Heading
    const heading = page.locator("h1");
    await expect(heading).toContainText("カート");

    // Empty cart message
    await expect(page.getByText("カートは空です")).toBeVisible();

    // Link to products (scope to main to avoid matching nav/footer)
    await expect(page.locator("main").getByText("商品一覧")).toBeVisible();
  });

  test("cart page empty state links to products", async ({ page }) => {
    await page.goto("/ja/cart");

    // Click the products link from empty cart (scope to main to avoid matching nav/footer)
    await page.locator("main").getByText("商品一覧").click();
    await page.waitForURL(/\/ja\/products/);
    expect(page.url()).toContain("/ja/products");
  });

  test("cart is accessible from header", async ({ page }) => {
    await page.goto("/ja");

    const header = page.locator("header");
    await header.getByText("カート").click();
    await page.waitForURL(/\/ja\/cart/);
    expect(page.url()).toContain("/ja/cart");
  });

  test("cart works in English locale", async ({ page }) => {
    await page.goto("/en/cart");

    // /en redirects to /ja per i18n middleware — verify cart loads after redirect
    const heading = page.locator("h1");
    await expect(heading).toContainText("カート");
  });
});

/**
 * The purchase happy path: product -> cart -> checkout hand-off.
 *
 * This replaces four near-identical specs that each wrapped every step in
 * `if (!ok) { test.skip(); return; }`. With Shopify unreachable all four
 * skipped and CI stayed green while verifying nothing (2026-08-07 test audit,
 * finding "不足 #2"). Preconditions now fail loudly — see
 * `e2e/support/preconditions.ts`.
 *
 * It is one linear journey rather than four independent tests on purpose: each
 * of the old tests paid the full "open product, add to cart, wait for the
 * Server Action" cost just to assert one thing, and each was an independent
 * chance to silently skip.
 */
test.describe("Checkout happy path", () => {
  test("product -> cart -> quantity -> checkout hand-off -> remove", async ({ page }) => {
    /*
     * この 1 本だけは Shopify Storefront の資格情報が **必須**。
     *
     * 見本カタログ (PREVIEW_SEED_STOREFRONT=1 / lib/preview-seed-storefront.ts)
     * で商品一覧・商品詳細・検索は動くようになったが、このテストが検証するのは
     * その先の「カート書き込み → 実チェックアウトへの受け渡し」で、下の
     * アサーションが要求するのは実物である:
     *   - `cartCreate` / `cartLinesAdd` が Shopify に **書き込めること**
     *   - 受け渡し先が `https://*.shopify.com/...` で、cart 識別子を持ち、
     *     実際に GET して 400 未満で返ること
     * 見本の checkoutUrl を通すのは、このテストが存在する理由そのもの
     * (受け渡しが本当に成立するか) を捨てることになる。よって資格情報が無い
     * 環境では **理由付きで skip** し、テストを弱めない。
     * skip は `pnpm report:e2e-skips` で CI サマリに出るので不可視にはならない。
     */
    test.skip(
      !STOREFRONT_CONFIGURED,
      "Shopify Storefront の資格情報 (SHOPIFY_STORE_DOMAIN / " +
        "SHOPIFY_STOREFRONT_ACCESS_TOKEN) が未設定 — 実カート書き込みと実チェックアウト " +
        "URL の到達性は見本データで代替できない",
    );

    // --- add ---------------------------------------------------------------
    const productTitle = await openPurchasableProduct(page);
    await addToCart(page);
    await gotoNonEmptyCart(page);

    // The product we added is the product in the cart.
    await expect(page.getByText(productTitle)).toBeVisible();

    // --- quantity ----------------------------------------------------------
    const quantityDisplay = page.locator('[aria-label="数量"]').first();
    await expect(quantityDisplay).toContainText("1");
    await page.getByLabel("数量 +1").first().click();
    await expect(quantityDisplay).toContainText("2");

    // --- checkout hand-off -------------------------------------------------
    // The audit flagged that this used to assert visibility only. The point of
    // the cart is that it hands the customer to a real Shopify checkout, so we
    // assert the destination is a usable checkout URL and that it actually
    // resolves — not merely that a button is on screen.
    const checkoutButton = page.getByRole("link", { name: "購入手続きへ" });
    await expect(checkoutButton).toBeVisible();

    const checkoutHref = await checkoutButton.getAttribute("href");
    expect(checkoutHref, "checkout button has no href").toBeTruthy();
    expect(checkoutHref!).toMatch(/^https:\/\/[^/]*shopify\.com\/.+/);
    // Shopify checkout URLs carry the cart identity; a bare domain means the
    // cart id was lost between the Server Action and the render.
    expect(checkoutHref!.length, "checkout URL carries no cart identity").toBeGreaterThan(
      "https://x.myshopify.com/".length + 10,
    );

    const checkoutResponse = await page.request.get(checkoutHref!, { maxRedirects: 5 });
    expect(
      checkoutResponse.status(),
      `Shopify checkout URL returned ${checkoutResponse.status()}`,
    ).toBeLessThan(400);

    // Subtotal is part of the hand-off contract.
    await expect(page.getByText("小計")).toBeVisible();

    // --- remove ------------------------------------------------------------
    await page.getByText("削除").first().click();
    await expect(page.getByText("カートは空です")).toBeVisible();
  });
});
