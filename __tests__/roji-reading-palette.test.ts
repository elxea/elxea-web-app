import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { hexToOklch, oklchToHex } from "@/lib/roji/color";
import {
  paperAnchoredPalette,
  readingPaletteFor,
  readingThemePaletteFor,
  READING_LIGHTNESS_CEIL,
  READING_LIGHTNESS_FLOOR,
} from "@/lib/roji/reading-palette";
import { seasonalPaletteFor, TIMES_OF_DAY } from "@/lib/roji/seasonal-palette";
import { JOURNAL_THEMES } from "@/lib/roji/theme-palette";
import { resolveWashIntensity } from "@/lib/roji/wash-emphasis";

/**
 * 読みもの系に敷ける色かどうかの検査。
 *
 * ## いちばん大事な 1 本
 * 「**本文が読めること**」。にじみは背景なので、季節や時刻がどう転んでも
 * 本文のコントラストを落としてはいけない。ここを緩めると、夜に来た読者にだけ
 * 読めないページが出る (しかも実装者は昼にしか見ないので気づけない)。
 *
 * 検査は 12ヶ月 x 4時間帯 x 4色 = 192 通り + テーマ 3 x 4時間帯 x 4色 = 48 通りを
 * 全数で回す。サンプリングしないのは、壊れるのが特定の月・特定の時間帯だからで、
 * 実際 v0 の探索でも 9月と 11月の夜だけが落ちていた。
 */

const TOKENS_CSS = readFileSync(
  path.join(process.cwd(), "dist", "tokens.css"),
  "utf8",
);

/** `dist/tokens.css` から oklch トークンを 1 つ読む。値の二重管理を避ける。 */
function tokenOklch(name: string) {
  const match = TOKENS_CSS.match(
    new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`),
  );
  if (!match) throw new Error(`token not found: --${name}`);
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

/** 紙 (ページの地) と本文の文字色。実際に敷かれる相手そのもの。 */
const PAPER = oklchToHex(tokenOklch("color-background"));
const TEXT = oklchToHex(tokenOklch("color-foreground"));

/** 読みもの系で使う不透明度。実装 (`ReadingWash` の intensity="soft") と同じ経路で取る。 */
const READING_OPACITY = resolveWashIntensity("soft").opacity;

/** 色相環上の短い方の弧の長さ (0-180)。 */
function hueDistance(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

function channels(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** WCAG 2.x の相対輝度。 */
function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * CSS の `opacity` と同じ合成 (ガンマ済み sRGB 上での線形補間)。
 *
 * 線形光ではなくガンマ済みで混ぜるのは、ブラウザの既定
 * (`color-interpolation` 未指定) がそうだから。ここを線形でやると実物より
 * 明るく出て、テストだけが通る。
 */
function compositeOverPaper(hex: string, alpha: number): string {
  const fg = channels(hex);
  const bg = channels(PAPER);
  return `#${fg
    .map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** 何も敷いていない状態の本文コントラスト。すべての比較の基準。 */
const BASELINE_CONTRAST = contrastRatio(TEXT, PAPER);

describe("前提 (トークン側が動いたらここが落ちる)", () => {
  it("素の紙の上で本文は AA を満たしている", () => {
    expect(BASELINE_CONTRAST).toBeGreaterThanOrEqual(4.5);
  });
});

describe("paperAnchoredPalette", () => {
  it("明度は指定の帯に収まる", () => {
    for (let month = 1; month <= 12; month += 1) {
      for (const time of TIMES_OF_DAY) {
        for (const hex of paperAnchoredPalette(seasonalPaletteFor(month, time))) {
          const { l } = hexToOklch(hex);
          expect(l).toBeGreaterThanOrEqual(READING_LIGHTNESS_FLOOR - 0.02);
          expect(l).toBeLessThanOrEqual(READING_LIGHTNESS_CEIL + 0.02);
        }
      }
    }
  });

  it("明度の順位は元の配色のまま (夜の地はやはりいちばん暗い)", () => {
    const source = seasonalPaletteFor(12, "night");
    const anchored = paperAnchoredPalette(source);
    const order = (colors: string[]) =>
      colors
        .map((hex, index) => ({ index, l: hexToOklch(hex).l }))
        .sort((a, b) => a.l - b.l)
        .map((entry) => entry.index);
    expect(order(anchored)).toEqual(order(source));
  });

  it("色みのある色の色相は動かさない (季節の色が別物にならない)", () => {
    /**
     * ほぼ無彩色の色 (地の紙など) は除く。彩度 0.01 前後の色は 8bit の hex へ
     * 落とす時点で 1 段の丸めが色相を数度動かすため、色相の一致で検査しても
     * 精度ではなく量子化を見ることになる。色みが読める色だけを対象にする。
     */
    const CHROMA_FLOOR = 0.03;
    for (const month of [3, 5, 8, 10, 12]) {
      for (const time of TIMES_OF_DAY) {
        const source = seasonalPaletteFor(month, time);
        const anchored = paperAnchoredPalette(source);
        source.forEach((hex, index) => {
          const before = hexToOklch(hex);
          if (before.c < CHROMA_FLOOR) return;
          const after = hexToOklch(anchored[index]);
          expect(
            hueDistance(after.h, before.h),
            `${month}/${time} ${hex} -> ${anchored[index]}`,
          ).toBeLessThan(4);
        });
      }
    }
  });

  it("彩度は元より落ちる (明るい地の上では同じ彩度が強く出るため)", () => {
    const source = seasonalPaletteFor(10, "day");
    const anchored = paperAnchoredPalette(source);
    source.forEach((hex, index) => {
      expect(hexToOklch(anchored[index]).c).toBeLessThanOrEqual(
        hexToOklch(hex).c + 1e-6,
      );
    });
  });

  it("明度差の無い配色でも壊れない", () => {
    const flat = paperAnchoredPalette(["#808080", "#808080"]);
    expect(flat).toHaveLength(2);
    expect(flat[0]).toBe(flat[1]);
  });

  it("空配列は空配列", () => {
    expect(paperAnchoredPalette([])).toEqual([]);
  });
});

describe("読みもの系の面は本文の可読性を落とさない", () => {
  it("季節の色 192 通りすべてで本文が AA (4.5:1) を保つ", () => {
    const failures: string[] = [];
    for (let month = 1; month <= 12; month += 1) {
      for (const time of TIMES_OF_DAY) {
        for (const hex of readingPaletteFor(month, time)) {
          const surface = compositeOverPaper(hex, READING_OPACITY);
          const ratio = contrastRatio(TEXT, surface);
          if (ratio < 4.5) {
            failures.push(`${month}/${time} ${hex} -> ${ratio.toFixed(3)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("号のテーマ色 48 通りすべてで本文が AA (4.5:1) を保つ", () => {
    const failures: string[] = [];
    for (const theme of JOURNAL_THEMES) {
      for (const time of TIMES_OF_DAY) {
        for (const hex of readingThemePaletteFor(theme, time)) {
          const surface = compositeOverPaper(hex, READING_OPACITY);
          const ratio = contrastRatio(TEXT, surface);
          if (ratio < 4.5) {
            failures.push(`${theme}/${time} ${hex} -> ${ratio.toFixed(3)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("素の紙と比べて失うコントラストは 2 割以内", () => {
    let worst = Infinity;
    for (let month = 1; month <= 12; month += 1) {
      for (const time of TIMES_OF_DAY) {
        for (const hex of readingPaletteFor(month, time)) {
          worst = Math.min(
            worst,
            contrastRatio(TEXT, compositeOverPaper(hex, READING_OPACITY)),
          );
        }
      }
    }
    expect(worst / BASELINE_CONTRAST).toBeGreaterThan(0.8);
  });

  it("写す前の季節の色をそのまま敷いたら AA を割る (この関数が要る理由)", () => {
    const rawNight = seasonalPaletteFor(11, "night");
    const worst = Math.min(
      ...rawNight.map((hex) =>
        contrastRatio(TEXT, compositeOverPaper(hex, READING_OPACITY)),
      ),
    );
    expect(worst).toBeLessThan(4.5);
  });
});

describe("読みもの系でも時間帯と季節の差は残る", () => {
  it("同じ月でも時間帯が違えば色が違う", () => {
    const byTime = TIMES_OF_DAY.map((time) => readingPaletteFor(9, time).join(","));
    expect(new Set(byTime).size).toBe(TIMES_OF_DAY.length);
  });

  it("同じ時間帯でも月が違えば色が違う", () => {
    const byMonth = [1, 4, 7, 10].map((m) => readingPaletteFor(m, "day").join(","));
    expect(new Set(byMonth).size).toBe(4);
  });

  it("4 色は団子にならない (明度が全部同じにならない)", () => {
    for (let month = 1; month <= 12; month += 1) {
      for (const time of TIMES_OF_DAY) {
        const ls = readingPaletteFor(month, time).map((hex) => hexToOklch(hex).l);
        expect(Math.max(...ls) - Math.min(...ls)).toBeGreaterThan(0.05);
      }
    }
  });
});
