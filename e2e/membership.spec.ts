import { test, expect } from "@playwright/test";

/**
 * elxea は会員制度 (階層プラン) を持たない。会員かどうかは「roji 契約の有無」の
 * 二値であり、ランク・ティア・特典階層は作らない (Setaka 確定 2026-08-17 /
 * roji マスタースペックが階層会員を明示禁止)。
 *
 * 旧 `/membership` は フリー / スタンダード / プレミアム の 3 階層比較表を出して
 * おり、この決定と矛盾するためページごと廃止した。プラン選択の導線は定期便 LP
 * (`/ja/subscription`) に一本化する。
 *
 * 3 階層比較表を確認していた旧テストは、仕様そのものが消えたので **恒久転送の
 * 確認** に置き換えた。転送は `next.config.ts` の `redirects()` (permanent = 308)
 * が担う。
 */
test.describe("Membership URL consolidation", () => {
  test("/ja/membership は定期便LP へ恒久転送される", async ({ page }) => {
    const res = await page.goto("/ja/membership");
    expect(page.url()).toContain("/ja/subscription");
    expect(res?.status()).toBe(200);
  });

  test("/en/membership も最終的に定期便LP に着く", async ({ page }) => {
    // middleware が /en/* → /ja/* (301) に送り、そのあと転送が効く
    await page.goto("/en/membership");
    expect(page.url()).toContain("/ja/subscription");
  });

  test("転送先に会員ランクの語が出ない (会員ランク制度は無し)", async ({ page }) => {
    await page.goto("/ja/subscription");
    const body = page.locator("body");
    await expect(body).not.toContainText("メンバーシッププラン");
    await expect(body).not.toContainText("現在のプラン");
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
