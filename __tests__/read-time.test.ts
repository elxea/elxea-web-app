import { describe, expect, it } from "vitest";

import { countReadingUnits, readingMinutes } from "@/lib/journal/read-time";

/**
 * 読了目安は「日本語は字 / 英語は語」で別々に数えてから足す。片方の基準だけで
 * 割ると英語記事の分数が実際の数倍に膨らむため、その回帰をここで止める。
 */
describe("countReadingUnits", () => {
  it("日本語は字として、英語は語として数える", () => {
    // 「お茶の時間」= 5 字 (漢字 + かな)、英語 0 語
    expect(countReadingUnits("お茶の時間")).toEqual({ jaChars: 5, enWords: 0 });

    expect(countReadingUnits("Sound from Nature")).toEqual({
      jaChars: 0,
      enWords: 3,
    });
  });

  it("日本語の間に挟まった英単語も語として拾う", () => {
    // 「音源を」3 字 +「で鳴らす」4 字 = 7 字 / 英語 1 語
    expect(countReadingUnits("音源を SoundCloud で鳴らす")).toEqual({
      jaChars: 7,
      enWords: 1,
    });
  });

  it("記号だけの断片は語として数えない", () => {
    expect(countReadingUnits("--- · ---")).toEqual({ jaChars: 0, enWords: 0 });
  });
});

describe("readingMinutes", () => {
  it("日本語 550 字で 1 分、端数は切り上げる", () => {
    expect(readingMinutes("あ".repeat(550))).toBe(1);
    expect(readingMinutes("あ".repeat(551))).toBe(2);
    expect(readingMinutes("あ".repeat(1100))).toBe(2);
  });

  it("英語 220 語で 1 分", () => {
    const words = Array.from({ length: 220 }, () => "tea").join(" ");
    expect(readingMinutes(words)).toBe(1);
    expect(readingMinutes(`${words} tea`)).toBe(2);
  });

  it("日本語と英語が混ざった本文は足し合わせる", () => {
    // 550 字 (1 分) + 220 語 (1 分) = 2 分
    const mixed = `${"あ".repeat(550)} ${Array.from({ length: 220 }, () => "tea").join(" ")}`;
    expect(readingMinutes(mixed)).toBe(2);
  });

  it("短い本文でも最低 1 分を返す", () => {
    expect(readingMinutes("お茶")).toBe(1);
  });

  it("本文が空なら null (表示ごと出さない)", () => {
    expect(readingMinutes("")).toBeNull();
    expect(readingMinutes("   ")).toBeNull();
    expect(readingMinutes(null)).toBeNull();
    expect(readingMinutes(undefined)).toBeNull();
  });

  it("PortableText の配列を受け取れる", () => {
    const body = [
      {
        _type: "block",
        _key: "a",
        children: [{ _type: "span", _key: "a1", text: "あ".repeat(300) }],
      },
      {
        _type: "block",
        _key: "b",
        children: [{ _type: "span", _key: "b1", text: "あ".repeat(300) }],
      },
      // 画像などテキストを持たないブロックは数に入らない。
      { _type: "image", _key: "c", asset: { _ref: "image-1" } },
    ] as unknown as Parameters<typeof readingMinutes>[0];

    // 600 字 → 550 字/分 で 1.09 分 → 切り上げ 2 分
    expect(readingMinutes(body)).toBe(2);
  });
});
