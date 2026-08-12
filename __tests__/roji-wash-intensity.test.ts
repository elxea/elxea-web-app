import { describe, expect, it } from "vitest";

import { seasonalPaletteFor } from "@/lib/roji/seasonal-palette";
import {
  resolveWashIntensity,
  scaleWashEmphasis,
  washEmphasisFor,
  washEmphasisForPalette,
  WASH_INTENSITY_PRESETS,
  type WashEmphasis,
} from "@/lib/roji/wash-emphasis";

/**
 * 面ごとの強さ (intensity)。
 *
 * ここで守るのは 2 つ。
 * 1. **弱くしても形は変わらない** — 濃度だけが動く。太さ・横ゆれ・切れ目まで
 *    縮めると、v2 -> v3 で潰した「帯に見える」後退がそのまま戻る
 * 2. **配色ごとの差が比のまま残る** — 暗い配色ほど濃い、という関係は倍率が
 *    一律に掛かる限り保たれる。ここが崩れると夜だけ灰色に戻る
 */

/** 濃度以外の項目。弱めても動いてはいけない。 */
const SHAPE_KEYS: (keyof WashEmphasis)[] = [
  "weight",
  "width",
  "elongation",
  "mottleDepth",
  "spread",
  "midSpread",
  "midMottleDepth",
];

describe("resolveWashIntensity", () => {
  it("既定 (base) は素通し", () => {
    const r = resolveWashIntensity();
    expect(r.scalar).toBe(1);
    expect(r.deposit).toBe(1);
    expect(r.opacity).toBe(1);
  });

  it("名前でも数値でも同じ結果になる", () => {
    expect(resolveWashIntensity("soft")).toEqual(
      resolveWashIntensity(WASH_INTENSITY_PRESETS.soft),
    );
  });

  it("soft は base より弱い (不透明度・濃度とも)", () => {
    const soft = resolveWashIntensity("soft");
    const base = resolveWashIntensity("base");
    expect(soft.opacity).toBeLessThan(base.opacity);
    expect(soft.deposit).toBeLessThan(base.deposit);
  });

  it("0-1 の外は丸める (呼び出し側の事故で描画が壊れない)", () => {
    expect(resolveWashIntensity(-3).scalar).toBe(0);
    expect(resolveWashIntensity(99).scalar).toBe(1);
    expect(resolveWashIntensity(99).opacity).toBe(1);
  });

  it("つまみを上げるほど濃度も不透明度も単調に上がる", () => {
    const steps = [0, 0.2, 0.4, 0.6, 0.8, 1].map((s) => resolveWashIntensity(s));
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i].deposit).toBeGreaterThan(steps[i - 1].deposit);
      expect(steps[i].opacity).toBeGreaterThan(steps[i - 1].opacity);
    }
  });

  it("いちばん弱くしても濃度は 0 にならない (地の 1 色だけの面にしない)", () => {
    expect(resolveWashIntensity(0).deposit).toBeGreaterThan(0.5);
    expect(resolveWashIntensity(0).opacity).toBe(0);
  });
});

describe("scaleWashEmphasis", () => {
  const emphasis = washEmphasisFor(0.9);

  it("倍率 1 は恒等", () => {
    expect(scaleWashEmphasis(emphasis, 1)).toEqual(emphasis);
  });

  it("濃度だけが動き、形は変わらない", () => {
    const scaled = scaleWashEmphasis(emphasis, 0.5);
    expect(scaled.alpha).toBeCloseTo(emphasis.alpha * 0.5, 10);
    expect(scaled.midAlpha).toBeCloseTo(emphasis.midAlpha * 0.5, 10);
    for (const key of SHAPE_KEYS) {
      expect(scaled[key]).toBe(emphasis[key]);
    }
  });

  it("負の倍率でも濃度は負にならない", () => {
    const scaled = scaleWashEmphasis(emphasis, -1);
    expect(scaled.alpha).toBe(0);
    expect(scaled.midAlpha).toBe(0);
  });

  it("暗い配色ほど濃い、という関係は弱めても比のまま残る", () => {
    const dark = washEmphasisFor(0.4);
    const light = washEmphasisFor(0.9);
    const deposit = resolveWashIntensity("soft").deposit;
    const softDark = scaleWashEmphasis(dark, deposit);
    const softLight = scaleWashEmphasis(light, deposit);

    expect(softDark.alpha).toBeGreaterThan(softLight.alpha);
    expect(softDark.alpha / softLight.alpha).toBeCloseTo(
      dark.alpha / light.alpha,
      10,
    );
    expect(softDark.midAlpha / softLight.midAlpha).toBeCloseTo(
      dark.midAlpha / light.midAlpha,
      10,
    );
  });
});

describe("washEmphasisForPalette", () => {
  const palette = seasonalPaletteFor(10, "day");

  it("強さを渡さなければ従来どおり (既存の呼び出しを壊さない)", () => {
    expect(washEmphasisForPalette(palette)).toEqual(
      washEmphasisForPalette(palette, "base"),
    );
  });

  it("soft は同じ配色の base より濃度が低い", () => {
    const soft = washEmphasisForPalette(palette, "soft");
    const base = washEmphasisForPalette(palette, "base");
    expect(soft.alpha).toBeLessThan(base.alpha);
    expect(soft.midAlpha).toBeLessThan(base.midAlpha);
    for (const key of SHAPE_KEYS) {
      expect(soft[key]).toBe(base[key]);
    }
  });
});
