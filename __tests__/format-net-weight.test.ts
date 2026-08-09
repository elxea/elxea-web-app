import { describe, expect, it } from "vitest";

import { formatNetWeight } from "@/lib/format-net-weight";

/**
 * C9-1R の QA 指摘「実データで内容量が `50gg` になる」の回帰テスト。
 *
 * Sanity の `netWeight` は schema 上は number だが実データに文字列 `"50g"` が
 * 入っており、表示側が素で `g` を足すと二重単位になる。文字列 / 数値 / 空の
 * 3 系統をここで固定する。
 */
describe("formatNetWeight", () => {
  describe("文字列 (実データの形。単位が入っている)", () => {
    it("すでに g が付いていれば足さない (二重単位を作らない)", () => {
      expect(formatNetWeight("50g")).toBe("50g");
    });

    it("数値だけの文字列には g を足す", () => {
      expect(formatNetWeight("50")).toBe("50g");
    });

    it("小数の文字列にも g を足す", () => {
      expect(formatNetWeight("2.5")).toBe("2.5g");
    });

    it("前後の空白は落とす", () => {
      expect(formatNetWeight("  50  ")).toBe("50g");
      expect(formatNetWeight("  50g  ")).toBe("50g");
    });

    it("全角数字は半角に寄せて g を足す", () => {
      expect(formatNetWeight("５０")).toBe("50g");
    });

    it("単位つきの複合表記はそのまま返す", () => {
      expect(formatNetWeight("2g × 10袋")).toBe("2g × 10袋");
      expect(formatNetWeight("約50グラム")).toBe("約50グラム");
      expect(formatNetWeight("1kg")).toBe("1kg");
    });

    it("先頭ゼロや余分な桁は数値として正規化する", () => {
      expect(formatNetWeight("050")).toBe("50g");
    });
  });

  describe("数値 (schema どおりの形)", () => {
    it("g を 1 回だけ足す", () => {
      expect(formatNetWeight(50)).toBe("50g");
    });

    it("小数も扱える", () => {
      expect(formatNetWeight(2.5)).toBe("2.5g");
    });

    it("0 は値として扱う (行を落とさない)", () => {
      expect(formatNetWeight(0)).toBe("0g");
    });

    it("非有限値は値なし扱い", () => {
      expect(formatNetWeight(Number.NaN)).toBeUndefined();
      expect(formatNetWeight(Number.POSITIVE_INFINITY)).toBeUndefined();
    });
  });

  describe("空 (行を出さない)", () => {
    it("undefined / null は undefined", () => {
      expect(formatNetWeight(undefined)).toBeUndefined();
      expect(formatNetWeight(null)).toBeUndefined();
    });

    it("空文字・空白のみは undefined", () => {
      expect(formatNetWeight("")).toBeUndefined();
      expect(formatNetWeight("   ")).toBeUndefined();
    });
  });
});
