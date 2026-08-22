import { test, expect } from "@playwright/test";
import { requireVisible } from "./support/preconditions";

/**
 * 「商品カードが 0 件なら skip」を全廃した理由 (2026-08-19)
 * -------------------------------------------------------
 * 商品一覧・商品詳細は Shopify の資格情報が無くても見本カタログ
 * (`lib/preview-seed-storefront.ts` / PREVIEW_SEED_STOREFRONT) で必ず描画される
 * — つまり「商品カードが 1 件も無い」は環境差ではなく **商品一覧が壊れている**
 * ことを意味する。それを skip にしていたため、一覧が本当に壊れるとテストは赤でなく
 * 灰色になり、CI は緑のまま通過していた (= 何も見ていないのに緑)。
 *
 * 以後は `requireVisible()` を使い、前提未達を skip ではなく失敗として扱う
 * (e2e/support/preconditions.ts の既存方針。cart.spec.ts が先行採用済み)。
 * 資格情報の無い開発機だけは `E2E_ALLOW_SKIP=1` で注釈付き skip に落とせる。
 */

test.describe("Product listing page", () => {
  test("displays heading and products or placeholder", async ({ page }) => {
    await page.goto("/ja/products");

    // Heading should be visible
    const heading = page.locator("h1");
    await expect(heading).toContainText("商品一覧");

    // Page should show either product cards or a placeholder/error message
    const hasProducts = await page
      .locator("a[href*='/products/']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasPlaceholder = await page
      .getByText("商品を読み込めませんでした")
      .isVisible()
      .catch(() => false);
    const hasNoProducts = await page
      .getByText("商品が見つかりませんでした")
      .isVisible()
      .catch(() => false);

    expect(hasProducts || hasPlaceholder || hasNoProducts).toBeTruthy();
  });

  test("product cards link to product detail pages", async ({ page }) => {
    await page.goto("/ja/products");

    // Wait for product grid to load
    const productLink = page.locator("a[href*='/products/']").first();
    const hasProduct = await productLink.isVisible().catch(() => false);

    // 旧: `if (hasProduct) { ... }` — 商品が 0 件だと assert を 1 つも実行せずに
    // 緑で終わっていた (skip ですらないので CI サマリにも出ない、最も見えない形)。
    await requireVisible(productLink, "商品一覧に商品カードが 1 件以上ある");

    // Product card should have a title (h2)
    const cardTitle = productLink.locator("h2");
    await expect(cardTitle).toBeVisible();

    // Click the first product and verify navigation
    await productLink.click();
    await page.waitForURL(/\/ja\/products\/.+/);
    expect(page.url()).toMatch(/\/ja\/products\/.+/);
  });

  test("product cards show price information", async ({ page }) => {
    await page.goto("/ja/products");

    const productLink = page.locator("a[href*='/products/']").first();
    const hasProduct = await productLink.isVisible().catch(() => false);

    // 旧: `if (hasProduct) { ... }` — 上と同じ「assert ゼロで緑」の形。
    await requireVisible(productLink, "商品一覧に商品カードが 1 件以上ある");

    // Price should contain a currency symbol (JPY uses ￥ full-width via Intl.NumberFormat)
    await expect(productLink.locator("text=/[¥￥$]/")).toBeVisible();
  });
});

test.describe("Product detail page", () => {
  test("shows product title, price, and add to cart button", async ({
    page,
  }) => {
    await page.goto("/ja/products");

    // Find the first product link
    const productLink = page.locator("a[href*='/products/']").first();
    await requireVisible(
      productLink,
      "商品一覧 (/ja/products) に商品カードが 1 件以上ある (見本カタログでも必ず出る)",
    );

    // Navigate to the first product
    await productLink.click();
    await page.waitForURL(/\/ja\/products\/.+/);

    // Product title should be an h1
    const title = page.locator("h1");
    await expect(title).toBeVisible();
    const titleText = await title.textContent();
    expect(titleText?.trim().length).toBeGreaterThan(0);

    // Price should be visible (contains currency symbol, ￥ full-width via Intl.NumberFormat)
    await expect(page.locator("text=/[¥￥$]/").first()).toBeVisible();

    // Add to cart or sold out button should be visible
    const addToCartButton = page.getByText("カートに追加");
    const soldOutButton = page.getByText("売り切れ");
    const hasAddToCart = await addToCartButton.isVisible().catch(() => false);
    const hasSoldOut = await soldOutButton.isVisible().catch(() => false);
    expect(hasAddToCart || hasSoldOut).toBeTruthy();
  });

  test("shows breadcrumb navigation", async ({ page }) => {
    await page.goto("/ja/products");

    const productLink = page.locator("a[href*='/products/']").first();
    await requireVisible(
      productLink,
      "商品一覧 (/ja/products) に商品カードが 1 件以上ある (見本カタログでも必ず出る)",
    );

    await productLink.click();
    await page.waitForURL(/\/ja\/products\/.+/);

    // Breadcrumb should show Home > Products > Product Name
    const breadcrumb = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.getByText("ホーム")).toBeVisible();
    await expect(breadcrumb.getByText("商品一覧")).toBeVisible();
  });

  test("shows product description if available", async ({ page }) => {
    await page.goto("/ja/products");

    const productLink = page.locator("a[href*='/products/']").first();
    await requireVisible(
      productLink,
      "商品一覧 (/ja/products) に商品カードが 1 件以上ある (見本カタログでも必ず出る)",
    );

    await productLink.click();
    await page.waitForURL(/\/ja\/products\/.+/);

    // The product detail page should have a content area
    // Even if no description, the page should not error
    await expect(page.locator("h1")).toBeVisible();
  });

  test("variant selector appears when product has variants", async ({
    page,
  }) => {
    await page.goto("/ja/products");

    const productLink = page.locator("a[href*='/products/']").first();
    await requireVisible(
      productLink,
      "商品一覧 (/ja/products) に商品カードが 1 件以上ある (見本カタログでも必ず出る)",
    );

    await productLink.click();
    await page.waitForURL(/\/ja\/products\/.+/);

    // Check if variant selector buttons exist.
    // 旧 spec は `button[aria-pressed]` を素で拾っており、商品詳細に同居する
    // お気に入りボタン (favorite-button.tsx も aria-pressed を持つ) に当たって
    // いた。variant-selector.tsx の data-slot でスコープする。
    const variantButtons = page.locator('[data-slot="variant-option"]');
    const hasVariants =
      (await variantButtons.count().catch(() => 0)) > 0;

    if (hasVariants) {
      // Click a variant button and verify it becomes selected
      const firstButton = variantButtons.first();
      await firstButton.click();
      // After clicking, the URL should have query params for the variant
      // or the button should be in pressed state
      await expect(firstButton).toHaveAttribute("aria-pressed", "true");
    }
  });

  test("product image gallery is present", async ({ page }) => {
    await page.goto("/ja/products");

    const productLink = page.locator("a[href*='/products/']").first();
    await requireVisible(
      productLink,
      "商品一覧 (/ja/products) に商品カードが 1 件以上ある (見本カタログでも必ず出る)",
    );

    await productLink.click();
    await page.waitForURL(/\/ja\/products\/.+/);

    // Product page should have at least one image or a placeholder
    const hasImage = await page.locator("img").first().isVisible().catch(() => false);
    // Even without images, the page should render
    await expect(page.locator("h1")).toBeVisible();

    if (hasImage) {
      // Verify the image has valid src
      const src = await page.locator("img").first().getAttribute("src");
      expect(src).toBeTruthy();
    }
  });
});
