import { normalizeTitle } from "@/lib/text/normalize-title";
import { productTypeMatches } from "./product-type";

/**
 * 商品一覧の `?category=` を、**実際に効く絞り込み**へ解決する。
 *
 * ## 何を直しているか (通しテスト E-3 / 2026-08-27)
 *
 * 商品一覧の絞り込み軸は Shopify の `productType` (緑茶 / 紅茶 / 烏龍茶) だが、
 * `?category=` を作っている場所は 3 つあり、**うち 2 つはコレクション名を渡す**:
 *
 *   - 商品一覧のチップ / 検索の手がかり … 生の productType (`Green Tea｜緑茶`)
 *   - トップの CATEGORIES タイル / コレクション一覧 … コレクション名
 *     (`お茶のアソートセット` / `お茶の定期便`)
 *
 * コレクション名が productType と一致しないとき (アソートセットは緑茶・紅茶・
 * 烏龍茶にまたがるので、どの productType とも一致しない)、旧実装は「未知の
 * category は『すべて』に落とす」という扱いにしていた。結果、**タイルを押しても
 * 12 件が全部出るだけで、絞り込まれていることが分からない**状態だった
 * (本番実測 2026-08-27)。
 *
 * ここでは「押したら必ず絞り込まれる」を成立させるため、productType で拾えない
 * ときは**コレクションの所属**で絞る。所属の実体 (handle) はこの関数の返り値が
 * 指し、実際の商品 handle 取得は呼び出し側 (`getCollectionProductHandles`)。
 *
 * ## なぜ空のコレクションを弾くのか
 *
 * 中身が 0 件のコレクション (本番では 18 件中 12 件) に着地させると、絞り込みは
 * 効いているのに画面は 0 件 — 押した人から見れば「壊れている」と区別が付かない。
 * 空のコレクションは絞り込みとして採用せず「すべて」に落とす。**そもそも空の
 * コレクションへリンクを張らない**のが本筋なので、タイル側 (`hasProducts`) と
 * ここの二段で塞ぐ。
 */

export type CategoryFilter =
  /** 絞り込み無し。`?category=` が空、または実在しない値だった。 */
  | { kind: "all" }
  /** productType 一致。値は生の productType (URL とチップの value)。 */
  | { kind: "productType"; value: string }
  /** コレクション所属。`title` は表示用、`handle` は所属を引くためのキー。 */
  | { kind: "collection"; handle: string; title: string };

/** 解決に要るコレクションの最小情報。 */
export type CategoryCollection = {
  handle: string;
  title: string;
  hasProducts: boolean;
};

export function resolveCategoryFilter(
  requested: string | undefined | null,
  productTypes: readonly string[],
  collections: readonly CategoryCollection[] = [],
): CategoryFilter {
  const wanted = (requested ?? "").trim();
  if (wanted === "") return { kind: "all" };

  /* productType が先。コレクション名と productType が同名のとき
     (`緑茶` はどちらにも在る) は、一覧のチップと同じ結果に着地させたい。 */
  const productType = productTypes.find((type) => productTypeMatches(type, wanted));
  if (productType) return { kind: "productType", value: productType };

  const key = normalizeTitle(wanted);
  const collection = collections.find(
    (c) =>
      c.hasProducts &&
      (normalizeTitle(c.title) === key || normalizeTitle(c.handle) === key),
  );
  if (collection) {
    return { kind: "collection", handle: collection.handle, title: collection.title };
  }

  return { kind: "all" };
}

/** チップの選択状態 / URL に載せる値。`all` は「すべて」チップの value。 */
export function categoryFilterValue(filter: CategoryFilter): string {
  switch (filter.kind) {
    case "productType":
      return filter.value;
    case "collection":
      return filter.title;
    default:
      return "all";
  }
}
