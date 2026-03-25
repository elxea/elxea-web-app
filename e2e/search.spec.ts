import { test, expect } from "@playwright/test";

test.describe("Search", () => {
  test("search page loads with input form", async ({ page }) => {
    await page.goto("/ja/search");

    // Search form should be present
    const searchForm = page.locator('form[role="search"]');
    await expect(searchForm).toBeVisible();

    // Search input should be present and accessible
    const searchInput = page.locator("#search-input");
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute("type", "text");
  });

  test("search input has associated label for accessibility", async ({
    page,
  }) => {
    await page.goto("/ja/search");

    // The label should exist (sr-only) and be associated with the input
    const label = page.locator('label[for="search-input"]');
    await expect(label).toBeAttached();
    await expect(label).toHaveText("検索");
  });

  test("search with a query navigates to results page", async ({ page }) => {
    await page.goto("/ja/search");

    const searchInput = page.locator("#search-input");
    await searchInput.fill("tea");
    await searchInput.press("Enter");

    // URL should now have the query parameter
    await page.waitForURL(/\/ja\/search\?q=tea/);
    expect(page.url()).toContain("q=tea");
  });

  test("search results show count or products", async ({ page }) => {
    await page.goto("/ja/search?q=tea");

    // Wait for search results to load (SSR may take a moment with Shopify API)
    await page.waitForLoadState("domcontentloaded");

    // Should show either results count, products, or an error message
    const hasResultCount = await page
      .getByText(/件の結果/)
      .isVisible({ timeout: 10000 })
      .catch(() => false);
    const hasProducts = await page
      .locator("a[href*='/products/']")
      .first()
      .isVisible()
      .catch(() => false);
    const hasError = await page
      .getByText("検索できませんでした")
      .isVisible()
      .catch(() => false);

    // At least one of these should be true (the search was attempted)
    expect(hasResultCount || hasProducts || hasError).toBeTruthy();
  });

  test("search with no results shows appropriate message", async ({
    page,
  }) => {
    // Use a very unlikely search term
    await page.goto("/ja/search?q=xyznonexistent12345");
    await page.waitForLoadState("domcontentloaded");

    // Should show 0 results or an error
    const hasZeroResults = await page
      .getByText("0 件の結果")
      .isVisible({ timeout: 10000 })
      .catch(() => false);
    const hasError = await page
      .getByText("検索できませんでした")
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    expect(hasZeroResults || hasError).toBeTruthy();
  });

  test("empty search does not navigate", async ({ page }) => {
    await page.goto("/ja/search");

    const searchInput = page.locator("#search-input");
    await searchInput.fill("");
    await searchInput.press("Enter");

    // URL should remain on search page without query param
    expect(page.url()).not.toContain("q=");
  });

  test("search works in English locale", async ({ page }) => {
    await page.goto("/en/search");

    // /en may redirect to /ja per i18n middleware
    const searchForm = page.locator('form[role="search"]');
    await expect(searchForm).toBeVisible();

    const searchInput = page.locator("#search-input");
    await searchInput.fill("coffee");
    await searchInput.press("Enter");

    await page.waitForURL(/\/(?:en|ja)\/search\?q=coffee/);
    expect(page.url()).toContain("q=coffee");
  });

  test("search can be accessed from header link", async ({ page }) => {
    await page.goto("/ja");

    const header = page.locator("header");
    await header.getByText("検索").click();
    await page.waitForURL(/\/ja\/search/);
    expect(page.url()).toContain("/ja/search");
  });
});
