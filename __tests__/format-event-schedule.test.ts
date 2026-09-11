import { describe, expect, it } from "vitest";

import { formatEventSchedule, isSameEventDay } from "@/lib/format-date";
import { seedEvents } from "@/lib/preview-seed";

/**
 * イベントの開催日時は Figma【R2: 確定版】イベント詳細 6658:13327 / 6663:8175 の
 * 「2026年8月10日（日）14:00–17:00」形式。
 *
 * ここで止めたい回帰は 2 つ:
 * 1. **同日レンジ分岐が死んでいるのに気づかない** — 見本データが終了時刻を持たないと
 *    レンジ分岐を一度も踏まず「14:00」だけが描かれる。Figma と見比べただけでは
 *    「実装が壊れた」のか「データに終了時刻が無い」のか切り分けられない (C6-1R の指摘)。
 * 2. **TZ 未固定への逆戻り** — Vercel は UTC 実行なので JST 夜のイベントが 1 日前に見える。
 */
describe("formatEventSchedule", () => {
  it("同日 + 開始終了に時刻 → 時間レンジ (Figma の形)", () => {
    // 2026-08-10 14:00 JST (05:00 UTC) – 17:00 JST (08:00 UTC)
    expect(
      formatEventSchedule("2026-08-10T05:00:00.000Z", "2026-08-10T08:00:00.000Z", "ja"),
    ).toBe("2026年8月10日(月) 14:00–17:00");
  });

  it("終了時刻が無い → 開始のみ (レンジにしない)", () => {
    expect(formatEventSchedule("2026-08-10T05:00:00.000Z", undefined, "ja")).toBe(
      "2026年8月10日(月) 14:00",
    );
  });

  it("別日にまたがる → 日付つきで両端を出す", () => {
    expect(
      formatEventSchedule("2026-08-10T05:00:00.000Z", "2026-08-11T08:00:00.000Z", "ja"),
    ).toBe("2026年8月10日(月) 14:00 – 2026年8月11日(火) 17:00");
  });

  it("JST 00:00 は時刻未入力とみなして日付だけを出す", () => {
    // 2026-08-09T15:00Z = 2026-08-10 00:00 JST
    expect(formatEventSchedule("2026-08-09T15:00:00.000Z", undefined, "ja")).toBe(
      "2026年8月10日(月)",
    );
  });

  it("TZ は Asia/Tokyo 固定 (UTC 夜 = JST 翌日に繰り上げる)", () => {
    // 2026-08-09T16:00Z = 2026-08-10 01:00 JST
    expect(formatEventSchedule("2026-08-09T16:00:00.000Z", undefined, "ja")).toBe(
      "2026年8月10日(月) 01:00",
    );
  });

  it("読めない値は空文字 (呼び側が節ごと落とせる)", () => {
    expect(formatEventSchedule(null, null, "ja")).toBe("");
    expect(formatEventSchedule("not-a-date", null, "ja")).toBe("");
  });
});

describe("isSameEventDay", () => {
  it("同日は true / 別日は false", () => {
    expect(isSameEventDay("2026-08-10T05:00:00.000Z", "2026-08-10T08:00:00.000Z")).toBe(true);
    expect(isSameEventDay("2026-08-10T05:00:00.000Z", "2026-08-11T08:00:00.000Z")).toBe(false);
  });

  it("JST 基準で判定する (UTC では別日でも JST 同日なら true)", () => {
    // 2026-08-09T16:00Z = 08-10 01:00 JST / 2026-08-10T05:00Z = 08-10 14:00 JST
    expect(isSameEventDay("2026-08-09T16:00:00.000Z", "2026-08-10T05:00:00.000Z")).toBe(true);
  });

  it("終了が無い / 読めない値は false (併記しない側に倒す)", () => {
    expect(isSameEventDay("2026-08-10T05:00:00.000Z", undefined)).toBe(false);
    expect(isSameEventDay("2026-08-10T05:00:00.000Z", "not-a-date")).toBe(false);
  });
});

describe("見本データ (seed-event-1) が Figma の時間レンジを踏む", () => {
  it("終了時刻を持ち、描画結果が Figma の 14:00–17:00 になる", () => {
    const seed = seedEvents().find((e) => e.slug.current === "seed-event-1");
    expect(seed).toBeDefined();
    // 終了時刻が抜けるとレンジ分岐が死んで「14:00」だけになるため、データ側も固定する。
    expect(seed?.endDate).toBeTruthy();
    expect(formatEventSchedule(seed!.date, seed!.endDate, "ja")).toBe(
      "2026年8月10日(月) 14:00–17:00",
    );
    // 一覧カード (日付のみの面) では終了日を併記しない = 同じ日付を 2 回描かない。
    expect(isSameEventDay(seed!.date, seed!.endDate)).toBe(true);
  });
});
