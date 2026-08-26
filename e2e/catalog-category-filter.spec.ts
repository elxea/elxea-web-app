import { test, expect, type Page } from "@playwright/test";

/**
 * 「分類のリンクを押したら、必ず絞り込まれる」を縛る。
 *
 * ## 何を守っているか (通しテスト E-3 / 2026-08-27)
 *
 * トップの CATEGORIES タイルは Shopify のコレクション名で
 * `?category=<名前>` へ飛ぶ。ところが商品一覧の絞り込み軸は productType
 * だったので、コレクション名 (「お茶のアソートセット」「お茶の定期便」
 * 「お茶のコレクション」) は**未知の値として黙って「すべて」に落ち**、押しても
 * 12 件が全部出るだけだった。押した人から見れば「リンクが効いていない」。
 *
 * 直し方は 2 段:
 *   1. productType で拾えない名前はコレクションの**所属**で絞る
 *      (`lib/shopify/category-filter.ts` / 判断の単体テストは
 *       `__tests__/category-filter.test.ts`)
 *   2. 中身が空のコレクションはタイルにも一覧にも出さない (押した先が必ず
 *      0 件になる入口を作らない)
 *
 * ここは**実データで通し**て裏を取る。判断が正しくても、タイルの行き先や
 * 一覧側の配線が外れていれば実害は残るため。
 */

/** 表示件数の上限 (PAGE_SIZE=12) を外して「全部」を数えるための値。 */
const SHOW_ALL = 100;

/** 商品一覧を開いて、出ている商品カードの数を返す。 */
async function countProducts(page: Page, query: string): Promise<number> {
  await page.goto(`/ja/products${query}`, { waitUntil: "domcontentloaded" });
  await page
    .locator('[data-slot="catalog-toolbar"]')
    .waitFor({ state: "visible", timeout: 30_000 });
  return page
    .locator('[data-slot="catalog-grid"] [data-slot="catalog-card"]')
    .count();
}

/** トップのカテゴリータイル。フッター等の同じ形の導線を巻き込まないよう絞る。 */
const categoryTiles = (page: Page) =>
  page.locator('[data-slot="action-tile"][href*="/products?category="]');

test.describe("分類の入口は必ず絞り込みに着地する", () => {
  test.describe.configure({ timeout: 120_000 });

  test("トップのカテゴリータイルは、どれを押しても件数が減る", async ({ page }) => {
    const total = await countProducts(page, `?show=${SHOW_ALL}`);
    test.skip(total === 0, "商品が 1 件も出ていない (Shopify 未接続)");

    await page.goto("/ja", { waitUntil: "domcontentloaded" });
    const tiles = categoryTiles(page);
    const tileCount = await tiles.count();
    expect(tileCount, "トップにカテゴリータイルが出ている").toBeGreaterThan(0);

    const targets: { label: string; query: string }[] = [];
    for (let i = 0; i < tileCount; i += 1) {
      const href = (await tiles.nth(i).getAttribute("href")) ?? "";
      const label = ((await tiles.nth(i).innerText()) || "").trim().split("\n")[0];
      const category = new URL(href, "https://example.test").searchParams.get("category");
      if (category) targets.push({ label, query: category });
    }
    expect(targets.length, "行き先つきのタイルが取れている").toBeGreaterThan(0);

    for (const target of targets) {
      const filtered = await countProducts(
        page,
        `?category=${encodeURIComponent(target.query)}&show=${SHOW_ALL}`,
      );

      expect(
        filtered,
        `「${target.label}」を押した先が 0 件 (行き止まり)。空のコレクションは` +
          `タイルに出さないこと (app/[locale]/page.tsx の hasProducts)。`,
      ).toBeGreaterThan(0);

      expect(
        filtered,
        `「${target.label}」を押しても全 ${total} 件が出たまま = 絞り込まれていない。` +
          `productType で拾えない名前はコレクションの所属で絞ること ` +
          `(lib/shopify/category-filter.ts)。`,
      ).toBeLessThan(total);
    }
  });

  test("絞り込み中はチップが選択状態になる (何で絞られたか分かる)", async ({ page }) => {
    await page.goto("/ja", { waitUntil: "domcontentloaded" });
    const tile = categoryTiles(page).first();
    test.skip((await tile.count()) === 0, "トップにカテゴリータイルが無い");

    const label = ((await tile.innerText()) || "").trim().split("\n")[0];
    await tile.click();
    await page.waitForURL(/\/products\?category=/, { timeout: 30_000 });

    /* 「すべて」が選ばれたままだと、件数だけ減って理由も解除の仕方も分からない。 */
    const pressed = page.locator('[data-slot="catalog-chip"][aria-pressed="true"]');
    await expect(
      pressed,
      `「${label}」で絞り込んだのに選択状態のチップが 1 枚も無い`,
    ).toHaveCount(1);
    await expect(pressed).not.toHaveText("すべて");
  });

  test("実在しない分類は「すべて」に落とす (0 件の行き止まりを作らない)", async ({
    page,
  }) => {
    const total = await countProducts(page, `?show=${SHOW_ALL}`);
    test.skip(total === 0, "商品が 1 件も出ていない (Shopify 未接続)");

    const bogus = await countProducts(
      page,
      `?category=${encodeURIComponent("存在しない分類")}&show=${SHOW_ALL}`,
    );
    expect(bogus, "URL 直打ちの未知の分類は全件表示に落とす").toBe(total);
  });
});
