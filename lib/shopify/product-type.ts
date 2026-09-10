/**
 * 商品分類 (Shopify `productType`) の表示ラベル。
 *
 * ## 何を解いているか
 *
 * Shopify の `productType` は 1 つの文字列しか持てないので、elxea は英日を
 * 1 本に畳んだ値 (`Green Tea｜緑茶`) を入れている。これをそのまま画面に出すと
 * 日本語 UI に英語が混ざった「Green Tea｜緑茶」というラベルになる。
 *
 * ここは **値 (絞り込みのキー) と表示 (ラベル) を分ける** ためだけの関数で、
 * 分類の名前そのものは持たない (固定文言をコードに焼かない方針のまま)。
 * 区切り記号で割って、ロケールに対応する側だけを返す。
 *
 * 対応する区切りは全角縦棒 `｜` と半角 `|` の両方 (Shopify 管理画面で
 * どちらが入力されたかに依存させない)。区切りが無い値はそのまま返す。
 *
 * 並び順の約束: **左が英語 / 右が日本語**。elxea の既存データがその順で入って
 * いる (`Green Tea｜緑茶` / `Black Tea｜紅茶` / `Oolong Tea｜烏龍茶`)。
 */

const SEPARATOR = /\s*[｜|]\s*/;

/** 表示用ラベル。`ja` は右側、それ以外は左側を返す。 */
export function productTypeLabel(productType: string, locale: string): string {
  const parts = productType.split(SEPARATOR).filter((p) => p !== "");
  if (parts.length < 2) return productType.trim();
  return locale === "ja" ? parts[parts.length - 1] : parts[0];
}

/**
 * 絞り込みキーの一致判定。
 *
 * `?category=` には 2 系統の値が届く:
 *  - 商品一覧のチップが作る **生の productType** (`Green Tea｜緑茶`)
 *  - トップの CATEGORIES タイルが作る **コレクション名** (`緑茶`)
 *
 * どちらでも同じ絞り込みに着地させたいので、生値の一致に加えて
 * 「割った各部分との一致」も見る (大文字小文字は無視)。
 */
export function productTypeMatches(productType: string, category: string): boolean {
  const wanted = category.trim().toLowerCase();
  if (wanted === "") return false;
  if (productType.trim().toLowerCase() === wanted) return true;
  return productType
    .split(SEPARATOR)
    .some((part) => part.trim().toLowerCase() === wanted);
}
