/**
 * カメラ・倍率段。座標だけ知る純粋な状態機械 (DOM を持たない)。
 *
 * ## ズームの中心は常に自分 (Setaka決定 2026-09-05・反論なし)
 *
 * Decision Log https://app.notion.com/p/3d270c9d064c81139c05e51c73d374ac —
 * 「自分中心にズームするのは特別扱いではない。個と全体のつながりを自覚する
 * ためのプロセス」。よって画面中心は常に**自分**に固定し、カーソル位置中心・
 * 折衷・中央固定の切替設定は持たない (差し替え可能にする判断点にもしない —
 * 確定事項)。
 *
 * ## 「自分」は world 原点ではない (2026-09-06 訂正)
 *
 * 初版は `cx`/`cy` を常に 0 にして **world 原点を自分と見なしていた**。それが
 * 成り立たないことを実測で確認した: お茶の面の写像B は
 * `y = 香り + 味わい ∈ [2,10]` なので原点は嗜好空間の中に無く、生成データの
 * 重心は画面中心から 198〜291px 右下にずれて描かれていた (1024×640・実測)。
 * よって中心 (`cx`/`cy`) は `lib/profile/framing.ts#sceneFraming` が返す anchor
 * を入れる。
 *
 * ## 倍率段 `z` は「拡大率」ではなく「細かさ」である (2026-09-06 訂正・本 PR)
 *
 * ここが本 PR の核心。旧実装は `scale = baseScale * 10^z` で、`z` を素直に
 * 10 の冪の**拡大率**として使っていた。その結果 **寄ると画面が空になった**。
 *
 *   - z=2 の可視 world 窓は **0.034 単位**。一方で読み物・イベントの語の野は
 *     2.0 単位、密度格子の 1 セルは 0.0625 単位。**構造的に何も入らない窓**で、
 *     読み物・イベントの面は z≥1.4 で塗られた画素が 0、お茶の面は z≥1 で
 *     べた塗り一色になっていた (独立 QA 実測 2026-09-06)。
 *
 * Setaka 確定要件は「**寄って消えるものはない。すべては分解されるだけ**」。
 * 自由パンが廃止されている (同じ決定の帰結) 以上、画面中心は 1 点に固定される。
 * その 1 点のまわりを幾何的に拡大すれば、拡大率に比例して中身は必ず画面の外へ
 * 出て行く — **「消えない」と「幾何的に拡大する」は同時に成り立たない**。
 * 実測でも、読み物の面を ×2 にするだけで 18 枚の札のうち 14 枚が枠の外へ出る。
 *
 * よって `z` は幾何的な拡大率をやめ、**同じ枠のまま中身がどこまで分解されるか**
 * を表す段にした。
 *
 *   - 枠 (可視 world 窓) は `z` によらず一定。中身は 1 つも枠の外へ出ない。
 *   - `z` が上がるほど、密度格子は粗い段から細かい段へ切り替わり
 *     (LOD 表 16×12 〜 96×64 = `lib/profile/field.ts#resolveGridDims`)、
 *     等値線の段が増え (`contourLevelsFor`)、語が一般語 → 共通語 → 個人語へ
 *     分解される (`lib/profile/words.ts#buildWordsLayers`)。
 *
 * 「粗いデータの狭い切り抜き」ではなく「より細かい段階のデータ」を出す、という
 * Spec の LOD 表の意図そのままの読み方になる。
 *
 * ### なぜ「寄ったぶんだけ bbox を狭めてサーバーに測り直させる」を採らないか
 *
 * 窓を狭めてその窓だけで密度を測り直せば、どの倍率でも窓は必ず埋まる。しかし
 * それは Spec が `words` について明示的に禁じている「極小 bbox で少人数を孤立
 * 抽出する」経路を `field` に開くことになる (窓ごとに最大値で正規化するため、
 * 少人数の寄与がそのまま形になって出る)。匿名性の設計 (bbox 下限・cohort 丸め・
 * kバッチ更新) が前提にしている「bbox は固定」を崩すので採らない。
 *
 * ## 自由パン (泳ぐ操作) は廃止
 *
 * 「他者のコメントを自由パンで探しに行く」操作を廃止した (同じ決定の帰結)。
 * `panBy` は持たない。自分は常に中心にいるため「じぶんへ戻る」も「画面外に
 * 出た」の印も存在しない。
 */

import type { CameraState } from "@/components/viz/profile/renderer";
import {
  fitBaseScale,
  PROFILE_VIEW_PADDING_X,
  PROFILE_VIEW_PADDING_Y,
  type FramingPoint,
  type FramingRadius,
} from "@/lib/profile/framing";

/**
 * 板の縁と中身のあいだに残す px (実値の正本は `lib/profile/framing.ts`)。
 * 描き手・板・機械検査はカメラ越しに読むので、ここから再輸出する。
 */
export { PROFILE_VIEW_PADDING_X, PROFILE_VIEW_PADDING_Y };

/**
 * `sceneFraming` がまだ無い最初の 1 フレームだけが使う倍率 (px / world-unit)。
 *
 * データが届いた時点で `cameraForFraming` が板の大きさから決め直すので、
 * これが画面に残ることは無い。
 */
const FALLBACK_BASE_SCALE = 40;

/** 倍率段は 0..2 の 3 段 (Spec の LOD 表 macro / mid / micro と 1 対 1)。 */
export const PROFILE_MIN_Z = 0;
export const PROFILE_MAX_Z = 2;

/** データが届く前のカメラ。中心は原点・倍率は暫定値。 */
export function initialCamera(): CameraState {
  return { cx: 0, cy: 0, baseScale: FALLBACK_BASE_SCALE, scale: FALLBACK_BASE_SCALE, z: PROFILE_MIN_Z };
}

export function clampZ(z: number): number {
  return Math.max(PROFILE_MIN_Z, Math.min(PROFILE_MAX_Z, z));
}

/**
 * 倍率段 z のときの px / world-unit。
 *
 * **`z` に依存しない** (上の「倍率段 `z` は『拡大率』ではなく『細かさ』である」
 * 参照)。関数の形を残してあるのは、呼び出し側が「ここで倍率が決まる」ことを
 * 見失わないためと、表現を差し替える段 (Figma 確定後) に別の写し方を入れる口を
 * 1 か所に留めるため。
 */
export function scaleForZ(_z: number, baseScale = FALLBACK_BASE_SCALE): number {
  return baseScale;
}

/**
 * 中心 (自分) と、1 画面に収めたい広がりと、板の大きさからカメラを組み立てる。
 *
 * 倍率段 `z` は引き継ぐ — 板の大きさが変わった (回転・リサイズ) だけで
 * 見ている段が飛ぶと、読んでいた場所を失う。
 */
export function cameraForFraming(params: {
  anchor: FramingPoint;
  radius: FramingRadius;
  viewW: number;
  viewH: number;
  z?: number;
  paddingX?: number;
  paddingY?: number;
}): CameraState {
  const z = clampZ(params.z ?? PROFILE_MIN_Z);
  const baseScale = fitBaseScale(
    params.radius,
    params.viewW,
    params.viewH,
    params.paddingX ?? PROFILE_VIEW_PADDING_X,
    params.paddingY ?? PROFILE_VIEW_PADDING_Y,
  );
  return {
    cx: params.anchor.x,
    cy: params.anchor.y,
    baseScale,
    scale: scaleForZ(z, baseScale),
    z,
  };
}

/** 細かさの段だけを変える。枠 (中心・縮尺) は動かさない。 */
export function zoomBy(camera: CameraState, deltaZ: number): CameraState {
  return zoomTo(camera, camera.z + deltaZ);
}

/** 細かさの段を直接指定する (スライダー用)。中心は常に自分。 */
export function zoomTo(camera: CameraState, z: number): CameraState {
  const nextZ = clampZ(z);
  return { ...camera, scale: scaleForZ(nextZ, camera.baseScale), z: nextZ };
}

/**
 * カメラのなめらかな追従 (EMA)。
 *
 * 中心 (`cx`/`cy`)・倍率の基準 (`baseScale`)・実効倍率 (`scale`) は補間しない —
 * これらが動くのは「データが届いた」「板の大きさが変わった」の 2 つだけで、
 * どちらも**そこへ滑って行く**動きに意味が無い (自分が画面の中を移動して
 * 見える)。段 (`z`) の変化は枠を動かさず中身の細かさだけを変えるので、
 * ここで補間するものは無い。関数を残してあるのは、表現を差し替える段で
 * 「何を滑らかにするか」の置き場所を 1 か所に保つため。
 */
export function easeCamera(_current: CameraState, target: CameraState, _alpha = 0.18): CameraState {
  return target;
}

/** world 座標 → screen 座標。カメラの中心 (自分) が常に画面中心に写る。 */
export function worldToScreen(
  camera: CameraState,
  worldX: number,
  worldY: number,
  viewW: number,
  viewH: number,
): { x: number; y: number } {
  return {
    x: viewW / 2 + (worldX - camera.cx) * camera.scale,
    y: viewH / 2 + (worldY - camera.cy) * camera.scale,
  };
}

/**
 * いま画面に写っている world の矩形 `[x0, y0, x1, y1]`。
 *
 * 「この倍率で何が枠の中に居るか」を機械検査 (`__tests__/profile-zoom-*`) が
 * 数えるための唯一の計算。描き手と検査で別々に導出すると、片方だけ直したときに
 * 静かにずれる。
 */
export function visibleWorldRect(
  camera: CameraState,
  viewW: number,
  viewH: number,
): [number, number, number, number] {
  const halfW = viewW / 2 / camera.scale;
  const halfH = viewH / 2 / camera.scale;
  return [camera.cx - halfW, camera.cy - halfH, camera.cx + halfW, camera.cy + halfH];
}
