/**
 * 「押したら必ず絞り込まれる」を縛る (通しテスト E-3 / 2026-08-27)。
 *
 * トップの「お茶のアソートセット」「お茶の定期便」「お茶のコレクション」タイルは
 * `?category=<コレクション名>` へ飛ぶが、商品一覧の絞り込み軸は productType
 * だった。名前が一致しないので**未知の値として黙って「すべて」に落ち**、12 件が
 * 全部出ていた。押した人から見れば「リンクが効いていない」のと同じである。
 *
 * ここで縛るのは解決の判断だけ (`resolveCategoryFilter` は純関数)。実際の商品
 * 取得は `lib/shopify/index.ts`、画面の組み立ては商品一覧ページの担当。
 *
 * 母数は本番実測 (2026-08-27):
 *   productType  … Green Tea｜緑茶 / Black Tea｜紅茶 / Oolong Tea｜烏龍茶
 *   コレクション … アソートセット 15 件 / 定期便 3 件 / お茶のコレクション 0 件
 */
import { describe, it, expect } from "vitest";

import {
  categoryFilterValue,
  resolveCategoryFilter,
  type CategoryCollection,
} from "@/lib/shopify/category-filter";

const PRODUCT_TYPES = [
  "Green Tea｜緑茶",
  "Black Tea｜紅茶",
  "Oolong Tea｜烏龍茶",
] as const;

const COLLECTIONS: CategoryCollection[] = [
  { handle: "assorted-tea-set", title: "お茶のアソートセット", hasProducts: true },
  { handle: "subscription-plan", title: "お茶の定期便", hasProducts: true },
  { handle: "single-item", title: "お茶のコレクション", hasProducts: false },
  { handle: "green-tea", title: "緑茶", hasProducts: true },
];

describe("productType で拾えるものは今までどおり", () => {
  it("生の productType がそのまま来たら productType 絞り込み", () => {
    expect(resolveCategoryFilter("Green Tea｜緑茶", PRODUCT_TYPES, COLLECTIONS)).toEqual({
      kind: "productType",
      value: "Green Tea｜緑茶",
    });
  });

  it("日本語側だけ来ても同じ productType に着地する", () => {
    expect(resolveCategoryFilter("緑茶", PRODUCT_TYPES, COLLECTIONS)).toEqual({
      kind: "productType",
      value: "Green Tea｜緑茶",
    });
  });

  it("productType と同名のコレクションがあっても productType を優先する", () => {
    /* `緑茶` は productType にもコレクションにも在る。チップ経由と
       タイル経由で結果が変わると「同じ名前なのに件数が違う」になる。 */
    const filter = resolveCategoryFilter("緑茶", PRODUCT_TYPES, COLLECTIONS);
    expect(filter.kind).toBe("productType");
  });
});

describe("コレクション名で来たら所属で絞る", () => {
  it("アソートセットはコレクション絞り込みになる (「すべて」に落ちない)", () => {
    expect(
      resolveCategoryFilter("お茶のアソートセット", PRODUCT_TYPES, COLLECTIONS),
    ).toEqual({
      kind: "collection",
      handle: "assorted-tea-set",
      title: "お茶のアソートセット",
    });
  });

  it("定期便もコレクション絞り込みになる", () => {
    expect(resolveCategoryFilter("お茶の定期便", PRODUCT_TYPES, COLLECTIONS)).toEqual({
      kind: "collection",
      handle: "subscription-plan",
      title: "お茶の定期便",
    });
  });

  it("handle で来ても同じところに着地する", () => {
    expect(
      resolveCategoryFilter("assorted-tea-set", PRODUCT_TYPES, COLLECTIONS),
    ).toMatchObject({ kind: "collection", handle: "assorted-tea-set" });
  });

  it("全角/半角・前後空白・大小文字の違いで外れない", () => {
    expect(
      resolveCategoryFilter("  ＡＳＳＯＲＴＥＤ-ＴＥＡ-ＳＥＴ ", PRODUCT_TYPES, COLLECTIONS),
    ).toMatchObject({ kind: "collection", handle: "assorted-tea-set" });
  });
});

describe("行き止まりにしない", () => {
  it("中身が空のコレクションは絞り込みとして採らない", () => {
    /* 採ると「押したら 0 件」になり、壊れているのと区別が付かない。
       そもそもタイル側で空を出さないが、URL 直打ちでも同じ扱いにする。 */
    expect(
      resolveCategoryFilter("お茶のコレクション", PRODUCT_TYPES, COLLECTIONS),
    ).toEqual({ kind: "all" });
  });

  it("どこにも無い名前は「すべて」", () => {
    expect(resolveCategoryFilter("ほうじ茶", PRODUCT_TYPES, COLLECTIONS)).toEqual({
      kind: "all",
    });
  });

  it("未指定・空白だけは「すべて」", () => {
    expect(resolveCategoryFilter(undefined, PRODUCT_TYPES, COLLECTIONS)).toEqual({
      kind: "all",
    });
    expect(resolveCategoryFilter("   ", PRODUCT_TYPES, COLLECTIONS)).toEqual({
      kind: "all",
    });
  });

  it("コレクションを渡さなくても productType だけで動く (往復を増やさない経路)", () => {
    expect(resolveCategoryFilter("紅茶", PRODUCT_TYPES)).toMatchObject({
      kind: "productType",
    });
    expect(resolveCategoryFilter("お茶の定期便", PRODUCT_TYPES)).toEqual({ kind: "all" });
  });
});

describe("チップの選択状態に使う値", () => {
  it("productType は生値、コレクションは名前、無指定は all", () => {
    expect(
      categoryFilterValue({ kind: "productType", value: "Green Tea｜緑茶" }),
    ).toBe("Green Tea｜緑茶");
    expect(
      categoryFilterValue({
        kind: "collection",
        handle: "subscription-plan",
        title: "お茶の定期便",
      }),
    ).toBe("お茶の定期便");
    expect(categoryFilterValue({ kind: "all" })).toBe("all");
  });
});
