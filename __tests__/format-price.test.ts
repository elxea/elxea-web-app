/**
 * format-price.test.ts
 *
 * 円記号の字形ガード。Figma は半角 `¥` (U+00A5) を使うが、
 * `Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" })` は
 * 全角 `￥` (U+FFE5) を返す。`currencyDisplay: "narrowSymbol"` を足しても
 * ja-JP では変わらないため formatPrice が currency パートを正規化している。
 *
 * ICU のバージョン差でどちらが出ても表示が半角に揃うことを固定する。
 */

import { describe, expect, it } from "vitest";

import { formatPrice } from "@/lib/utils";
import { formatPrice as formatPriceFromModule } from "@/lib/format-price";

const FULLWIDTH_YEN = "￥";
const HALFWIDTH_YEN = "¥";

describe("formatPrice", () => {
  it("半角の円記号 (U+00A5) を使う", () => {
    expect(formatPrice("1480", "JPY")).toContain(HALFWIDTH_YEN);
  });

  it("全角の円記号 (U+FFE5) を含まない", () => {
    expect(formatPrice("1480", "JPY")).not.toContain(FULLWIDTH_YEN);
  });

  it("ja-JP の桁区切りを保つ", () => {
    expect(formatPrice("1480", "JPY")).toBe(`${HALFWIDTH_YEN}1,480`);
    expect(formatPrice("6000", "JPY")).toBe(`${HALFWIDTH_YEN}6,000`);
    expect(formatPrice("980", "JPY")).toBe(`${HALFWIDTH_YEN}980`);
  });

  it("JPY は小数を付けない", () => {
    expect(formatPrice("2400.00", "JPY")).toBe(`${HALFWIDTH_YEN}2,400`);
  });

  it("JPY 以外の通貨の整形を壊さない", () => {
    // 記号は ICU 依存なので字形は問わず、金額部分だけを検査する
    expect(formatPrice("12.34", "USD")).toContain("12.34");
    expect(formatPrice("12.34", "USD")).not.toContain(FULLWIDTH_YEN);
  });

  /**
   * メール文面 (`lib/email/subscription-reminder.ts` / `lib/email/dunning.ts`)
   * は以前このロジックを各ファイルに複製していて、`Intl` 既定の全角 `￥` が
   * 出ていた。共通実装に統合したので「別実装が再び生えない」ことを固定する
   * (`@/lib/utils` は `@/lib/format-price` の再輸出であり同一関数)。
   */
  it("lib/utils の再輸出と lib/format-price は同一実装", () => {
    expect(formatPrice).toBe(formatPriceFromModule);
  });
});
