import { describe, expect, it } from "vitest";

import { hexToOklch, mixHue, oklchToHex } from "@/lib/roji/color";
import {
  TIMES_OF_DAY,
  normalizeMonth,
  seasonalPalette,
  seasonalPaletteFor,
  seasonalRolesFor,
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
   * 彩度の天井。brand-gold (0.173) を超えなければ既存 UI と喧嘩しない。
   *
   * v0 は本文用トークンの帯域 (0.006〜0.061) に収めていたが、それは文字と罫線の
   * 帯域であって面の帯域ではなかった (実測: 面がオフホワイトと区別できなかった)。
   */
  it("stays under the brand chroma ceiling", () => {
    for (const month of MONTHS) {
      for (const timeOfDay of TIMES_OF_DAY) {
        for (const hex of seasonalPaletteFor(month, timeOfDay)) {
          expect(hexToOklch(hex).c).toBeLessThanOrEqual(0.13);
        }
      }
    }
  });

  /** 明度の床と天井。真っ黒に潰さず、昼でも白飛びさせない。 */
  it("keeps lightness between the ink floor and the paper ceiling", () => {
    for (const month of MONTHS) {
      for (const timeOfDay of TIMES_OF_DAY) {
        for (const hex of seasonalPaletteFor(month, timeOfDay)) {
          const { l } = hexToOklch(hex);
          expect(l).toBeGreaterThanOrEqual(0.16);
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
  /**
   * v1 の中心的な回帰検査。
   *
   * v0 の夜は「明度を落として彩度も落とす」だったので、12月夜がほぼ無彩色、
   * 8月夜が濁った青灰になった。実物を見て初めて分かる壊れ方だったので、
   * ここで数値として固定しておく。**暗い = 灰色ではない**。
   */
  it("never lets a night color fall to near-grey", () => {
    for (const month of MONTHS) {
      for (const hex of seasonalPaletteFor(month, "night")) {
        const { c } = hexToOklch(hex);
        expect(c).toBeGreaterThanOrEqual(0.04);
      }
    }
  });

  it("makes night more chromatic than day, not less", () => {
    const meanC = (palette: string[]) =>
      palette.reduce((sum, hex) => sum + hexToOklch(hex).c, 0) / palette.length;

    for (const month of MONTHS) {
      expect(meanC(seasonalPaletteFor(month, "night"))).toBeGreaterThan(
        meanC(seasonalPaletteFor(month, "day")),
      );
    }
  });

  /** 夜の色相が 1 点に潰れると、明度差だけの面 = モノクロになる。 */
  it("keeps the night hues spread apart", () => {
    const distance = (a: number, b: number) => {
      const delta = (((a - b) % 360) + 360) % 360;
      return delta > 180 ? 360 - delta : delta;
    };

    for (const month of MONTHS) {
      const hues = seasonalPaletteFor(month, "night").map(
        (hex) => hexToOklch(hex).h,
      );
      const widest = Math.max(
        ...hues.flatMap((a) => hues.map((b) => distance(a, b))),
      );
      expect(widest).toBeGreaterThanOrEqual(60);
    }
  });

  /**
   * 夜には必ず「灯り」が 1 色ある。暗がりの中で暖色が点って見えることが、
   * 夜を静けさとして成立させる条件 (沈んだだけの面は静かではなく、ただ暗い)。
   */
  it("gives every night a warm lit color that stays bright", () => {
    const distanceFromAmber = (h: number) => {
      const delta = (((h - 55) % 360) + 360) % 360;
      return delta > 180 ? 360 - delta : delta;
    };

    for (const month of MONTHS) {
      const colors = seasonalPaletteFor(month, "night").map((hex) =>
        hexToOklch(hex),
      );
      const lamp = colors.find(
        (color) => distanceFromAmber(color.h) <= 60 && color.l >= 0.55,
      );
      expect(lamp, `month ${month} has no lamp`).toBeDefined();

      // 地と灯りのあいだに、はっきりした明度差があること。
      const darkest = Math.min(...colors.map((color) => color.l));
      expect(lamp!.l - darkest).toBeGreaterThanOrEqual(0.28);
    }
  });

  /**
   * `components/roji/seasonal-wash.tsx` の `readRoles` は「地を除いていちばん
   * 彩度の高い色が主役」という前提で役割を逆算する。その前提をここで固定する
   * (崩れると面の主役と地が入れ替わり、絵が反転する)。
   */
  it("always makes the accent the most chromatic color", () => {
    for (const month of MONTHS) {
      for (const timeOfDay of TIMES_OF_DAY) {
        const palette = seasonalPaletteFor(month, timeOfDay);
        const roles = seasonalRolesFor(month, timeOfDay);
        const accentIndex = roles.indexOf("accent");
        const accentC = hexToOklch(palette[accentIndex]).c;
        palette.forEach((hex, i) => {
          if (i === accentIndex) return;
          expect(hexToOklch(hex).c).toBeLessThan(accentC);
        });
      }
    }
  });

  /** 同じ前提の残り半分: 地は明るい時間帯なら最も明るく、暗い時間帯なら最も暗い。 */
  it("puts the ground at the majority end of the lightness range", () => {
    for (const month of MONTHS) {
      for (const timeOfDay of TIMES_OF_DAY) {
        const palette = seasonalPaletteFor(month, timeOfDay);
        const roles = seasonalRolesFor(month, timeOfDay);
        const ls = palette.map((hex) => hexToOklch(hex).l);
        const groundL = ls[roles.indexOf("ground")];
        const dark = timeOfDay === "dusk" || timeOfDay === "night";
        expect(groundL).toBe(dark ? Math.min(...ls) : Math.max(...ls));
      }
    }
  });

  /**
   * 明るい配色が無地のオフホワイトと見分けが付かない、という v0 の指摘への回帰検査。
   * 地と主役の彩度差が開いていれば、面に色がある。
   */
  it("keeps light palettes distinguishable from plain off-white", () => {
    for (const month of MONTHS) {
      for (const timeOfDay of ["morning", "day"] as const) {
        const palette = seasonalPaletteFor(month, timeOfDay);
        const roles = seasonalRolesFor(month, timeOfDay);
        const groundC = hexToOklch(palette[roles.indexOf("ground")]).c;
        const accentC = hexToOklch(palette[roles.indexOf("accent")]).c;
        expect(accentC - groundC).toBeGreaterThanOrEqual(0.04);
      }
    }
  });

  it("gives each palette exactly one ground, one accent and two mids", () => {
    for (const month of MONTHS) {
      for (const timeOfDay of TIMES_OF_DAY) {
        const roles = seasonalRolesFor(month, timeOfDay);
        expect(roles.filter((r) => r === "ground")).toHaveLength(1);
        expect(roles.filter((r) => r === "accent")).toHaveLength(1);
        expect(roles.filter((r) => r === "mid")).toHaveLength(2);
      }
    }
  });

  it("pins the reference palettes", () => {
    expect(seasonalPaletteFor(8, "day")).toEqual([
      "#b5ebfe",
      "#93dab6",
      "#eeece4",
      "#bbc7e0",
    ]);
    // 8月夜 = 深い藍の地 (#1a2a46) に生成りが灯り (#ae9052) として点る。
    // v0 はここが #708591 / #969c96 という無彩色の泥だった。
    expect(seasonalPaletteFor(8, "night")).toEqual([
      "#316c85",
      "#035549",
      "#ae9052",
      "#1a2a46",
    ]);
    expect(seasonalPaletteFor(10, "day")).toEqual([
      "#ffc1a9",
      "#e7b06e",
      "#eceae2",
      "#a4b3c8",
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
