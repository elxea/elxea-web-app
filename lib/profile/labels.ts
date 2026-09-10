/**
 * 言葉の札をどこに置くか / この倍率では置かないか を決める純関数。
 *
 * 画面 (Canvas) を知らない — 呼び出し側が `ctx.measureText` で測った札の大きさを
 * **px で**渡し、ここは矩形の重なりだけを見る。だから Vitest で検査できる
 * (Canvas に依存する部分は描き手に残る)。
 *
 * ## 「寄って消えるものはない。すべては分解されるだけ」
 *
 * Setaka 確定要件。よってここは **語を捨てない**。同じ倍率で重なるものを
 * `deferred` に回すだけで、倍率が上がれば札どうしの画面距離は倍率に比例して
 * 開く一方、札の大きさ (px) は変わらないので、**寄れば必ず現れる**。
 * 「間引いて終わり」ではなく「いまはまだ分解されていない」を表す。
 *
 * 優先順位は粗い語 → 細かい語 (一般語 → 共通語 → 個人語)。マクロでは象限の名が
 * 立ち、寄るほど共通語・個人語がそのあいだから現れる、という読み方になる。
 */

/** 置きたい札 1 枚。座標・大きさはすべて画面 px。 */
export interface LabelCandidate {
  /** 同一性 (テスト・デバッグ用。描画には使わない)。 */
  key: string;
  /** 置きたい中心 (px)。 */
  x: number;
  y: number;
  /** 実測した札の幅・高さ (px)。 */
  w: number;
  h: number;
  /** 小さいほど先に場所を取る。 */
  priority: number;
}

export interface LabelPlacement {
  key: string;
  /** 実際に置いた中心 (px)。ずらしが入ると `candidate.y` と異なる。 */
  x: number;
  y: number;
}

export interface PlaceLabelsResult {
  placed: LabelPlacement[];
  /** この倍率では置けなかった札の key。寄れば現れる (消したのではない)。 */
  deferred: string[];
}

export interface PlaceLabelsOptions {
  /** 札どうしのあいだに最低限あけるすき間 (px)。 */
  gap?: number;
  /**
   * 元の位置に置けなかったときに試す縦のずらし量 (px)。
   *
   * 横ではなく縦にずらすのは、文字が横に長く縦に短いから — 縦にずらす方が
   * 少ない移動量で重なりが解ける (`lib/profile/words.ts#relax` が横長の楕円で
   * 押しのけているのと同じ理由)。
   */
  nudges?: readonly number[];
}

const DEFAULT_GAP = 3;
const DEFAULT_NUDGES: readonly number[] = [6, -6, 12, -12, 18, -18];

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function rectOf(cx: number, cy: number, w: number, h: number, gap: number): Rect {
  return {
    x0: cx - w / 2 - gap / 2,
    y0: cy - h / 2 - gap / 2,
    x1: cx + w / 2 + gap / 2,
    y1: cy + h / 2 + gap / 2,
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * 重なりを避けて札を置く。置けなかったものは `deferred` に回す (捨てない)。
 *
 * 貪欲法。優先度の小さい順に、元の位置 → 少しずつ縦にずらした位置、の順で
 * 空いている所を探す。件数は語彙表の規模 (数十) なので総当たりで足りる。
 */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  options: PlaceLabelsOptions = {},
): PlaceLabelsResult {
  const gap = options.gap ?? DEFAULT_GAP;
  const nudges = options.nudges ?? DEFAULT_NUDGES;

  const order = candidates
    .map((c, index) => ({ c, index }))
    .sort((a, b) => a.c.priority - b.c.priority || a.index - b.index);

  const taken: Rect[] = [];
  const placed: LabelPlacement[] = [];
  const deferred: string[] = [];

  for (const { c } of order) {
    let put: LabelPlacement | null = null;
    for (const dy of [0, ...nudges]) {
      const rect = rectOf(c.x, c.y + dy, c.w, c.h, gap);
      if (taken.some((t) => intersects(t, rect))) continue;
      taken.push(rect);
      put = { key: c.key, x: c.x, y: c.y + dy };
      break;
    }
    if (put) placed.push(put);
    else deferred.push(c.key);
  }

  return { placed, deferred };
}
