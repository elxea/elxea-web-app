import { describe, expect, it } from "vitest";

import { formatPriceRange } from "@/lib/format-price";
import { productTypeLabel, productTypeMatches } from "@/lib/shopify/product-type";
import {
  isPlaceholderCopy,
  stripPlaceholderCopy,
} from "@/lib/shopify/placeholder-copy";

/**
 * 「事実と食い違う表示」を止める 3 つの判定の単体テスト
 * (体感品質監査 2026-08-25 の #7 / #8 / #11)。
 *
 * どれも画面の見た目ではなく **何を出さないか** の約束なので、値で固定しておく。
 */

describe("値段の幅を隠さない (#7)", () => {
  const jpy = (amount: string) => ({ amount, currencyCode: "JPY" });

  it("バリアントで値段が変わる商品は下限に「〜」を付ける", () => {
    expect(formatPriceRange(jpy("1598"), jpy("2462"))).toBe("¥1,598〜");
  });

  it("値段が 1 つだけの商品はそのまま出す", () => {
    expect(formatPriceRange(jpy("1880"), jpy("1880"))).toBe("¥1,880");
    expect(formatPriceRange(jpy("1880"))).toBe("¥1,880");
  });

  it("上限が下限より低い壊れたデータでも「〜」は付けない", () => {
    expect(formatPriceRange(jpy("2462"), jpy("1598"))).toBe("¥2,462");
  });

  it("桁揃えの違い (1598 と 1598.0) を幅と誤認しない", () => {
    expect(formatPriceRange(jpy("1598"), jpy("1598.0"))).toBe("¥1,598");
  });
});

describe("分類は日本語 UI に日本語で出す (#8)", () => {
  it("英日を畳んだ値からロケール側だけを出す", () => {
    expect(productTypeLabel("Green Tea｜緑茶", "ja")).toBe("緑茶");
    expect(productTypeLabel("Green Tea｜緑茶", "en")).toBe("Green Tea");
  });

  it("半角の区切りでも同じ", () => {
    expect(productTypeLabel("Black Tea | 紅茶", "ja")).toBe("紅茶");
  });

  it("区切りが無い値はそのまま", () => {
    expect(productTypeLabel("Tea", "ja")).toBe("Tea");
    expect(productTypeLabel("緑茶", "ja")).toBe("緑茶");
  });

  it("絞り込みは生値でも日本語側でも当たる", () => {
    expect(productTypeMatches("Green Tea｜緑茶", "Green Tea｜緑茶")).toBe(true);
    expect(productTypeMatches("Green Tea｜緑茶", "緑茶")).toBe(true);
    expect(productTypeMatches("Green Tea｜緑茶", "green tea")).toBe(true);
    expect(productTypeMatches("Green Tea｜緑茶", "紅茶")).toBe(false);
    expect(productTypeMatches("Green Tea｜緑茶", "")).toBe(false);
  });
});

describe("入稿待ちの印を売り場に出さない (#11)", () => {
  it("本文が印だけなら説明無しとして扱う", () => {
    expect(isPlaceholderCopy("【準備中】")).toBe(true);
    expect(isPlaceholderCopy("<p>【準備中】</p>")).toBe(true);
    expect(isPlaceholderCopy("  準備中  ")).toBe(true);
    expect(isPlaceholderCopy("Coming soon")).toBe(true);
    expect(stripPlaceholderCopy("<p>【準備中】</p>")).toBe("");
  });

  it("印の語を含むだけの正当な本文は消さない", () => {
    const body = "次回分は準備中です。入荷までお待ちください。";
    expect(isPlaceholderCopy(body)).toBe(false);
    expect(stripPlaceholderCopy(body)).toBe(body);
  });

  it("空・未設定はそのまま (印ではない)", () => {
    expect(isPlaceholderCopy("")).toBe(false);
    expect(isPlaceholderCopy(null)).toBe(false);
    expect(stripPlaceholderCopy(null)).toBeNull();
  });
});
