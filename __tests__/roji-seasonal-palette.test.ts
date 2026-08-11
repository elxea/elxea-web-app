import { describe, expect, it } from "vitest";

import { hexToOklch, mixHue, oklchToHex } from "@/lib/roji/color";
import {
  TIMES_OF_DAY,
  normalizeMonth,
  seasonalPalette,
  seasonalPaletteFor,
  seasonalTempo,
  timeOfDayFromHour,
} from "@/lib/roji/seasonal-palette";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const HEX = /^#[0-9a-f]{6}$/;

describe("hexToOklch / oklchToHex", () => {
  it("round-trips a hex color", () => {
    for (const hex of ["#ffffff", "#000000", "#c6e4f0", "#7c5552", "#e9e6dc"]) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });

  it("keeps out-of-gamut colors inside sRGB by reducing chroma", () => {
    // C = 0.4 は sRGB の外。クリップではなく彩度縮約で戻すので、色相は保たれる。
    const hex = oklchToHex({ l: 0.6, c: 0.4, h: 150 });
    expect(hex).toMatch(HEX);
    const back = hexToOklch(hex);
    expect(back.c).toBeLessThan(0.4);
    expect(Math.abs(back.h - 150)).toBeLessThan(2);
  });
});

describe("mixHue", () => {
  it("takes the shorter arc across the 0/360 seam", () => {
    expect(mixHue(350, 10, 0.5)).toBeCloseTo(0, 5);
    expect(mixHue(10, 350, 0.5)).toBeCloseTo(0, 5);
  });

  it("returns the start at 0 and the target at 1", () => {
    expect(mixHue(200, 40, 0)).toBeCloseTo(200, 5);
    expect(mixHue(200, 40, 1)).toBeCloseTo(40, 5);
  });
});

describe("timeOfDayFromHour", () => {
  it.each([
    [5, "morning"],
    [9, "morning"],
    [10, "day"],
    [15, "day"],
    [16, "dusk"],
    [18, "dusk"],
    [19, "night"],
    [23, "night"],
    [0, "night"],
    [4, "night"],
  ])("hour %i -> %s", (hour, expected) => {
    expect(timeOfDayFromHour(hour)).toBe(expected);
  });

  it("wraps out-of-range hours instead of throwing", () => {
    expect(timeOfDayFromHour(24)).toBe("night");
    expect(timeOfDayFromHour(-1)).toBe("night");
  });
});

describe("normalizeMonth", () => {
  it.each([
    [1, 1],
    [12, 12],
    [13, 1],
    [0, 12],
    [-1, 11],
    [25, 1],
  ])("%i -> %i", (input, expected) => {
    expect(normalizeMonth(input)).toBe(expected);
  });
});

describe("seasonalPaletteFor", () => {
  it("returns 4 valid hex colors for every month x time of day", () => {
    for (const month of MONTHS) {
      for (const timeOfDay of TIMES_OF_DAY) {
        const palette = seasonalPaletteFor(month, timeOfDay);
        expect(palette).toHaveLength(4);
        for (const color of palette) expect(color).toMatch(HEX);
      }
    }
  });

  it("never repeats a color inside one palette", () => {
    // 同じ色が 2 つ入ると、にじみの塊が 1 つ分ただ消える。
    for (const month of MONTHS) {
      for (const timeOfDay of TIMES_OF_DAY) {
        const palette = seasonalPaletteFor(month, timeOfDay);
        expect(new Set(palette).size).toBe(4);
      }
    }
  });

  it("is deterministic (same input, same output)", () => {
    expect(seasonalPaletteFor(8, "night")).toEqual(seasonalPaletteFor(8, "night"));
  });

  it("wraps the month like normalizeMonth does", () => {
    expect(seasonalPaletteFor(13, "day")).toEqual(seasonalPaletteFor(1, "day"));
  });

  it("gives every month a distinct daytime palette", () => {
    const seen = new Set(MONTHS.map((m) => seasonalPaletteFor(m, "day").join()));
    expect(seen.size).toBe(12);
  });

  it("gives every time of day a distinct palette within a month", () => {
    for (const month of MONTHS) {
      const seen = new Set(
        TIMES_OF_DAY.map((t) => seasonalPaletteFor(month, t).join()),
      );
      expect(seen.size).toBe(TIMES_OF_DAY.length);
    }
  });

  /**
   * 既存デザイントークンとの同居条件。`dist/tokens.css` の彩度は
   * 0.006〜0.061 (brand-gold 0.173 のみ例外) なので、生成色がそれを大きく超えると
   * 既存 UI と喧嘩する。0.09 は gold を除いた実測上限に余裕を持たせた上限。
   */
  it("stays inside the chroma band the design tokens use", () => {
    for (const month of MONTHS) {
      for (const timeOfDay of TIMES_OF_DAY) {
        for (const hex of seasonalPaletteFor(month, timeOfDay)) {
          expect(hexToOklch(hex).c).toBeLessThanOrEqual(0.09);
        }
      }
    }
  });

  /** 明度の床と天井。夜でも黒く潰さず、昼でも白飛びさせない。 */
  it("keeps lightness between the quiet floor and the paper ceiling", () => {
    for (const month of MONTHS) {
      for (const timeOfDay of TIMES_OF_DAY) {
        for (const hex of seasonalPaletteFor(month, timeOfDay)) {
          const { l } = hexToOklch(hex);
          expect(l).toBeGreaterThanOrEqual(0.4);
          expect(l).toBeLessThanOrEqual(0.98);
        }
      }
    }
  });

  it("makes night darker than day, and morning lighter than dusk", () => {
    const meanL = (palette: string[]) =>
      palette.reduce((sum, hex) => sum + hexToOklch(hex).l, 0) / palette.length;

    for (const month of MONTHS) {
      const day = meanL(seasonalPaletteFor(month, "day"));
      const night = meanL(seasonalPaletteFor(month, "night"));
      const morning = meanL(seasonalPaletteFor(month, "morning"));
      const dusk = meanL(seasonalPaletteFor(month, "dusk"));

      expect(night).toBeLessThan(day - 0.1);
      expect(morning).toBeGreaterThan(dusk);
    }
  });

  /**
   * 夜は「一律に暗くする」ではなく「明暗差を開いて沈める」。差が開かないと
   * 4 色が中明度に固まり、面が一様な灰色の霞になる (実装時に実測した失敗)。
   */
  it("widens the lightness spread at night instead of flattening it", () => {
    for (const month of MONTHS) {
      const spread = (timeOfDay: "day" | "night") => {
        const ls = seasonalPaletteFor(month, timeOfDay).map(
          (hex) => hexToOklch(hex).l,
        );
        return Math.max(...ls) - Math.min(...ls);
      };
      expect(spread("night")).toBeGreaterThan(spread("day"));
    }
  });

  /**
   * 実値の固定。色を触ったらこのテストが落ちるので、変更が意図的かを必ず問われる。
   * 8月 = 晩夏 (淡い水色 / 薄緑 / 生成り / 白藤)、10月 = 秋 (薄柿 / 金茶 / 生成り / 薄墨)。
   */
  it("pins the reference palettes", () => {
    expect(seasonalPaletteFor(8, "day")).toEqual([
      "#c6e4f0",
      "#c4e2d2",
      "#edebe1",
      "#ccd3e2",
    ]);
    expect(seasonalPaletteFor(8, "night")).toEqual([
      "#708591",
      "#627e7c",
      "#969c96",
      "#666b76",
    ]);
    expect(seasonalPaletteFor(10, "day")).toEqual([
      "#e7b9a8",
      "#dcbb96",
      "#e9e6dc",
      "#abb1b8",
    ]);
  });
});

describe("seasonalPalette", () => {
  it("derives month and time of day from the given date", () => {
    // 2026-08-12 07:30 (端末ローカル) = 8月・朝
    const date = new Date(2026, 7, 12, 7, 30);
    expect(seasonalPalette(date)).toEqual(seasonalPaletteFor(8, "morning"));
  });

  it("changes across the day for the same date", () => {
    const morning = seasonalPalette(new Date(2026, 9, 5, 8, 0));
    const night = seasonalPalette(new Date(2026, 9, 5, 22, 0));
    expect(morning).not.toEqual(night);
  });
});

describe("seasonalTempo", () => {
  it("moves faster at the start of the month than at the end", () => {
    const first = seasonalTempo(new Date(2026, 7, 1));
    const last = seasonalTempo(new Date(2026, 7, 31));
    expect(first).toBeGreaterThan(last);
  });

  it("stays inside the range the component accepts", () => {
    for (let day = 1; day <= 28; day += 1) {
      const tempo = seasonalTempo(new Date(2026, 1, day));
      expect(tempo).toBeGreaterThanOrEqual(0.5);
      expect(tempo).toBeLessThanOrEqual(2);
    }
  });
});
