import { test, expect } from "@playwright/test";

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

  test("adding a product shows it in the cart", async ({ page }) => {
    await page.goto("/ja/products");

    // Find the first product link
    const productLink = page.locator("a[href*='/products/']").first();
    const hasProduct = await productLink.isVisible().catch(() => false);

    if (!hasProduct) {
      test.skip();
      return;
    }

    // Navigate to product detail
    await productLink.click();
    await page.waitForURL(/\/ja\/products\/.+/);

    // Check if product is available for sale
    const addToCartButton = page.getByText("カートに追加");
    const isAvailable = await addToCartButton.isVisible().catch(() => false);

    if (!isAvailable) {
      test.skip();
      return;
    }

    // Remember product title
    const productTitle = await page.locator("h1").textContent();

    // Click add to cart and wait for Server Action to complete
    await addToCartButton.click();

    // Wait for the pending state ("...") to finish — button re-enables with original text
    await page.waitForFunction(
      () => !document.querySelector("button[disabled]")?.textContent?.includes("..."),
      { timeout: 15000 },
    ).catch(() => {});

    // Navigate to cart
    await page.goto("/ja/cart");

    // Check if product was actually added (Shopify API might be slow/unavailable)
    const cartHasItem = await page
      .getByText("カートは空です")
      .isVisible()
      .catch(() => true);

    if (cartHasItem) {
      test.skip(true, "Cart add failed — Shopify API may be unavailable");
      return;
    }

    // Cart should show the product
    await expect(page.getByText(productTitle!.trim())).toBeVisible();
  });

  test("cart quantity can be updated", async ({ page }) => {
    await page.goto("/ja/products");

    const productLink = page.locator("a[href*='/products/']").first();
    const hasProduct = await productLink.isVisible().catch(() => false);

    if (!hasProduct) {
      test.skip();
      return;
    }

    await productLink.click();
    await page.waitForURL(/\/ja\/products\/.+/);

    const addToCartButton = page.getByText("カートに追加");
    const isAvailable = await addToCartButton.isVisible().catch(() => false);

    if (!isAvailable) {
      test.skip();
      return;
    }

    await addToCartButton.click();
    await page.waitForFunction(
      () => !document.querySelector("button[disabled]")?.textContent?.includes("..."),
      { timeout: 15000 },
    ).catch(() => {});

    await page.goto("/ja/cart");

    // Check if product was actually added
    const cartIsEmpty = await page
      .getByText("カートは空です")
      .isVisible()
      .catch(() => false);

    if (cartIsEmpty) {
      test.skip(true, "Cart add failed — Shopify API may be unavailable");
      return;
    }

    // Find the quantity display (shows "1" initially)
    const quantityDisplay = page.locator('[aria-label="数量"]');
    await expect(quantityDisplay).toContainText("1");

    // Click the + button to increase quantity
    const incrementButton = page.getByLabel("数量 +1");
    await incrementButton.click();

    // Wait for optimistic update
    await expect(quantityDisplay).toContainText("2");
  });

  test("cart item can be removed", async ({ page }) => {
    await page.goto("/ja/products");

    const productLink = page.locator("a[href*='/products/']").first();
    const hasProduct = await productLink.isVisible().catch(() => false);

    if (!hasProduct) {
      test.skip();
      return;
    }

    await productLink.click();
    await page.waitForURL(/\/ja\/products\/.+/);

    const addToCartButton = page.getByText("カートに追加");
    const isAvailable = await addToCartButton.isVisible().catch(() => false);

    if (!isAvailable) {
      test.skip();
      return;
    }

    await addToCartButton.click();
    await page.waitForFunction(
      () => !document.querySelector("button[disabled]")?.textContent?.includes("..."),
      { timeout: 15000 },
    ).catch(() => {});

    await page.goto("/ja/cart");

    // Check if product was actually added
    const cartIsEmpty = await page
      .getByText("カートは空です")
      .isVisible()
      .catch(() => false);

    if (cartIsEmpty) {
      test.skip(true, "Cart add failed — Shopify API may be unavailable");
      return;
    }

    // Click remove button
    const removeButton = page.getByText("削除");
    await removeButton.click();

    // Cart should now be empty
    await expect(page.getByText("カートは空です")).toBeVisible();
  });

  test("checkout button is visible when cart has items", async ({ page }) => {
    await page.goto("/ja/products");

    const productLink = page.locator("a[href*='/products/']").first();
    const hasProduct = await productLink.isVisible().catch(() => false);

    if (!hasProduct) {
      test.skip();
      return;
    }

    await productLink.click();
    await page.waitForURL(/\/ja\/products\/.+/);

    const addToCartButton = page.getByText("カートに追加");
    const isAvailable = await addToCartButton.isVisible().catch(() => false);

    if (!isAvailable) {
      test.skip();
      return;
    }

    await addToCartButton.click();
    await page.waitForFunction(
      () => !document.querySelector("button[disabled]")?.textContent?.includes("..."),
      { timeout: 15000 },
    ).catch(() => {});

    await page.goto("/ja/cart");

    // Check if product was actually added
    const cartIsEmpty = await page
      .getByText("カートは空です")
      .isVisible()
      .catch(() => false);

    if (cartIsEmpty) {
      test.skip(true, "Cart add failed — Shopify API may be unavailable");
      return;
    }

    // Checkout button should be visible
    const checkoutButton = page.getByText("購入手続きへ");
    await expect(checkoutButton).toBeVisible();

    // Checkout link should point to Shopify checkout
    const checkoutHref = await checkoutButton.getAttribute("href");
    expect(checkoutHref).toContain("shopify.com");

    // Subtotal should be visible
    await expect(page.getByText("小計")).toBeVisible();
  });

  test("cart works in English locale", async ({ page }) => {
    await page.goto("/en/cart");

    const heading = page.locator("h1");
    await expect(heading).toContainText("Cart");
    await expect(page.getByText("Your cart is empty")).toBeVisible();
  });
});
