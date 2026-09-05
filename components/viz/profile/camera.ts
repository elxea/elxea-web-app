/**
 * カメラ・慣性・ズーム。座標だけ知る純粋な状態機械 (DOM を持たない)。
 *
 * 試作 `roji-r4-zoom-20260904.html` の「入れ子の10の冪」(`SX`/`SY`/`NX`/`NY`) の
 * 考え方を移植。
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
 * 画面が読み上げる「自分は中心にいて」と絵が食い違っていたことになる。
 *
 * よって中心 (`cx`/`cy`) は **`lib/profile/framing.ts#sceneFraming` が返す
 * anchor** を入れる。anchor は 自分 (`self.centroid`) を最優先し、未ログインで
 * 自分の粒が描かれないときは**みんなの分布の重心**に落ちる。倍率の基準
 * (`baseScale`) も定数をやめ、板の大きさと中身の広がりから決める
 * (`fitBaseScale`) — 40px/world-unit の固定値では、-1..1 の言葉の面が板の
 * 真ん中 70px 四方に潰れていた。
 *
 * ## 自由パン (泳ぐ操作) は廃止
 *
 * 同じ決定の帰結として「他者のコメントを自由パンで探しに行く」操作を廃止した。
 * 移動はズームだけで行い、`panBy` は持たない。自分は常に中心にいるため
 * 「じぶんへ戻る」も「画面外に出た」の印も存在しない (どちらも旧設計の
 * 自由パンを前提にしていた)。倍率だけを ×1 に戻す道は `0` キーと、板の右端の
 * 縦置きスライダーを下端まで下ろすこと。
 */

import type { CameraState } from "@/components/viz/profile/renderer";
import { fitBaseScale, type FramingPoint, type FramingRadius } from "@/lib/profile/framing";

/**
 * 板の縁と中身のあいだに残す px。
 *
 * 右端の縦置きスライダー (幅 ~14px + 右余白 8px) の下に中身が潜らない量を
 * 下限にしつつ、四方に同じだけ取る (どこか一方だけ余白が大きい絵にしない)。
 */
export const PROFILE_VIEW_PADDING = 56;

/**
 * `sceneFraming` がまだ無い最初の 1 フレームだけが使う倍率 (px / world-unit)。
 *
 * データが届いた時点で `cameraForFraming` が板の大きさから決め直すので、
 * これが画面に残ることは無い。
 */
const FALLBACK_BASE_SCALE = 40;

/** 倍率段は 10 の冪 (Spec の LOD 表と揃える)。0..2 の3段。 */
const MIN_Z = 0;
const MAX_Z = 2;
const ZOOM_BASE = 10;

/** データが届く前のカメラ。中心は原点・倍率は暫定値。 */
export function initialCamera(): CameraState {
  return { cx: 0, cy: 0, baseScale: FALLBACK_BASE_SCALE, scale: FALLBACK_BASE_SCALE, z: MIN_Z };
}

/** 倍率段 z のときの px / world-unit。 */
export function scaleForZ(z: number, baseScale = FALLBACK_BASE_SCALE): number {
  return baseScale * Math.pow(ZOOM_BASE, z);
}

function clampZ(z: number): number {
  return Math.max(MIN_Z, Math.min(MAX_Z, z));
}

/**
 * 中心 (自分) と、1 画面に収めたい広がりと、板の大きさからカメラを組み立てる。
 *
 * 倍率段 `z` は引き継ぐ — 板の大きさが変わった (回転・リサイズ) だけで
 * 見ている倍率が飛ぶと、読んでいた場所を失う。
 */
export function cameraForFraming(params: {
  anchor: FramingPoint;
  radius: FramingRadius;
  viewW: number;
  viewH: number;
  z?: number;
  padding?: number;
}): CameraState {
  const z = clampZ(params.z ?? MIN_Z);
  const baseScale = fitBaseScale(
    params.radius,
    params.viewW,
    params.viewH,
    params.padding ?? PROFILE_VIEW_PADDING,
  );
  return {
    cx: params.anchor.x,
    cy: params.anchor.y,
    baseScale,
    scale: scaleForZ(z, baseScale),
    z,
  };
}

/** 倍率段だけを変える。中心 (自分) と倍率の基準は動かさない。 */
export function zoomBy(camera: CameraState, deltaZ: number): CameraState {
  return zoomTo(camera, camera.z + deltaZ);
}

/** 倍率段を直接指定する (ズームスライダー用)。中心は常に自分。 */
export function zoomTo(camera: CameraState, z: number): CameraState {
  const nextZ = clampZ(z);
  return { ...camera, scale: scaleForZ(nextZ, camera.baseScale), z: nextZ };
}

/**
 * カメラのなめらかな追従 (EMA)。滑らかさ最優先の要件により、倍率は毎フレーム
 * 目標値へこの割合ずつ寄せる。`prefers-reduced-motion` のときは呼び出し側が
 * そもそもこれを使わず、目標値をそのまま採用する。
 *
 * 中心 (`cx`/`cy`) と倍率の基準 (`baseScale`) は補間しない — これらが動くのは
 * 「データが届いた」「板の大きさが変わった」の 2 つだけで、どちらも**そこへ
 * 滑って行く**動きに意味が無い (自分が画面の中を移動して見える)。呼び出し側は
 * その 2 つの機会に現在値と目標値を同時に置き換える。
 */
export function easeCamera(current: CameraState, target: CameraState, alpha = 0.18): CameraState {
  return {
    cx: target.cx,
    cy: target.cy,
    baseScale: target.baseScale,
    scale: current.scale + (target.scale - current.scale) * alpha,
    z: target.z,
  };
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
