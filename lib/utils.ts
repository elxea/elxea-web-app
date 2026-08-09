import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 全角円記号 (U+FFE5) → 半角円記号 (U+00A5)。Figma は半角 `¥` を使う。 */
const FULLWIDTH_YEN = "￥";
const HALFWIDTH_YEN = "¥";

/**
 * サイト全域の金額表記。円記号は Figma に合わせて半角 `¥` (U+00A5) にする。
 *
 * `Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" })` は
 * 全角の `￥` (U+FFE5) を返す。`currencyDisplay: "narrowSymbol"` を足しても
 * ja-JP では全角のまま変わらない (Node ICU 77.1 で実測確認済) ので、
 * currency パートだけを半角に正規化する。桁区切り・小数の扱いは ja-JP の
 * ままなので、JPY 以外の通貨や将来のロケール追加に影響しない。
 */
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
