/**
 * elxea journal の号のテーマ色から「にじみ」の 4 色を作る純関数。
 *
 * ## なぜ季節の色をそのまま使わないか
 * 読みもの系の面は既定で季節の色 (`seasonalPaletteFor`) を敷く。ただし
 * elxea journal は号ごとに **茜 / 翠 / そひ** のテーマ色を持ち、その色は記事の
 * バッジ・目次・一覧のすべてに出ている。同じページの背景だけが無関係な季節色に
 * なると、号の色が「ラベルに付いた色」に落ちる。テーマ色を面の側にも回すことで、
 * 号の色は **その号を読んでいる間ずっとそこにある空気** になる。
 * (Setaka 判断 2026-08-12:「テーマ色を活かして共存させる」)
 *
 * ## テーマ色から何を取るか — 色相だけ
 * テーマ色は UI 用の色で、バッジの地として読めるだけの彩度を持つ
 * (茜 C=0.133 は面の帯 0.006〜0.062 の 2 倍以上)。それを面へそのまま持ち込むと
 * 背景が本文より強く出る。よってテーマ色から受け取るのは **色相** で、
 * 明度と彩度は月の色 (`MONTHLY_BASE`) と同じ帯へ写す。彩度はテーマ間の
 * 大小関係だけ残す (茜がいちばん濃い、というトークン側の性格は保つ)。
 *
 * ## 時間帯はそのまま効く
 * 4 色を作ったあとは季節と同じ `shapePalette` を通す。朝昼夕夜の効かせ方も、
 * 彩度と明度の上限下限も、季節側と 1 本の実装を共有する。テーマ色が入ると
 * 夜の設計が別物になる、という分岐を作らないためにこの順序にしている。
 *
 * 正本: Planning｜roji眺めの面コンセプト
 * https://www.notion.so/3b970c9d064c816da7b3c0bf2c15557f
 */

import { type Oklch } from "./color";
import {
  shapePalette,
  type OklchQuad,
  type SeasonalPalette,
  type TimeOfDay,
} from "./seasonal-palette";

/** 号のテーマ。Sanity の `journal.theme` と同じ値。 */
export type JournalTheme = "akane" | "sui" | "sohi";

export const JOURNAL_THEMES: readonly JournalTheme[] = [
  "akane",
  "sui",
  "sohi",
] as const;

/**
 * テーマ色の実値。`dist/tokens.css` の `--color-brand-tea-*` の写し。
 *
 * ここに実値を置くのは、面の色を作るのに **CSS 変数を解決できない** ため
 * (純関数はブラウザに依存しない)。トークン側が動いたらここも動かす必要がある。
 * 対応は `__tests__/viz-theme-palette.test.ts` が `dist/tokens.css` を読んで
 * 照合するので、片方だけ動けばテストが落ちる。
 */
export const JOURNAL_THEME_COLOR: Record<JournalTheme, Oklch> = {
  /** 茜 — brand-tea-red */
  akane: { l: 0.572, c: 0.133, h: 16.4 },
  /** 翠 — brand-tea-green */
  sui: { l: 0.807, c: 0.05, h: 178.3 },
  /** そひ — brand-tea-warm */
  sohi: { l: 0.821, c: 0.061, h: 41.5 },
};

/**
 * 文字列 -> テーマ。未知の値は null (季節の色へ落とす)。
 *
 * Sanity のフィールドは自由入力に近いので、知らない値が来たときに例外を投げず
 * 「テーマ無し」に倒す。背景は無くても記事は読めなければならない。
 */
export function asJournalTheme(value: string | null | undefined): JournalTheme | null {
  return JOURNAL_THEMES.includes(value as JournalTheme)
    ? (value as JournalTheme)
    : null;
}

/**
 * テーマ色の彩度 -> 面のもとになる彩度。
 *
 * 月の色の彩度帯 (0.006〜0.062) の上半分へ写す。定数を足してから小さく掛けるのは、
 * トークン間の差 (0.05〜0.133) をそのまま縮めると翠とそひがほぼ同値になり、
 * 3 テーマが色相だけの違いになるため。大小関係は残しつつ幅を圧縮する。
 */
function leadChroma(themeChroma: number): number {
  return Math.min(0.062, Math.max(0.036, 0.03 + themeChroma * 0.22));
}

const o = (l: number, c: number, h: number): Oklch => ({ l, c, h });
const hue = (deg: number): number => ((deg % 360) + 360) % 360;

/**
 * 中立色の色相 (寒色側)。
 *
 * 地に使う 2 色はテーマ色を持たせない。地はどの号でも「紙」と「宵闇」であって
 * 号の色ではないからで、地まで染めると号ごとにページの明るさが変わってしまう。
 *
 * 暖色 (黄み) ではなく寒色に置いてあるのは `assignRoles` の都合。暗い時間帯の
 * 主役は「琥珀 55 度にいちばん近い色」= 灯りとして選ばれるので、中立色を暖色に
 * 置くと **翠のような寒色テーマで中立色が主役に選ばれ、号の色が面から消える**
 * (実測: 中立を色相 95 に置いたとき、翠の夜の主役が中立色になった)。
 * 寒色側へ逃がすことで、どのテーマでも主役はテーマ色の側から選ばれる。
 */
const NEUTRAL_HUE = 250;

/** テーマ -> 面のもとになる 4 色。時間帯を掛ける前の値。 */
export function themeQuad(theme: JournalTheme): OklchQuad {
  const source = JOURNAL_THEME_COLOR[theme];
  const lead = leadChroma(source.c);
  return [
    // 主役候補。明るい時間帯は「いちばん彩度の高い色」として選ばれる。
    o(0.836, lead, hue(source.h)),
    // 中間 (明るい側)。テーマ色を少し暖色へ振った隣色。暗い時間帯はここが
    // 灯りに選ばれることがあるが、テーマ色から 26 度以内なので号の色は保たれる。
    o(0.882, lead * 0.62, hue(source.h + 26)),
    // 地 (明るい時間帯)。紙。テーマによらず共通。
    o(0.936, 0.012, NEUTRAL_HUE),
    // 地 (暗い時間帯)。宵闇。テーマによらず共通。
    o(0.76, 0.01, NEUTRAL_HUE),
  ];
}

/** テーマ + 時間帯 -> 面の 4 色。純関数。 */
export function themePaletteFor(
  theme: JournalTheme,
  timeOfDay: TimeOfDay,
): SeasonalPalette {
  return shapePalette(themeQuad(theme), timeOfDay);
}
