import { test, expect } from "@playwright/test";

test.describe("Smoke tests", () => {
  test("homepage loads and shows elxea heading", async ({ page }) => {
    await page.goto("/ja");
    await expect(page).toHaveTitle(/elxea/i);

    // The hero section has "elxea" as an h1
    const heading = page.locator("h1");
    await expect(heading).toContainText("elxea");
  });

  test("homepage shows key sections", async ({ page }) => {
    await page.goto("/ja");

    // Featured products section
    await expect(page.getByText("おすすめ商品")).toBeVisible();

    // Latest journal section
    await expect(page.getByText("最新の記事")).toBeVisible();

    // Upcoming events section
    await expect(page.getByText("近日開催のイベント")).toBeVisible();
  });

  test("root / redirects to /ja", async ({ page }) => {
    await page.goto("/");
    // Playwright locale is set to ja-JP in config, so middleware redirects to /ja
    await page.waitForURL(/\/ja/);
    expect(page.url()).toContain("/ja");
  });

  test("products page loads", async ({ page }) => {
    await page.goto("/ja/products");
    const heading = page.locator("h1");
    await expect(heading).toContainText("商品一覧");
  });

  test("collections page loads", async ({ page }) => {
    await page.goto("/ja/collections");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("journal page loads", async ({ page }) => {
    await page.goto("/ja/journal");
    await expect(page.locator("h1")).toContainText("ジャーナル");
  });

  test("farmers page loads", async ({ page }) => {
    await page.goto("/ja/farmers");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("events page loads", async ({ page }) => {
    await page.goto("/ja/events");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("about page loads", async ({ page }) => {
    await page.goto("/ja/about");
    await expect(page.locator("h1")).toContainText("elxeaについて");
  });

  test("faq page loads", async ({ page }) => {
    await page.goto("/ja/faq");
    await expect(page.locator("h1")).toContainText("よくあるご質問");
  });
});

test.describe("Navigation", () => {
  test("header navigation links are present and functional", async ({
    page,
  }) => {
    await page.goto("/ja");

    // Desktop nav has products, journal, farmers, events links
    const nav = page.locator("nav").first();
    await expect(nav.getByText("商品一覧")).toBeVisible();
    await expect(nav.getByText("ジャーナル")).toBeVisible();
    await expect(nav.getByText("農家")).toBeVisible();
    await expect(nav.getByText("イベント")).toBeVisible();

    // Click products link and verify navigation
    await nav.getByText("商品一覧").click();
    await page.waitForURL(/\/ja\/products/);
    expect(page.url()).toContain("/ja/products");
  });

  test("header shows search, login/account, and cart links", async ({
    page,
  }) => {
    await page.goto("/ja");
    const header = page.locator("header");

    await expect(header.getByText("検索")).toBeVisible();
    await expect(header.getByText("カート")).toBeVisible();
    // Login or account link should be visible
    const hasLogin = await header.getByText("ログイン").isVisible().catch(() => false);
    const hasAccount = await header.getByText("マイページ").isVisible().catch(() => false);
    expect(hasLogin || hasAccount).toBeTruthy();
  });

  test("logo links back to homepage", async ({ page }) => {
    await page.goto("/ja/products");
    await page.locator("header").getByText("elxea").click();
    await page.waitForURL(/\/ja$/);
    expect(page.url()).toMatch(/\/ja$/);
  });
});

test.describe("Footer", () => {
  test("footer contains shop links", async ({ page }) => {
    await page.goto("/ja");
    const footer = page.locator("footer");

    await expect(footer.getByText("ショップ")).toBeVisible();
    await expect(footer.getByText("商品一覧")).toBeVisible();
    await expect(footer.getByText("コレクション")).toBeVisible();
  });

  test("footer contains content links", async ({ page }) => {
    await page.goto("/ja");
    const footer = page.locator("footer");

    await expect(footer.getByText("コンテンツ")).toBeVisible();
    await expect(footer.getByText("ジャーナル")).toBeVisible();
    await expect(footer.getByText("農家")).toBeVisible();
    await expect(footer.getByText("イベント")).toBeVisible();
  });

  test("footer contains support links", async ({ page }) => {
    await page.goto("/ja");
    const footer = page.locator("footer");

    await expect(footer.getByText("サポート")).toBeVisible();
    await expect(footer.getByText("elxeaについて")).toBeVisible();
    await expect(footer.getByText("よくあるご質問")).toBeVisible();
    await expect(footer.getByText("お問い合わせ")).toBeVisible();
    await expect(footer.getByText("送料について")).toBeVisible();
  });

  test("footer contains legal links", async ({ page }) => {
    await page.goto("/ja");
    const footer = page.locator("footer");
    const legalNav = footer.locator('nav[aria-label="Legal"]');

    await expect(legalNav.getByText("特定商取引法に基づく表記")).toBeVisible();
    await expect(legalNav.getByText("プライバシーポリシー")).toBeVisible();
    await expect(legalNav.getByText("利用規約")).toBeVisible();
    await expect(legalNav.getByText("返品・交換ポリシー")).toBeVisible();
  });

  test("footer shows copyright", async ({ page }) => {
    await page.goto("/ja");
    const footer = page.locator("footer");
    await expect(footer.getByText(/© \d{4} elxea/)).toBeVisible();
  });
});

test.describe("Language switcher", () => {
  test("switches from ja to en", async ({ page }) => {
    await page.goto("/ja");
    const footer = page.locator("footer");

    // Click the English language button in footer
    await footer.getByText("English").click();
    await page.waitForURL(/\/en/);
    expect(page.url()).toContain("/en");

    // Verify page is now in English
    const heading = page.locator("h1");
    await expect(heading).toContainText("elxea");

    // Navigation should be in English (scope to nav to avoid strict mode violation)
    const nav = page.locator("nav").first();
    await expect(nav.getByText("Products")).toBeVisible();
  });

  test("switches from en to ja", async ({ page }) => {
    await page.goto("/en");
    const footer = page.locator("footer");

    // Click the Japanese language button in footer
    await footer.getByText("日本語").click();
    await page.waitForURL(/\/ja/);
    expect(page.url()).toContain("/ja");

    // Navigation should be in Japanese (scope to nav to avoid strict mode violation)
    const nav = page.locator("nav").first();
    await expect(nav.getByText("商品一覧")).toBeVisible();
  });

  test("en locale products page loads correctly", async ({ page }) => {
    await page.goto("/en/products");
    const heading = page.locator("h1");
    await expect(heading).toContainText("Products");
  });
});
