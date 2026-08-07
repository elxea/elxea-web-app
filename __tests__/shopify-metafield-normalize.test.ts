import { describe, expect, it } from "vitest";
import { normalizeMetafieldValue } from "@/lib/shopify";

/**
 * Shopify の list.* 型 metafield (摘採 = `custom.season` 等) は Storefront API 上
 * JSON 配列の**文字列**で返る。素通しすると角括弧と引用符が画面に出るため、
 * 配列として解釈できたときだけ読点連結する。単一値の型を壊さないことが要件。
 */
describe("normalizeMetafieldValue", () => {
  it("list 型の JSON 配列文字列を読点で連結する", () => {
    expect(normalizeMetafieldValue('["春摘み","夏摘み"]')).toBe("春摘み、夏摘み");
  });

  it("要素 1 件の配列は読点を付けない", () => {
    expect(normalizeMetafieldValue('["一番茶"]')).toBe("一番茶");
  });

  it("配列内の空要素と前後空白を落とす", () => {
    expect(normalizeMetafieldValue('[" 春摘み ","","  "]')).toBe("春摘み");
  });

  it("全要素が空の配列は null (= 値なし) を返す", () => {
    expect(normalizeMetafieldValue("[]")).toBeNull();
    expect(normalizeMetafieldValue('["",""]')).toBeNull();
  });

  it("単一値のテキストはそのまま返す", () => {
    expect(normalizeMetafieldValue("緑茶")).toBe("緑茶");
    expect(normalizeMetafieldValue("  やぶきた  ")).toBe("やぶきた");
  });

  it("角括弧で始まるが壊れた JSON は原文を返す", () => {
    expect(normalizeMetafieldValue('["春摘み"')).toBe('["春摘み"');
  });

  it("配列以外の JSON は原文を返す", () => {
    // `[` 始まりでないため parse せず素通し
    expect(normalizeMetafieldValue('{"a":1}')).toBe('{"a":1}');
  });

  it("未定義・空文字は null", () => {
    expect(normalizeMetafieldValue(undefined)).toBeNull();
    expect(normalizeMetafieldValue("")).toBeNull();
    expect(normalizeMetafieldValue("   ")).toBeNull();
  });
});
