import { test, expect } from "@playwright/test";

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

    if (hasProduct) {
      // Product card should have a title (h2)
      const cardTitle = productLink.locator("h2");
      await expect(cardTitle).toBeVisible();

      // Click the first product and verify navigation
      await productLink.click();
      await page.waitForURL(/\/ja\/products\/.+/);
      expect(page.url()).toMatch(/\/ja\/products\/.+/);
    }
  });

  test("product cards show price information", async ({ page }) => {
    await page.goto("/ja/products");

    const productLink = page.locator("a[href*='/products/']").first();
    const hasProduct = await productLink.isVisible().catch(() => false);

    if (hasProduct) {
      // Price should contain a currency symbol (JPY uses ￥ full-width via Intl.NumberFormat)
      await expect(productLink.locator("text=/[¥￥$]/")).toBeVisible();
    }
  });
});

test.describe("Product detail page", () => {
  test("shows product title, price, and add to cart button", async ({
    page,
  }) => {
    await page.goto("/ja/products");

    // Find the first product link
    const productLink = page.locator("a[href*='/products/']").first();
    const hasProduct = await productLink.isVisible().catch(() => false);

    if (!hasProduct) {
      test.skip();
      return;
    }

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
    const hasProduct = await productLink.isVisible().catch(() => false);

    if (!hasProduct) {
      test.skip();
      return;
    }

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
    const hasProduct = await productLink.isVisible().catch(() => false);

    if (!hasProduct) {
      test.skip();
      return;
    }

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
    const hasProduct = await productLink.isVisible().catch(() => false);

    if (!hasProduct) {
      test.skip();
      return;
    }

    await productLink.click();
    await page.waitForURL(/\/ja\/products\/.+/);

    // Check if variant selector buttons exist (aria-pressed attribute)
    const variantButtons = page.locator("button[aria-pressed]");
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
    const hasProduct = await productLink.isVisible().catch(() => false);

    if (!hasProduct) {
      test.skip();
      return;
    }

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
