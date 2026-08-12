/**
 * 読みもの系の面に敷ける明るさへ「にじみ」の色を写す純関数。
 *
 * ## 何を解いているか
 * 季節の色は 1 日のうちに大きく沈む。夜の地は L=0.235 (深い藍) で、これは
 * 面そのものを眺めるプレビューでは正しい。ところが読みもの系の背景に同じ色を
 * 敷くと、**本文の文字色 (`--color-foreground`) が地に沈む**。elxea Web は
 * ダークモードを持たないので、文字は明るい紙の上に置かれる前提の 1 色しかない。
 *
 * 実測 (`scripts/scratch` の探索、下の定数はその結果):
 * - 季節の色をそのまま不透明度 0.2 で敷いただけで、11月夜の地の上の本文は
 *   コントラスト比 3.59 (基準 5.33 の 67%)。WCAG AA (4.5:1) を割る
 * - 不透明度を下げても足りない。地が L=0.235 である限り、見える濃さで敷けば
 *   必ず AA を割る
 *
 * ## 採った解 — 明度は紙のまま、色相と彩度だけ借りる
 * 「弱く敷く」を **不透明度だけ** で作るのをやめ、色そのものを紙の明度帯へ
 * 写してから敷く。読みもの系での「弱い」は
 * **「紙の明るさを動かさず、色みだけを季節に合わせる」** と定義する。
 *
 * 4 色の明度は帯 (`READING_LIGHTNESS_FLOOR`〜`READING_LIGHTNESS_CEIL`) へ
 * **順位を保ったまま正規化** する。絶対値ではなく相対の幅で写すのは、昼
 * (L 0.775〜0.945 = 幅 0.17) と夜 (L 0.235〜0.63 = 幅 0.40) で色の分かれ方が
 * 違うため。絶対値で切ると夜だけ 4 色が団子になり、時間帯の差が消える。
 *
 * 明度を上げると同じ彩度でも色は強く出る (淡い地の上の淡い色ほど目立つ) ので、
 * 彩度は少し落とす。
 *
 * ## この帯を動かすときの手続き
 * `__tests__/viz-reading-palette.test.ts` が 12ヶ月 x 4時間帯 x 4色 の
 * 192 通りすべてで「本文が AA を割らない」ことを検査する。数値を動かすなら
 * テストを緑にしたうえで実物を見ること。テストを緩めるのは可読性の後退なので
 * それ単体では通さない。
 */

import { hexToOklch, oklchToHex } from "./color";
import {
  seasonalPaletteFor,
  type SeasonalPalette,
  type TimeOfDay,
} from "./seasonal-palette";
import { themePaletteFor, type JournalTheme } from "./theme-palette";

/**
 * 読みもの系で許す最も暗い色の明度。
 *
 * 紙 (`--color-background` の L=0.933) より下だが、本文の文字 (L=0.482) からは
 * 十分離れている。0.87 は AA を保てる下限に近い値を実測で選んだもの。
 */
export const READING_LIGHTNESS_FLOOR = 0.87;

/**
 * 読みもの系で許す最も明るい色の明度。
 *
 * 紙より少しだけ上。上限を紙と同じ 0.933 にすると、いちばん明るい色が紙と
 * 同化して 4 色が実質 3 色になる。わずかに超えさせることで「紙より明るい
 * にじみ」が抜けとして効く。
 */
export const READING_LIGHTNESS_CEIL = 0.965;

/**
 * 明度を上げたぶん彩度を戻す倍率。
 *
 * 淡い地の上では同じ彩度でも色が強く読まれる。0.85 は「季節が分かる」と
 * 「本文の邪魔をしない」が両立した実測値。
 */
export const READING_CHROMA_SCALE = 0.85;

export interface PaperAnchorOptions {
  floorL?: number;
  ceilL?: number;
  chromaScale?: number;
}

/**
 * 4 色の明度を、順位を保ったまま指定の帯へ写す。彩度は倍率、色相はそのまま。
 *
 * 純関数。入力の色数は問わない (4 色前提だが 1 色でも壊れない)。
 */
export function paperAnchoredPalette(
  colors: string[],
  options: PaperAnchorOptions = {},
): string[] {
  const floorL = options.floorL ?? READING_LIGHTNESS_FLOOR;
  const ceilL = options.ceilL ?? READING_LIGHTNESS_CEIL;
  const chromaScale = options.chromaScale ?? READING_CHROMA_SCALE;

  const parsed = colors.map((hex) => hexToOklch(hex));
  if (parsed.length === 0) return [];

  const lows = parsed.map((c) => c.l);
  const lo = Math.min(...lows);
  const hi = Math.max(...lows);
  const span = hi - lo;
  const mid = (floorL + ceilL) / 2;

  return parsed.map((color) =>
    oklchToHex({
      // 明度差が無い配色 (単色) は帯の真ん中へ。0 除算を避けるためだけでなく、
      // 「差が無いものを無理に広げない」のが正しい振る舞いだから。
      l: span < 1e-4 ? mid : floorL + (ceilL - floorL) * ((color.l - lo) / span),
      c: color.c * chromaScale,
      h: color.h,
    }),
  );
}

/** 月 + 時間帯 -> 読みもの系に敷ける 4 色。純関数。 */
export function readingPaletteFor(
  month: number,
  timeOfDay: TimeOfDay,
): SeasonalPalette {
  return paperAnchoredPalette(
    seasonalPaletteFor(month, timeOfDay),
  ) as SeasonalPalette;
}

/** 号のテーマ + 時間帯 -> 読みもの系に敷ける 4 色。純関数。 */
export function readingThemePaletteFor(
  theme: JournalTheme,
  timeOfDay: TimeOfDay,
): SeasonalPalette {
  return paperAnchoredPalette(
    themePaletteFor(theme, timeOfDay),
  ) as SeasonalPalette;
}
