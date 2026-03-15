import { test, expect } from "@playwright/test";

test.describe("Membership page", () => {
  test("membership page loads with plan cards (ja)", async ({ page }) => {
    await page.goto("/ja/membership");
    await expect(page.locator("h1")).toContainText("メンバーシッププラン");

    // Three plan cards should be visible
    await expect(page.getByText("フリー")).toBeVisible();
    await expect(page.getByText("スタンダード")).toBeVisible();
    await expect(page.getByText("プレミアム")).toBeVisible();
  });

  test("membership page loads with plan cards (en)", async ({ page }) => {
    await page.goto("/en/membership");
    await expect(page.locator("h1")).toContainText("Membership Plans");

    await expect(page.getByText("Free")).toBeVisible();
    await expect(page.getByText("Standard")).toBeVisible();
    await expect(page.getByText("Premium")).toBeVisible();
  });

  test("plan cards show feature lists", async ({ page }) => {
    await page.goto("/ja/membership");

    // Features should be listed
    await expect(page.getByText("全商品の閲覧")).toBeVisible();
    await expect(page.getByText("公開ジャーナル記事")).toBeVisible();
    await expect(page.getByText("会員限定記事・レシピ")).toBeVisible();
    await expect(page.getByText("プレミアム限定コンテンツ")).toBeVisible();
  });

  test("premium plan shows coming soon", async ({ page }) => {
    await page.goto("/ja/membership");
    await expect(page.getByText("近日公開")).toBeVisible();
  });

  test("unauthenticated user sees free as current plan", async ({ page }) => {
    await page.goto("/ja/membership");
    // Unauthenticated → tier is "none" → Free plan should show "現在のプラン"
    const freePlanCard = page.locator("div").filter({ hasText: /フリー/ }).first();
    await expect(freePlanCard.getByText("現在のプラン")).toBeVisible();
  });
});

test.describe("Account page membership section", () => {
  test("unauthenticated user sees login prompt", async ({ page }) => {
    await page.goto("/ja/account");
    await expect(page.getByText("マイページを表示するにはログインが必要です")).toBeVisible();
  });
});

test.describe("Member gate on content pages", () => {
  test("journal page loads without error", async ({ page }) => {
    await page.goto("/ja/journal");
    await expect(page.locator("h1")).toContainText("ジャーナル");
    // Page should render without membership errors
    await expect(page.locator("body")).not.toContainText("エラーが発生しました");
  });

  test("events page loads without error", async ({ page }) => {
    await page.goto("/ja/events");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("エラーが発生しました");
  });
});
