import { test, expect } from "@playwright/test";

test.describe("Mobile viewport", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true });

  test("homepage loads on mobile", async ({ page }) => {
    await page.goto("/ja");
    await expect(page).toHaveTitle(/elxea/i);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("hamburger menu is visible and desktop nav is hidden", async ({
    page,
  }) => {
    await page.goto("/ja");

    // Hamburger menu button should be visible
    const menuButton = page.getByRole("button", { name: "Menu" });
    await expect(menuButton).toBeVisible();

    // Desktop nav should be hidden on mobile
    const desktopNav = page.locator("header nav");
    await expect(desktopNav).toBeHidden();
  });

  test("mobile menu opens and shows navigation links", async ({ page }) => {
    await page.goto("/ja");

    // Open mobile menu
    await page.getByRole("button", { name: "Menu" }).click();

    // Wait for the sheet to open
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // Navigation links should be visible in mobile menu
    await expect(sheet.getByText("商品一覧")).toBeVisible();
    await expect(sheet.getByText("ジャーナル")).toBeVisible();
    await expect(sheet.getByText("農家")).toBeVisible();
    await expect(sheet.getByText("イベント")).toBeVisible();
  });

  test("mobile menu navigation works and closes menu", async ({ page }) => {
    await page.goto("/ja");

    // Open mobile menu
    await page.getByRole("button", { name: "Menu" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // Click products link
    await sheet.getByText("商品一覧").click();
    await page.waitForURL(/\/ja\/products/);

    // Menu should close after navigation
    await expect(sheet).toBeHidden();

    // Products page should load
    await expect(page.locator("h1")).toContainText("商品一覧");
  });

  test("cart link is always visible on mobile", async ({ page }) => {
    await page.goto("/ja");

    const header = page.locator("header");
    await expect(header.getByText("カート")).toBeVisible();
  });

  test("product listing page is responsive", async ({ page }) => {
    await page.goto("/ja/products");
    await expect(page.locator("h1")).toContainText("商品一覧");

    // Product cards should be visible
    const productLinks = page.locator("a[href*='/products/']");
    const count = await productLinks.count();
    if (count > 0) {
      await expect(productLinks.first()).toBeVisible();
    }
  });

  test("product detail page is usable on mobile", async ({ page }) => {
    await page.goto("/ja/products");

    const productLink = page.locator("a[href*='/products/']").first();
    const hasProduct = await productLink.isVisible().catch(() => false);

    if (!hasProduct) {
      test.skip();
      return;
    }

    await productLink.click();
    await page.waitForURL(/\/ja\/products\/.+/);

    // Title should be visible
    await expect(page.locator("h1")).toBeVisible();

    // Add to cart or sold out button should be visible
    const addToCart = page.getByText("カートに追加");
    const subscribe = page.getByText("定期購入する");
    const soldOut = page.getByText("売り切れ");
    const hasAction =
      (await addToCart.isVisible().catch(() => false)) ||
      (await subscribe.isVisible().catch(() => false)) ||
      (await soldOut.isVisible().catch(() => false));
    expect(hasAction).toBeTruthy();
  });

  test("footer is accessible on mobile", async ({ page }) => {
    await page.goto("/ja");
    // getByRole, not locator("footer"): `next dev` renders its own <footer>
    // inside the error-overlay markup, which makes a bare tag selector a
    // strict-mode violation whenever the overlay is present.
    const footer = page.getByRole("contentinfo");

    // Scroll to footer
    await footer.scrollIntoViewIfNeeded();

    await expect(footer.getByText("ショップ")).toBeVisible();
    await expect(footer.getByText("コンテンツ")).toBeVisible();
    await expect(footer.getByText("サポート")).toBeVisible();
    await expect(footer.getByText(/© \d{4} elxea/)).toBeVisible();
  });

  test("search page works on mobile", async ({ page }) => {
    await page.goto("/ja");

    // Open mobile menu to access search
    await page.getByRole("button", { name: "Menu" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // Click search in mobile menu
    await sheet.getByText("検索").click();
    await page.waitForURL(/\/ja\/search/);

    // Search input should be visible
    const searchInput = page.locator("#search-input");
    await expect(searchInput).toBeVisible();

    // Type and search
    await searchInput.fill("tea");
    await searchInput.press("Enter");
    await page.waitForURL(/\/ja\/search\?q=tea/);
  });
});

// Tablet viewport — use viewport override instead of devices to avoid worker split
test.describe("Tablet viewport", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("homepage loads on tablet", async ({ page }) => {
    await page.goto("/ja");
    await expect(page).toHaveTitle(/elxea/i);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("navigation is appropriate for tablet width", async ({ page }) => {
    await page.goto("/ja");

    // At 768px (md breakpoint), desktop nav should be visible
    const desktopNav = page.locator("header nav");
    const menuButton = page.getByRole("button", { name: "Menu" });

    const hasDesktopNav = await desktopNav.isVisible().catch(() => false);
    const hasMobileMenu = await menuButton.isVisible().catch(() => false);

    // Either desktop nav or mobile menu should be accessible
    expect(hasDesktopNav || hasMobileMenu).toBeTruthy();
  });
});
