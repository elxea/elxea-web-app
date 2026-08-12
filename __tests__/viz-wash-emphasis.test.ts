import { describe, expect, it } from "vitest";

import { seasonalPaletteFor } from "@/lib/viz/seasonal-palette";
import {
  DARK_PALETTE_PIVOT,
  LIGHT_PALETTE_PIVOT,
  paletteMeanLightness,
  washEmphasisFor,
  washEmphasisForPalette,
  type WashEmphasis,
} from "@/lib/viz/wash-emphasis";

/**
 * 配色の明るさ -> にじみの置き方の係数。
 *
 * ここで守るのは「暗い配色ほど色が濃く狭くまとまって出る」という **向き** であって、
 * 個々の数値そのものではない。数値は実物を見ながら動かすので、値をそのまま
 * 期待値に焼くとテストが調整のたびに壊れる。単調性・両端・連続性を検査する。
 */

const KEYS: (keyof WashEmphasis)[] = [
  "weight",
  "width",
  "alpha",
  "elongation",
  "mottleDepth",
  "spread",
  "midAlpha",
];

describe("paletteMeanLightness", () => {
  it("黒は 0 に近く、白は 1 に近い", () => {
    expect(paletteMeanLightness(["#000000"])).toBeLessThan(0.05);
    expect(paletteMeanLightness(["#ffffff"])).toBeGreaterThan(0.95);
  });

  it("平均を取る (地が 1 色暗くても残りが明るければ明るい配色)", () => {
    const mean = paletteMeanLightness([
      "#000000",
      "#ffffff",
      "#ffffff",
      "#ffffff",
    ]);
    expect(mean).toBeGreaterThan(0.7);
  });

  it("解釈できない色や空配列でも例外を投げず中明度に倒す", () => {
    // 面は何を渡されても描けなければならない。ここで throw すると背景が消える。
    expect(paletteMeanLightness([])).toBe(0.5);
    expect(paletteMeanLightness(["not-a-color"])).toBeCloseTo(0.5, 5);
  });

  it("実際の季節パレットで夜と昼がはっきり分かれる", () => {
    const decNight = paletteMeanLightness(seasonalPaletteFor(12, "night"));
    const augNight = paletteMeanLightness(seasonalPaletteFor(8, "night"));
    const octDay = paletteMeanLightness(seasonalPaletteFor(10, "day"));
    const augMorning = paletteMeanLightness(seasonalPaletteFor(8, "morning"));

    // 夜は暗い側の境目より下、朝昼は明るい側の境目より上に居ること。
    // ここが崩れると配色依存の調整が効かなくなる (両端に張り付かない)。
    expect(decNight).toBeLessThan(DARK_PALETTE_PIVOT);
    expect(augNight).toBeLessThan(DARK_PALETTE_PIVOT);
    expect(octDay).toBeGreaterThan(LIGHT_PALETTE_PIVOT);
    expect(augMorning).toBeGreaterThan(LIGHT_PALETTE_PIVOT);
  });
});

describe("washEmphasisFor", () => {
  it("暗い配色は主役を濃く出す (光として読ませる)", () => {
    const dark = washEmphasisFor(0.3);
    const light = washEmphasisFor(0.9);
    // 差がはっきりある (1.5 倍以上) こと。上限は実測で決まる: 2 倍を超えると
    // 12月夜で銅色が連続した帯になった (`DARK_EMPHASIS` のコメント参照)。
    expect(dark.alpha).toBeGreaterThan(light.alpha * 1.5);
    expect(dark.alpha).toBeLessThan(light.alpha * 2.2);
  });

  it("暗い配色は主役を狭く・まとまらせる (光は輪郭ではなく中心で読まれる)", () => {
    const dark = washEmphasisFor(0.3);
    const light = washEmphasisFor(0.9);
    expect(dark.width).toBeLessThan(light.width);
    expect(dark.spread).toBeLessThan(light.spread);
    expect(dark.mottleDepth).toBeLessThan(light.mottleDepth);
  });

  it("暗い配色は中間色も押し上げる (12月夜の青緑が沈まないため)", () => {
    expect(washEmphasisFor(0.3).midAlpha).toBeGreaterThan(
      washEmphasisFor(0.9).midAlpha,
    );
  });

  it("明るい配色では v2 で合格した置き方に戻る", () => {
    // 10月昼は実物で合格しているので、明るい側の値は動かさない契約にする。
    const light = washEmphasisFor(0.9);
    expect(light.alpha).toBeCloseTo(1.05, 6);
    expect(light.width).toBeCloseTo(1.7, 6);
    expect(light.spread).toBeCloseTo(1.4, 6);
    expect(light.mottleDepth).toBeCloseTo(0.95, 6);
    expect(light.midAlpha).toBeCloseTo(1, 6);
  });

  it("境目の外では値が張り付く (それ以上振れない)", () => {
    for (const key of KEYS) {
      expect(washEmphasisFor(0)[key]).toBeCloseTo(
        washEmphasisFor(DARK_PALETTE_PIVOT)[key],
        6,
      );
      expect(washEmphasisFor(1)[key]).toBeCloseTo(
        washEmphasisFor(LIGHT_PALETTE_PIVOT)[key],
        6,
      );
    }
  });

  it("両端のあいだで単調に移る (隣の時間帯で絵が跳ばない)", () => {
    const steps = 40;
    for (let i = 1; i <= steps; i += 1) {
      const prev = washEmphasisFor((i - 1) / steps);
      const next = washEmphasisFor(i / steps);
      // 明るくなるほど: 濃さと中間色は下がり、幅・散らし・切れ目は上がる。
      expect(next.alpha).toBeLessThanOrEqual(prev.alpha + 1e-9);
      expect(next.midAlpha).toBeLessThanOrEqual(prev.midAlpha + 1e-9);
      expect(next.elongation).toBeLessThanOrEqual(prev.elongation + 1e-9);
      expect(next.width).toBeGreaterThanOrEqual(prev.width - 1e-9);
      expect(next.spread).toBeGreaterThanOrEqual(prev.spread - 1e-9);
      expect(next.mottleDepth).toBeGreaterThanOrEqual(prev.mottleDepth - 1e-9);
    }
  });

  it("係数が連続 (どこにも段差が無い)", () => {
    const steps = 200;
    for (let i = 1; i <= steps; i += 1) {
      const prev = washEmphasisFor((i - 1) / steps);
      const next = washEmphasisFor(i / steps);
      for (const key of KEYS) {
        expect(Math.abs(next[key] - prev[key])).toBeLessThan(0.1);
      }
    }
  });

  it("どの明度でも描画が破綻する値を返さない", () => {
    for (let i = 0; i <= 100; i += 1) {
      const e = washEmphasisFor(i / 100);
      expect(e.weight).toBeGreaterThan(0);
      expect(e.width).toBeGreaterThan(0);
      expect(e.alpha).toBeGreaterThan(0);
      expect(e.elongation).toBeGreaterThan(0);
      expect(e.spread).toBeGreaterThanOrEqual(0);
      // むらの深さが 1 を超えると濃度が全長でゼロに張り付き、主役が消える。
      expect(e.mottleDepth).toBeGreaterThanOrEqual(0);
      expect(e.mottleDepth).toBeLessThan(1);
    }
  });
});

describe("washEmphasisForPalette", () => {
  it("12月夜は 8月朝より主役を濃く置く", () => {
    const night = washEmphasisForPalette(seasonalPaletteFor(12, "night"));
    const morning = washEmphasisForPalette(seasonalPaletteFor(8, "morning"));
    expect(night.alpha).toBeGreaterThan(morning.alpha);
    expect(night.midAlpha).toBeGreaterThan(morning.midAlpha);
  });

  it("9月夕は昼と夜のあいだに入る (どちらにも倒れない)", () => {
    const dusk = washEmphasisForPalette(seasonalPaletteFor(9, "dusk"));
    const night = washEmphasisForPalette(seasonalPaletteFor(12, "night"));
    const day = washEmphasisForPalette(seasonalPaletteFor(10, "day"));
    expect(dusk.alpha).toBeGreaterThanOrEqual(day.alpha);
    expect(dusk.alpha).toBeLessThanOrEqual(night.alpha);
  });

  it("48 通りすべてで係数が有限", () => {
    const times = ["morning", "day", "dusk", "night"] as const;
    for (let month = 1; month <= 12; month += 1) {
      for (const time of times) {
        const e = washEmphasisForPalette(seasonalPaletteFor(month, time));
        for (const key of KEYS) {
          expect(Number.isFinite(e[key])).toBe(true);
        }
      }
    }
  });
});
