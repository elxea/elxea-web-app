import { test, expect } from "@playwright/test";

import { requireVisible, unmetPrecondition } from "./support/preconditions";

/**
 * Journal (Sanity CMS) reading journey — list -> article detail -> related links.
 *
 * Journal is one of the two beta-critical areas and previously had zero E2E
 * coverage (the only journal test in smoke.spec.ts was `test.fixme`).
 *
 * Missing CMS content is treated as a precondition failure, not a silent skip:
 * a journal with no articles is a broken beta, and the run must say so.
 */
test.describe("Journal", () => {
  test("journal list renders articles (not the empty/error fallback)", async ({ page }) => {
    await page.goto("/ja/journal");

    await expect(page.locator("h1")).toContainText("ジャーナル");

    // The page renders one of three states: cards, `journal.empty`, or
    // `journal.loadError`. Only the first is acceptable.
    await expect(
      page.getByText("記事の読み込みに失敗しました"),
      "journal list rendered the Sanity load-error fallback",
    ).toHaveCount(0);

    const articleLinks = page.locator("main a[href^='/ja/journal/']");
    await expect
      .poll(() => articleLinks.count(), {
        message: "journal list rendered no article links (empty CMS or failed fetch)",
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    // Each card must carry a readable title, not just an image.
    await expect(page.locator("main h2").first()).not.toBeEmpty();
  });

  test("article detail opens from the list and renders body content", async ({ page }) => {
    await page.goto("/ja/journal");

    const firstArticle = page
      .locator("main a[href^='/ja/journal/']")
      .filter({ hasNotText: "" })
      .first();
    await requireVisible(firstArticle, "journal list has at least one article link");

    const href = await firstArticle.getAttribute("href");
    if (!href) unmetPrecondition("journal article link has an href");

    await page.goto(href);
    await expect(page).toHaveURL(/\/ja\/journal\/[^/]+$/);

    // Detail page must render its own title, not the CMS load-error fallback.
    await expect(page.getByText("記事の読み込みに失敗しました")).toHaveCount(0);
    const heading = page.locator("h1").first();
    await expect(heading).toBeVisible();
    await expect(heading).not.toBeEmpty();

    // Body copy is rendered (article body, member gate, or both — but the
    // article container itself must exist and carry text).
    const article = page.locator("main").first();
    await expect(article).toContainText(/\S/);
  });

  test("article detail exposes related navigation back into the journal", async ({ page }) => {
    await page.goto("/ja/journal");

    const firstArticle = page.locator("main a[href^='/ja/journal/']").first();
    await requireVisible(firstArticle, "journal list has at least one article link");
    const href = await firstArticle.getAttribute("href");
    if (!href) unmetPrecondition("journal article link has an href");

    await page.goto(href);

    // Related navigation is any journal-internal link other than this article:
    // category, tag, author, or a related-article card.
    const relatedLinks = page.locator(`main a[href*='/ja/journal']:not([href$='${href}'])`);
    await expect
      .poll(() => relatedLinks.count(), {
        message: "article detail has no related journal navigation (category/tag/author/related)",
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    // Following one of them must land inside the journal section and render.
    const target = relatedLinks.first();
    const targetHref = await target.getAttribute("href");
    if (!targetHref) unmetPrecondition("related journal link has an href");

    await page.goto(targetHref);
    await expect(page).toHaveURL(/\/ja\/journal/);
    await expect(page.locator("h1").first()).toBeVisible();
  });
});
