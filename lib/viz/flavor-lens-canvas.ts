/**
 * 「好みの位置」— 手もとのレンズ が使う Canvas 側の軸と紙の色。
 *
 * ## なぜ `lib/viz/quadrant.ts` の Canvas 版をそのまま使わないのか
 *
 * `drawQuadrantAxesCanvas` は **目盛 (±0.5 の極小マーク) を必ず描く**。
 * 手もとのレンズは対話しながら「味の近さ」を体で測る図なので、目盛があると
 * 「読み取る図」に見えて、触る前に構えられてしまう。原版も `ticks: false` で
 * 消してある (verdicts.md 第7ラウンド)。既存の `quadrant.ts` に引数を足すと
 * 4 象限を使う他の 2 枚の見た目に影響が出るため、**ここに目盛なしの版を持つ**。
 * 線幅・色・字の大きさ・寄せ方は `quadrant.ts` と同じ値を使う (見た目は揃う)。
 *
 * 象限の地色 (tint) も敷かない。足あとを `multiply` で敷く図なので、地に薄墨が
 * あると足あとの濃淡が読めなくなる。
 *
 * ## 色をここに置く理由
 *
 * `components/**\/*.tsx` は ESLint `elxea-tokens/no-raw-colors` が効いていて
 * 生の色を書けない。Canvas の `fillStyle` はトークン (`var(--color-*)`) を
 * 解決しないので、実値は `lib/` 側に置いて import する
 * (`lib/viz/roji-viz-palette.ts` 冒頭と同じ事情)。
 *
 * 出典: viz 査定 `verdicts.md` 第7ラウンド `31-flavor-interactive/01-lens.html` /
 * `20-flavor-matrix/axes.js` (`ticks: false`)。
 */

import { isNarrowLayout, type QuadrantAxisText, type QuadrantLayout } from "./quadrant";
import { ROJI_VIZ_COLOR, ROJI_VIZ_SERIF, hexToRgb } from "./roji-viz-palette";

/**
 * 手もとのレンズだけが使う色。
 *
 * `ROJI_VIZ_COLOR` の 4 色で足りない 2 用途だけを足す。トークンの写しではない。
 */
export const ROJI_LENS_COLOR = {
  /**
   * 紙を白く抜くときの白。生成り (`kinari`) より **明るい**必要がある。
   *
   * 「近い味が明るくなる」を不透明度で作ると、生成りの紙の上では濃くなる =
   * 暗くなって狙いと逆になる (verdicts.md 第7ラウンド 落とし穴 1)。主役は
   * その茶の色のにじみで、この白は薄く敷く下支えにすぎない。
   */
  paperGlow: "#FFFDF6",
  /** 銘柄カードの紙。上から下へわずかに沈む 3 段。 */
  cardPaperTop: "#F8F4EC",
  cardPaperMid: "#F2EEE3",
  cardPaperBottom: "#EEE9DC",
} as const;

/** 銘柄カードの紙 (生成りの紙を斜めに漉いたような面)。 */
export const LENS_CARD_PAPER_GRADIENT =
  `linear-gradient(160deg, ${ROJI_LENS_COLOR.cardPaperTop} 0%, ` +
  `${ROJI_LENS_COLOR.cardPaperMid} 62%, ${ROJI_LENS_COLOR.cardPaperBottom} 100%)`;

/**
 * 銘柄カードに重ねる紙目。
 *
 * 外部ファイルを増やさないため `feTurbulence` を data URI で持つ。`#` は URL の
 * 断片扱いになるので `%23` で書く (ここを直すとフィルタ参照が切れて面が消える)。
 */
const CARD_GRAIN_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' seed='7'/>" +
  "<feColorMatrix type='saturate' values='0'/></filter>" +
  "<rect width='120' height='120' filter='url(%23n)' opacity='0.5'/></svg>";

export const LENS_CARD_GRAIN_IMAGE = `url("data:image/svg+xml;utf8,${CARD_GRAIN_SVG}")`;

/** `#rrggbb` + 透明度 → `rgba(...)`。実行時に組むので tsx に生の色が残らない。 */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

/** すでに分解済みの `[r, g, b]` + 透明度 → `rgba(...)`。毎フレーム呼ぶ側用。 */
export function rgbaOf(rgb: readonly [number, number, number], alpha: number): string {
  return `rgba(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])},${alpha.toFixed(3)})`;
}

/** 軸ラベルの字の大きさ。`quadrant.ts` の非公開関数と同じ値。 */
function axisFontSize(layout: QuadrantLayout): number {
  return layout.planeWidth < 420 ? 10 : 12;
}

/**
 * Canvas に 4 象限の軸を描く。**目盛は描かない・象限の地色も敷かない**。
 *
 * 狭い枠では左右の軸ラベルを枠の端に寄せ、象限名を出さない
 * (`quadrant.ts` と同じ作法。作図面の端に置くと 390px 幅で右端が切れる)。
 */
export function drawFlavorLensAxes(
  ctx: CanvasRenderingContext2D,
  layout: QuadrantLayout,
  text: QuadrantAxisText
): void {
  const { sx, sy, cx, cy } = layout;
  const x0 = sx(-1.02);
  const x1 = sx(1.02);
  const y0 = sy(1.02);
  const y1 = sy(-1.02);
  const fs = axisFontSize(layout);

  ctx.save();
  // 中心十字だけ。グリッドは引かない (ダッシュボードに見えないための非交渉点)。
  ctx.strokeStyle = rgba(ROJI_VIZ_COLOR.sumi, 0.3);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(x0, cy);
  ctx.lineTo(x1, cy);
  ctx.moveTo(cx, y0);
  ctx.lineTo(cx, y1);
  ctx.stroke();

  ctx.font = `300 ${fs}px ${ROJI_VIZ_SERIF}`;
  ctx.fillStyle = rgba(ROJI_VIZ_COLOR.sumi, 0.66);
  ctx.textBaseline = "middle";
  const narrow = isNarrowLayout(layout);
  if (narrow) {
    ctx.textAlign = "left";
    ctx.fillText(text.left, 2, cy);
    ctx.textAlign = "right";
    ctx.fillText(text.right, layout.width - 2, cy);
  } else {
    ctx.textAlign = "right";
    ctx.fillText(text.left, x0 - 10, cy);
    ctx.textAlign = "left";
    ctx.fillText(text.right, x1 + 10, cy);
  }
  ctx.textAlign = "center";
  ctx.fillText(text.top, cx, y0 - 14);
  ctx.fillText(text.bottom, cx, y1 + 16);

  if (!narrow) {
    ctx.font = `300 ${fs + 3}px ${ROJI_VIZ_SERIF}`;
    ctx.fillStyle = rgba(ROJI_VIZ_COLOR.hoji, 0.3);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(text.quadrant.tl, x0 + 10, y0 + 8);
    ctx.textAlign = "right";
    ctx.fillText(text.quadrant.tr, x1 - 10, y0 + 8);
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    ctx.fillText(text.quadrant.bl, x0 + 10, y1 - 6);
    ctx.textAlign = "right";
    ctx.fillText(text.quadrant.br, x1 - 10, y1 - 6);
  }
  ctx.restore();
}
