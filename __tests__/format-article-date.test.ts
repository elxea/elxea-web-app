import { describe, expect, it } from "vitest";

import { formatArticleDate } from "@/lib/format-date";

/**
 * 記事日付は Figma 確定版の「2026.08.05」表記 (ドット区切り・ゼロ埋め) に固定する。
 * ロケール書式 (`toLocaleDateString`) に戻ると ja `2026/1/31` / en `1/31/2026` に
 * 割れるため、その回帰をここで止める。
 */
describe("formatArticleDate", () => {
  it("YYYY.MM.DD (ゼロ埋め) を返す", () => {
    expect(formatArticleDate("2026-08-05T00:00:00.000Z")).toBe("2026.08.05");
    expect(formatArticleDate("2026-01-31T00:00:00.000Z")).toBe("2026.01.31");
  });

  it("date のみの ISO 文字列も同じ表記になる", () => {
    expect(formatArticleDate("2026-01-31")).toBe("2026.01.31");
  });

  it("Date インスタンスを受け取れる", () => {
    expect(formatArticleDate(new Date("2026-12-09T03:00:00.000Z"))).toBe("2026.12.09");
  });

  it("JST 基準で日付を決める (UTC 夜 = JST 翌日はくり上げる)", () => {
    // 2026-08-05T16:00Z = 2026-08-06 01:00 JST
    expect(formatArticleDate("2026-08-05T16:00:00.000Z")).toBe("2026.08.06");
  });

  it("空・未定義・不正値は空文字を返す (呼び側で落とせる)", () => {
    expect(formatArticleDate(undefined)).toBe("");
    expect(formatArticleDate(null)).toBe("");
    expect(formatArticleDate("")).toBe("");
    expect(formatArticleDate("not-a-date")).toBe("");
  });

  it("スラッシュ区切り・非ゼロ埋めは返さない (ロケール書式への逆戻り防止)", () => {
    const out = formatArticleDate("2026-01-31T00:00:00.000Z");
    expect(out).not.toContain("/");
    expect(out).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
  });
});
