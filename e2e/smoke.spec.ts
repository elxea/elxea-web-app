import { test, expect } from "@playwright/test";

test.describe("Smoke tests", () => {
  test("homepage loads and shows elxea heading", async ({ page }) => {
    await page.goto("/ja");
    await expect(page).toHaveTitle(/elxea/i);

    // The hero section has h1 with tagline
    const heading = page.locator("h1");
    await expect(heading).toBeVisible();
  });

  test("homepage shows key sections", async ({ page }) => {
    await page.goto("/ja");

    /*
     * 節名は C レーンのトップ再設計で変わった。「おすすめ商品」「最新の記事」は
     * 存在しない (app/[locale]/page.tsx)。ここでは **無条件に描画される**節だけを
     * 見る: TEA LEAVES (茶葉) と ELXEA — OVERVIEW (elxea でできること)。
     * SEASONAL / CATEGORIES / JOURNAL / EVENT / VOICES は Sanity・Shopify の
     * データ有無で出入りするので smoke では見ない (深さは各 spec が持つ)。
     */
    await expect(page.getByText("TEA LEAVES")).toBeVisible();
    await expect(page.getByText("ELXEA — OVERVIEW")).toBeVisible();
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

  // Un-fixme'd 2026-08-07: CI does receive NEXT_PUBLIC_SANITY_PROJECT_ID with the
  // production dataset, so the journal renders. Depth coverage lives in journal.spec.ts.
  test("journal page loads", async ({ page }) => {
    await page.goto("/ja/journal");
    await expect(page.locator("h1")).toContainText("ジャーナル", {
      timeout: 15000,
    });
  });

  // 農家一覧 (/ja/farmers) は 2026-08-14 に廃止。農家詳細 (/ja/farmers/[slug])
  // は存続するが、slug は Sanity の実データ依存なので smoke には載せない。

  test("events page loads", async ({ page }) => {
    await page.goto("/ja/events");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("about page loads", async ({ page }) => {
    await page.goto("/ja/about");
    // h1 は節タイトルではなくリード見出し。ページ名「elxeaについて」は
    // <title> とパンくずにあり、h1 ではない (C レーン確定版)。
    await expect(page).toHaveTitle(/elxeaについて/);
    await expect(page.locator("h1")).toContainText("日本各地の、小さな茶園から。");
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

    // Desktop nav has products, journal, events links
    // (農家 は一覧ページ廃止 2026-08-14 に伴い nav からも外した)
    const nav = page.locator("nav").first();
    await expect(nav.getByText("商品一覧")).toBeVisible();
    await expect(nav.getByText("ジャーナル")).toBeVisible();
    await expect(nav.getByText("農家")).toHaveCount(0);
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
    await page.locator('header a[href="/ja"]').click();
    await page.waitForURL(/\/ja$/);
    expect(page.url()).toMatch(/\/ja$/);
  });
});

test.describe("Footer", () => {
  test("footer contains shop links", async ({ page }) => {
    await page.goto("/ja");
    // getByRole, not locator("footer"): `next dev` renders its own <footer>
    // inside the error-overlay markup, which makes a bare tag selector a
    // strict-mode violation whenever the overlay is present.
    const footer = page.getByRole("contentinfo");

    await expect(footer.getByText("ショップ")).toBeVisible();
    await expect(footer.getByText("商品一覧")).toBeVisible();
    await expect(footer.getByText("コレクション")).toBeVisible();
  });

  test("footer contains content links", async ({ page }) => {
    await page.goto("/ja");
    // getByRole, not locator("footer"): `next dev` renders its own <footer>
    // inside the error-overlay markup, which makes a bare tag selector a
    // strict-mode violation whenever the overlay is present.
    const footer = page.getByRole("contentinfo");

    await expect(footer.getByText("コンテンツ")).toBeVisible();
    await expect(footer.getByText("ジャーナル")).toBeVisible();
    // 農家一覧の廃止 (2026-08-14) でフッターからも外した。
    await expect(footer.getByText("農家")).toHaveCount(0);
    await expect(footer.getByText("イベント")).toBeVisible();
  });

  test("footer contains support links", async ({ page }) => {
    await page.goto("/ja");
    // getByRole, not locator("footer"): `next dev` renders its own <footer>
    // inside the error-overlay markup, which makes a bare tag selector a
    // strict-mode violation whenever the overlay is present.
    const footer = page.getByRole("contentinfo");

    await expect(footer.getByText("サポート")).toBeVisible();
    await expect(footer.getByText("elxeaについて")).toBeVisible();
    await expect(footer.getByText("よくあるご質問")).toBeVisible();
    await expect(footer.getByText("お問い合わせ")).toBeVisible();
    await expect(footer.getByText("送料について")).toBeVisible();
  });

  test("footer contains legal links", async ({ page }) => {
    await page.goto("/ja");
    // getByRole, not locator("footer"): `next dev` renders its own <footer>
    // inside the error-overlay markup, which makes a bare tag selector a
    // strict-mode violation whenever the overlay is present.
    const footer = page.getByRole("contentinfo");
    const legalNav = footer.locator('nav[aria-label="Legal"]');

    await expect(legalNav.getByText("特定商取引法に基づく表記")).toBeVisible();
    await expect(legalNav.getByText("プライバシーポリシー")).toBeVisible();
    await expect(legalNav.getByText("利用規約")).toBeVisible();
    await expect(legalNav.getByText("返品・交換ポリシー")).toBeVisible();
  });

  test("footer shows copyright", async ({ page }) => {
    await page.goto("/ja");
    // getByRole, not locator("footer"): `next dev` renders its own <footer>
    // inside the error-overlay markup, which makes a bare tag selector a
    // strict-mode violation whenever the overlay is present.
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByText(/© \d{4} elxea/)).toBeVisible();
  });
});

test.describe("Language switcher", () => {
  // Middleware redirects /en/* to /ja/* (English content not ready).
  // These tests verify the redirect behavior instead of English content.

  test("en redirects to ja (middleware 301)", async ({ page }) => {
    await page.goto("/en");
    await page.waitForURL(/\/ja/);
    expect(page.url()).toContain("/ja");
  });

  test("en/products redirects to ja/products", async ({ page }) => {
    await page.goto("/en/products");
    await page.waitForURL(/\/ja\/products/);
    expect(page.url()).toContain("/ja/products");
  });
});
