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
