/**
 * 「サイトの主要な行き先と同じ名前」を持つ実データを、別の入口として出さない。
 *
 * ## 何を直しているか (体感品質監査 #18 / 2026-08-25)
 *
 * トップの CATEGORIES タイルは Shopify のコレクションから実データで組んでいる。
 * ところが本番のコレクションには **「イベント」** という名前のものがあり、
 * タイルは名前どおり「イベント」と表示されるのに、着地先は
 * `/products?category=イベント` — つまり**商品一覧**だった (2026-08-26 実測)。
 *
 * 監査が数えた「トップのイベント導線 4 本」の 4 本目がこれで、しかも他の 3 本
 * (ヘッダー / 導線ブロック / フッター) とは**行き先が違う**。入口が多いことより
 * 先に、同じ名前で違う場所へ連れて行くことが問題である。
 *
 * ## なぜ名前で弾くのか
 *
 * コレクションの名前は Shopify 側でいつでも増減する。コードに「イベントという
 * コレクションは出さない」と書くと、次に「お知らせ」や「ジャーナル」という名前が
 * 増えた日に同じ事故が起きる。よって除外する名前は**サイトの主要な行き先の名前
 * そのもの** (`messages` の `common.*`) を渡す — 名前の一覧を二重管理しない。
 */

import { normalizeTitle } from "@/lib/text/normalize-title";

/**
 * `reserved` と同じ名前を持つ項目を落とす。
 *
 * @param items 実データ (コレクション等)。`title` を持つものなら何でもよい。
 * @param reserved 主要な行き先の名前。
 */
export function excludeReservedTitles<T extends { title: string }>(
  items: readonly T[],
  reserved: Iterable<string>,
): T[] {
  const taken = new Set<string>();
  for (const name of reserved) {
    const key = normalizeTitle(name);
    if (key !== "") taken.add(key);
  }
  return items.filter((item) => !taken.has(normalizeTitle(item.title)));
}
