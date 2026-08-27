/**
 * 憲章 R9 — 台帳が宣言した「応答の出し方」を、**性質**として確かめる。
 *
 * ## なぜ壁時計 (「0.3 秒以内」) で測らないのか
 *
 * 初版の案は `IMMEDIATE_FEEDBACK_BUDGET_MS = 300` をそのまま assert するもの
 * だった。**それは成立しない。** このスイートの `webServer` は `pnpm dev`
 * (`playwright.config.ts`) で、`next dev` は**ルートを最初のリクエストで初めて
 * コンパイルする**。初回アクセスの壁時計は数百 ms〜秒単位で揺れるので、300ms の
 * 閾値は恒常的に flaky になり、`--retries=2` で握り潰されるか、そのうち誰も見ない
 * 赤になる。それは網羅表が S5 で批判した「見ていない緑」を別の形で作るだけである。
 *
 * ## 代わりに何を測るか — 時間ではなく依存関係
 *
 * 「押した瞬間に効く」の本質は速さではなく、**サーバの応答を待たずに画面が
 * 完成すること**である。これは時間ではなく依存関係の性質なので、機械の速さに
 * 一切左右されない形で確かめられる。
 *
 * | 台帳の `response` | assert する内容 | 判定方法 |
 * |---|---|---|
 * | `optimistic` | `observe` の**全要素**が、書き込みの往復を遮断した状態でも更新完了する | ネットワーク遮断 (時間非依存) |
 * | `asset-load` | 切替先アセットが**操作前に取得済み**である | 事前取得の有無 (時間非依存) |
 * | `sync-dom` | `observe` の全要素が、ネットワーク遮断下でも更新完了する | ネットワーク遮断 (時間非依存) |
 *
 * 予算値 `IMMEDIATE_FEEDBACK_BUDGET_MS` は**設計上の約束の正本として引き続き
 * 参照する**が、CI の assert は上表の性質検査に置き換える。壁時計での実測は
 * 本番 URL 相手の `staging-smoke` に置く場所であって、`pnpm dev` 相手に
 * 絶対時間を測らない、が原則。
 *
 * ## 台帳との配線
 *
 * 下の `SCENARIOS` は **台帳の id をキーに持つ**。台帳で `exempt` を外して
 * 応答を宣言した行は、ここに操作の仕方を書かないと
 * `__tests__/interaction-inventory.test.ts` が落ちる。**宣言だけして検査しない**
 * が原理的にできない形にしてある (宣言が増えるほど検査も増える)。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test, expect, type Page } from "@playwright/test";

import { STOREFRONT_CONFIGURED, addToCart, openPurchasableProduct } from "./support/preconditions";

type Interaction = {
  id: string;
  file: string;
  kind: string;
  name: string;
  response?: string;
  observe?: string[];
  exempt?: string;
};

/** 台帳。**この spec が台帳を実際に読んでいる**ことが配線 assert の対象。 */
export const INVENTORY: Interaction[] = JSON.parse(
  readFileSync(join(process.cwd(), "interaction-inventory.json"), "utf8"),
).interactions;

/** 応答を宣言した行 (= 検査の対象)。 */
export const DECLARED = INVENTORY.filter((row) => !row.exempt && row.response);

/**
 * 台帳の 1 行を、実際に「押す」ところまで持っていく手順。
 *
 * `requiresCart` は Shopify Storefront の資格情報を要する操作の印。CI には
 * 資格情報が無く (`ci.yml` は `PREVIEW_SEED_STOREFRONT=1` のみ)、カートへの
 * 書き込み (`cartCreate` / `cartLinesAdd`) は実ストアにしか無い。既存の
 * `Checkout happy path` と**同じ理由で同じ扱い** — 見本で代替すると検査そのものが
 * 消えるので、資格情報が無い環境では理由付きで skip する。skip は
 * `pnpm report:e2e-skips` で CI サマリに出るので不可視にはならない。
 */
export const SCENARIOS: Record<
  string,
  {
    requiresCart?: boolean;
    /** 操作対象のページへ移動し、押せる状態にする。 */
    arrive: (page: Page) => Promise<void>;
    /** 実際に押す。 */
    act: (page: Page) => Promise<void>;
    /** 書き込みの往復として遮断する URL。 */
    blocks?: string;
  }
> = {
  "components/product/image-gallery.tsx#handler:onClick#2": {
    /* 網羅表 G1。サムネイルを押したときに大きい写真がすぐ出るのは、
       押す前にその 1 枚を取ってあるからで、速いからではない。
       だから「取ってあるか」を見る。 */
    arrive: async (page) => {
      await openPurchasableProduct(page);
      await expect(page.locator("[role='listbox'] button").nth(1)).toBeVisible();
    },
    act: async (page) => {
      await page.locator("[role='listbox'] button").nth(1).click();
    },
  },

  "components/product/add-to-cart-button.tsx#handler:onClick#1": {
    requiresCart: true,
    blocks: "**/products/**",
    arrive: async (page) => {
      await openPurchasableProduct(page);
    },
    act: async (page) => {
      await page.getByRole("button", { name: "カートに追加" }).click();
    },
  },

  "components/cart/cart-content.tsx#handler:onQuantityChange#1": {
    requiresCart: true,
    blocks: "**/cart**",
    arrive: async (page) => {
      await openPurchasableProduct(page);
      await addToCart(page);
      await page.goto("/ja/cart");
      await expect(page.locator("[data-slot='cart-line']").first()).toBeVisible();
    },
    act: async (page) => {
      await page.getByRole("button", { name: /\+1$/ }).first().click();
    },
  },

  "components/cart/cart-content.tsx#handler:onRemove#1": {
    requiresCart: true,
    blocks: "**/cart**",
    arrive: async (page) => {
      await openPurchasableProduct(page);
      await addToCart(page);
      await page.goto("/ja/cart");
      await expect(page.locator("[data-slot='cart-line']").first()).toBeVisible();
    },
    act: async (page) => {
      await page.getByRole("button", { name: "削除" }).first().click();
    },
  },
};

/* -------------------------------------------------------------------------- */

/**
 * 楽観更新の性質検査 — **サーバを黙らせたまま画面が完成するか**。
 *
 * `page.route()` で書き込みの往復を保留 (応答を返さない) にしたうえで操作し、
 * `observe` の全要素が変化することを確かめる。1 つでも古いままなら不合格 —
 * それが「数量だけ即時で金額はサーバ待ち」(網羅表 G2) の姿である。
 */
async function assertOptimistic(
  page: Page,
  row: Interaction,
  scenario: (typeof SCENARIOS)[string],
) {
  await scenario.arrive(page);

  const observe = row.observe ?? [];
  expect(observe.length, `${row.id} は observe が空`).toBeGreaterThan(0);

  const before = await Promise.all(
    observe.map((selector) => page.locator(selector).first().textContent().catch(() => null)),
  );

  /* 往復を**永久に保留**する。中断 (abort) ではなく保留にするのは、
     「失敗したから巻き戻した」ではなく「返事が来ないあいだ」を見たいから。 */
  await page.route(scenario.blocks ?? "**/*", async (route, request) => {
    if (request.method() === "GET") return route.continue();
    /* 応答を返さない = サーバは沈黙したまま。 */
    await new Promise(() => {});
  });

  await scenario.act(page);

  for (const [i, selector] of observe.entries()) {
    await expect(
      page.locator(selector).first(),
      `${row.id}: ${selector} がサーバの往復を待っている ` +
        "(楽観更新が画面の描く項目を覆っていない = 網羅表 G2 と同じ形)",
    ).not.toHaveText(before[i] ?? "", { timeout: 10_000 });
  }
}

/**
 * 事前取得の性質検査 — **押す前にもう取ってあるか**。
 *
 * 押したあとの速さは測らない (dev サーバー相手では意味を持たない)。
 * 「切替先の URL が、押す前の `performance.getEntriesByType("resource")` に
 * 既に載っているか」だけを見る。載っていれば押した瞬間に出る。
 */
async function assertAssetPrefetched(page: Page, row: Interaction, scenario: (typeof SCENARIOS)[string]) {
  await scenario.arrive(page);

  /* 先読みは 1 枚目が落ち着いてから (requestIdleCallback) 動く。
     取り終わるのを待つのであって、速さは測らない。 */
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            performance
              .getEntriesByType("resource")
              .filter((e) => e.name.includes("/_next/image")).length,
        ),
      {
        message:
          `${row.id}: 押される前に切替先の画像を取っていない。` +
          "サムネイルを押してから取りにいくと、未取得の 1 枚を取り終わるまで " +
          "見た目は旧画像のまま (網羅表 G1 / 本番実測 705〜1,865ms)。",
        timeout: 15_000,
      },
    )
    .toBeGreaterThan(1);

  const beforeClick = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((e) => e.name.includes("/_next/image"))
      .map((e) => e.name),
  );

  await scenario.act(page);

  /* **`src` ではなく `currentSrc` を見る。**
     `next/image` は `src` に候補の最大 (w=3840) を置き、実際に取る 1 本は
     `srcset` + `sizes` からブラウザが選ぶ。`src` を比べると「先読みした w=640」と
     「属性上の w=3840」が食い違い、**先読みが効いていても落ちる**。
     `currentSrc` はブラウザが実際に取った URL なので、先読み一覧と同じ土俵になる。 */
  const shown = await page
    .locator("button.cursor-zoom-in img")
    .first()
    .evaluate((el) => (el as HTMLImageElement).currentSrc);

  expect(shown, `${row.id}: メイン画像が読み込まれていない`).toBeTruthy();

  /* `toContain` で比べるのは、外れたときに**取ってあった一覧そのもの**が
     出力に出るから。真偽値の assert だと「false でした」しか残らず、
     先読みが何を取っていたのかを毎回手で調べ直すことになる。 */
  expect(
    beforeClick.map((url) => decodeURIComponent(url)),
    `${row.id}: 押したあとに表示された画像が、押す前の取得一覧に無い。` +
      "先読みが効いていない (網羅表 G1 の再発)。",
  ).toContain(decodeURIComponent(shown ?? ""));
}

/* -------------------------------------------------------------------------- */

test.describe("憲章 R9 — 台帳が宣言した応答が、実際にその性質を持つ", () => {
  for (const row of DECLARED) {
    const scenario = SCENARIOS[row.id];

    /* 台帳に宣言があるのに手順が無い = 宣言だけして検査していない。
       `__tests__/interaction-inventory.test.ts` が先に落とすが、
       ここでも落としておく (spec 単体で走らせたときに黙って通らないため)。 */
    if (!scenario) {
      test(`${row.id} — 手順が未登録`, () => {
        throw new Error(
          `台帳が ${row.id} に response="${row.response}" を宣言しているのに、` +
            "e2e/interaction-response.spec.ts の SCENARIOS に操作手順がありません。" +
            "宣言だけして検査しないと、台帳は「守っているつもり」の表になります。",
        );
      });
      continue;
    }

    test(`${row.id} (${row.response})`, async ({ page }) => {
      test.skip(
        Boolean(scenario.requiresCart) && !STOREFRONT_CONFIGURED,
        "Shopify Storefront の資格情報 (SHOPIFY_STORE_DOMAIN / " +
          "SHOPIFY_STOREFRONT_ACCESS_TOKEN) が未設定 — カートへの書き込みは実ストアに " +
          "しか無く、見本カタログでは楽観更新の対象そのものが作れない " +
          "(既存の Checkout happy path と同じ理由)",
      );

      switch (row.response) {
        case "optimistic":
        case "sync-dom":
          await assertOptimistic(page, row, scenario);
          break;
        case "asset-load":
          await assertAssetPrefetched(page, row, scenario);
          break;
        default:
          throw new Error(
            `${row.id}: response="${row.response}" の検査方法がこの spec にありません。` +
              "台帳に新しい応答の種類を足したら、ここに判定も足してください。",
          );
      }
    });
  }
});
