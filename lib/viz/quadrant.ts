/**
 * 4 象限の作図面と軸。「味の四象限」と「香りの場」が共有する。
 *
 * ## ダッシュボードに見えないための作法 (非交渉)
 *
 * - グリッドは引かない。**中心十字だけ** 0.7px / 不透明度 0.30
 * - 目盛は ±0.5 の位置に 6px の極小マークのみ。数値は書かない
 * - 軸ラベル・象限名は明朝の小さな文字。象限名は焙じ茶色を 0.30 まで落とす
 * - **作図面は 1.35:1 で中央に置く**。枠いっぱいに引き伸ばすと縦軸が潰れ、
 *   散布図ではなく「帯」に見える (verdicts.md 第3ラウンド 共通の土台)
 *
 * 出典: viz 査定 `verdicts.md` 第3ラウンド `20-flavor-matrix/axes.js`。
 * フルスクリーン前提だった原版を、ページの中の箱に収まるよう余白計算だけ
 * 書き換えてある (色・線幅・字の大きさは原版のまま)。
 */

import { ROJI_VIZ_COLOR, ROJI_VIZ_SERIF } from "./roji-viz-palette";

/** 作図面の縦横比。縦を基準にする。 */
const PLANE_ASPECT = 1.35;

/**
 * 「狭い枠」の境目 (px)。SP はここより下に来る。
 *
 * 狭い枠では 2 つの作法を変える:
 * 1. 左右の軸ラベルは**作図面の端ではなく枠の端**に寄せる。作図面基準のままだと
 *    「あ た た か」が枠から出て切れる (実測: 390px 幅で右端が欠けた)
 * 2. 象限名を出さない。狭い枠では象限名がデータの語 (香り名・銘柄名) と
 *    重なって、どちらも読めなくなる
 */
export const NARROW_PLANE = 520;

export interface QuadrantLayout {
  /** 枠の大きさ。 */
  width: number;
  height: number;
  /** 作図面 (中心十字が張る矩形)。 */
  planeWidth: number;
  planeHeight: number;
  left: number;
  top: number;
  /** -1..+1 → 画面 x */
  sx: (x: number) => number;
  /** -1..+1 → 画面 y (+1 が上) */
  sy: (y: number) => number;
  /** 中心。 */
  cx: number;
  cy: number;
}

/**
 * 枠の大きさから作図面を決める。
 *
 * `pad` は軸ラベル・象限名が載る帯。ここを削ると「甘 み」「渋 み」が枠外に出る。
 */
export function quadrantLayout(
  width: number,
  height: number,
  pad: { x: number; y: number } = { x: 56, y: 44 }
): QuadrantLayout {
  const availW = Math.max(40, width - pad.x * 2);
  const availH = Math.max(40, height - pad.y * 2);
  const planeHeight = Math.min(availH, availW / PLANE_ASPECT);
  const planeWidth = planeHeight * PLANE_ASPECT;
  const left = (width - planeWidth) / 2;
  const top = (height - planeHeight) / 2;
  const sx = (x: number) => left + ((x + 1) / 2) * planeWidth;
  const sy = (y: number) => top + ((1 - y) / 2) * planeHeight;
  return {
    width,
    height,
    planeWidth,
    planeHeight,
    left,
    top,
    sx,
    sy,
    cx: sx(0),
    cy: sy(0),
  };
}

export interface QuadrantAxisText {
  left: string;
  right: string;
  top: string;
  bottom: string;
  quadrant: { tl: string; tr: string; bl: string; br: string };
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const key of Object.keys(attrs)) node.setAttribute(key, String(attrs[key]));
  return node;
}

/** 軸ラベルの字の大きさ。枠が小さいと 12px でも枠を割るので少しだけ縮める。 */
function axisFontSize(layout: QuadrantLayout): number {
  return layout.planeWidth < 420 ? 10 : 12;
}

/** 狭い枠か。ラベルの寄せ方と象限名の有無がこれで決まる。 */
export function isNarrowLayout(layout: QuadrantLayout): boolean {
  return layout.width < NARROW_PLANE;
}

/** SVG に軸を描く。戻り値の `<g>` は呼び出し側が付け替える。 */
export function drawQuadrantAxesSvg(
  parent: SVGElement,
  layout: QuadrantLayout,
  text: QuadrantAxisText
): SVGElement {
  const g = svgEl("g", { "data-slot": "quadrant-axes" });
  const { sx, sy, cx, cy } = layout;
  const x0 = sx(-1.02);
  const x1 = sx(1.02);
  const y0 = sy(1.02);
  const y1 = sy(-1.02);
  const fs = axisFontSize(layout);

  g.appendChild(
    svgEl("line", { x1: x0, y1: cy, x2: x1, y2: cy, stroke: ROJI_VIZ_COLOR.sumi, "stroke-width": 0.7, opacity: 0.3 })
  );
  g.appendChild(
    svgEl("line", { x1: cx, y1: y0, x2: cx, y2: y1, stroke: ROJI_VIZ_COLOR.sumi, "stroke-width": 0.7, opacity: 0.3 })
  );

  for (const t of [-0.5, 0.5]) {
    g.appendChild(
      svgEl("line", { x1: sx(t), y1: cy - 3, x2: sx(t), y2: cy + 3, stroke: ROJI_VIZ_COLOR.sumi, "stroke-width": 0.6, opacity: 0.24 })
    );
    g.appendChild(
      svgEl("line", { x1: cx - 3, y1: sy(t), x2: cx + 3, y2: sy(t), stroke: ROJI_VIZ_COLOR.sumi, "stroke-width": 0.6, opacity: 0.24 })
    );
  }

  const label = (
    value: string,
    x: number,
    y: number,
    anchor: string,
    baseline: string
  ) => {
    const node = svgEl("text", {
      x,
      y,
      "text-anchor": anchor,
      "dominant-baseline": baseline,
      "font-family": ROJI_VIZ_SERIF,
      "font-size": fs,
      "letter-spacing": "0.26em",
      fill: ROJI_VIZ_COLOR.sumi,
      opacity: 0.66,
      "font-weight": 300,
    });
    node.textContent = value;
    return node;
  };
  // 狭い枠では枠の端に寄せる (作図面の端に置くと枠から出て切れる)。
  const narrow = isNarrowLayout(layout);
  if (narrow) {
    g.appendChild(label(text.left, 2, cy, "start", "middle"));
    g.appendChild(label(text.right, layout.width - 2, cy, "end", "middle"));
  } else {
    g.appendChild(label(text.left, x0 - 10, cy, "end", "middle"));
    g.appendChild(label(text.right, x1 + 10, cy, "start", "middle"));
  }
  g.appendChild(label(text.top, cx, y0 - 12, "middle", "auto"));
  g.appendChild(label(text.bottom, cx, y1 + 22, "middle", "auto"));

  const quadrant = (
    value: string,
    x: number,
    y: number,
    anchor: string,
    baseline: string
  ) => {
    const node = svgEl("text", {
      x,
      y,
      "text-anchor": anchor,
      "dominant-baseline": baseline,
      "font-family": ROJI_VIZ_SERIF,
      "font-size": fs + 3,
      "letter-spacing": "0.3em",
      fill: ROJI_VIZ_COLOR.hoji,
      opacity: 0.3,
      "font-weight": 300,
    });
    node.textContent = value;
    return node;
  };
  if (!narrow) {
    g.appendChild(quadrant(text.quadrant.tl, x0 + 10, y0 + 12, "start", "hanging"));
    g.appendChild(quadrant(text.quadrant.tr, x1 - 10, y0 + 12, "end", "hanging"));
    g.appendChild(quadrant(text.quadrant.bl, x0 + 10, y1 - 8, "start", "auto"));
    g.appendChild(quadrant(text.quadrant.br, x1 - 10, y1 - 8, "end", "auto"));
  }

  parent.appendChild(g);
  return g;
}

/** Canvas に軸を描く (SVG 版と同じ見た目)。 */
export function drawQuadrantAxesCanvas(
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
  ctx.strokeStyle = "rgba(43,43,43,0.30)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(x0, cy);
  ctx.lineTo(x1, cy);
  ctx.moveTo(cx, y0);
  ctx.lineTo(cx, y1);
  ctx.stroke();

  ctx.strokeStyle = "rgba(43,43,43,0.24)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (const t of [-0.5, 0.5]) {
    ctx.moveTo(sx(t), cy - 3);
    ctx.lineTo(sx(t), cy + 3);
    ctx.moveTo(cx - 3, sy(t));
    ctx.lineTo(cx + 3, sy(t));
  }
  ctx.stroke();

  ctx.font = `300 ${fs}px ${ROJI_VIZ_SERIF}`;
  ctx.fillStyle = "rgba(43,43,43,0.66)";
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
    ctx.fillStyle = "rgba(138,110,85,0.30)";
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
