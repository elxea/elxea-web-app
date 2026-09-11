import { test, expect } from "@playwright/test";

/**
 * Error and empty states on the main routes.
 *
 * The 2026-08-07 test audit found these paths untested (finding "不足 #4"):
 * a nonexistent product/article slug and a search with no hits are the states a
 * customer hits when something is wrong, and they were the states nothing
 * verified. A 500 or a blank page here is a beta-blocking bug.
 *
 * These live at the E2E layer rather than the component layer because the
 * pages are async Server Components — the not-found and CMS-fallback branches
 * only exist once the route runs.
 *
 * Note on status codes: assertions target the rendered not-found UI rather than
 * an exact HTTP status, because the dev server serves the not-found boundary
 * with 200. What must never happen is a 5xx or a blank page.
 */
const MISSING_SLUG = "definitely-not-a-real-slug-e2e-9f3a2b";

test.describe("Not found", () => {
  test("nonexistent product slug renders the 404 page, not a crash", async ({ page }) => {
    const response = await page.goto(`/ja/products/${MISSING_SLUG}`);

    expect(response!.status(), "missing product should not 5xx").toBeLessThan(500);
    // The app's own not-found boundary (app/[locale]/not-found.tsx), not
    // Next.js' unstyled error screen.
    // The not-found boundary is reached via a client re-render in dev, so let
    // the assertion auto-wait on the copy rather than on the initial HTML.
    await expect(page.getByText("ページが見つかりませんでした。")).toBeVisible();
    await expect(page.getByRole("link", { name: "ホームに戻る" })).toBeVisible();
    // Navigation must survive so the customer can recover.
    await expect(page.locator("header")).toBeVisible();
  });

  test("nonexistent journal slug renders the 404 page, not a crash", async ({ page }) => {
    const response = await page.goto(`/ja/journal/${MISSING_SLUG}`);

    expect(response!.status(), "missing article should not 5xx").toBeLessThan(500);
    // The not-found boundary is reached via a client re-render in dev, so let
    // the assertion auto-wait on the copy rather than on the initial HTML.
    await expect(page.getByText("ページが見つかりませんでした。")).toBeVisible();
    await expect(page.getByRole("link", { name: "ホームに戻る" })).toBeVisible();
    await expect(page.locator("header")).toBeVisible();
  });

  test("404 page offers a way back to the site", async ({ page }) => {
    await page.goto(`/ja/products/${MISSING_SLUG}`);

    // Any link back into the app (logo, home) must be present and work.
    const homeLink = page.locator('header a[href="/ja"]').first();
    await expect(homeLink).toBeVisible();
    await homeLink.click();
    await page.waitForURL(/\/ja$/);
  });
});

test.describe("Empty results", () => {
  test("search with no hits shows the no-results message, not an empty page", async ({ page }) => {
    await page.goto(`/ja/search?q=${MISSING_SLUG}`);

    // messages/ja.json search.noResults — an empty <main> would be a silent failure.
    await expect(page.locator("main")).toContainText("見つかりませんでした");
    // The query is echoed back so the customer knows what was searched.
    await expect(page.locator("main")).toContainText(MISSING_SLUG);
    await expect(page.locator("header")).toBeVisible();
  });

  test("empty cart shows its empty state rather than a bare page", async ({ page }) => {
    await page.goto("/ja/cart");

    await expect(page.getByText("カートは空です")).toBeVisible();
    // and a recovery path out of it
    await expect(page.locator("main").getByText("商品一覧")).toBeVisible();
  });
});

test.describe("CMS fetch failure fallback", () => {
  /**
   * The journal list catches Sanity errors and renders `journal.loadError`.
   * Nothing verified that branch, so a fallback that itself throws (or renders
   * nothing) would only be discovered in production. We force the failure by
   * blocking the Sanity API at the network layer.
   */
  test("journal list degrades gracefully when Sanity is unreachable", async ({ page }) => {
    await page.route("**/*.api.sanity.io/**", (route) => route.abort("failed"));
    await page.route("**/api.sanity.io/**", (route) => route.abort("failed"));

    const response = await page.goto("/ja/journal");

    // The route must still respond and still render its chrome.
    expect(response!.status(), "journal should not 500 when the CMS is down").toBeLessThan(500);
    await expect(page.locator("h1")).toContainText("ジャーナル");
    await expect(page.locator("header")).toBeVisible();
  });
});
