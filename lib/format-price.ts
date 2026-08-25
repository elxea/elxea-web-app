/**
 * 金額表記の共通実装 (サイト全域 + メール文面)。
 *
 * 円記号は Figma に合わせて半角 `¥` (U+00A5) にする。
 * `Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" })` は
 * 全角の `￥` (U+FFE5) を返す。`currencyDisplay: "narrowSymbol"` を足しても
 * ja-JP では全角のまま変わらない (Node ICU 77.1 で実測確認済) ので、
 * currency パートだけを半角に正規化する。桁区切り・小数の扱いは ja-JP の
 * ままなので、JPY 以外の通貨や将来のロケール追加に影響しない。
 *
 * `lib/utils.ts` からも再輸出する (既存の import パスを壊さないため)。
 * メール文面 (`lib/email/*`) はこのモジュールを直接読む — `lib/utils` には
 * `cn` (clsx / tailwind-merge) が同居していて、メール送信経路に UI 用の
 * 依存を持ち込みたくないため。
 */

/** 全角円記号 (U+FFE5) → 半角円記号 (U+00A5)。Figma は半角 `¥` を使う。 */
const FULLWIDTH_YEN = "￥";
const HALFWIDTH_YEN = "¥";

export function formatPrice(amount: string, currencyCode: string) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: currencyCode,
    currencyDisplay: "narrowSymbol",
  })
    .formatToParts(parseFloat(amount))
    .map((part) =>
      part.type === "currency"
        ? part.value.replaceAll(FULLWIDTH_YEN, HALFWIDTH_YEN)
        : part.value,
    )
    .join("");
}

/** 下限価格に添える「以上」の記号。全角波ダッシュ (U+301C)。 */
const RANGE_SUFFIX = "〜";

/**
 * バリアントで値段が変わる商品の一覧表記。
 *
 * ## なぜ最安値を裸で出さないのか
 *
 * 一覧のカードは `priceRange.minVariantPrice` を裸で出していた。一方、商品詳細は
 * **既定バリアント**の値段を出す。既定バリアントは最安とは限らないので、同じ商品が
 * 一覧 ¥1,598 → 詳細 ¥2,462 に「値上がりして見える」(実測: tea-ats-o-05 は
 * XS 3袋 ¥1,598 / S 6袋 ¥2,462、詳細の初期選択は S 6袋)。金額は信頼に直結するので、
 * 幅があるときは幅があると分かる形にする。
 *
 * 下限だけを出して「〜」を添える形にしているのは、カード 1 行に収まる長さで
 * 「これは最低額であって確定額ではない」と伝えられるため。両端表記
 * (`¥1,598〜¥2,462`) はカードの 1 行に収まらない幅になる。
 */
export function formatPriceRange(
  min: { amount: string; currencyCode: string },
  max?: { amount: string; currencyCode: string } | null,
): string {
  const low = formatPrice(min.amount, min.currencyCode);
  if (!max) return low;
  // 金額は文字列で来る ("1598.0" / "1598")。桁揃えの差を拾わないよう数値で比べる。
  if (parseFloat(max.amount) <= parseFloat(min.amount)) return low;
  return `${low}${RANGE_SUFFIX}`;
}
