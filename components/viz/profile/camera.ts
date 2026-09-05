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
 * ためのプロセス」。よって world 座標の原点 (= 自分) は常に画面中心に固定し、
 * カーソル位置中心・折衷・中央固定の切替設定は持たない (差し替え可能にする
 * 判断点にもしない — 確定事項)。
 *
 * ## 自由パン (泳ぐ操作) は廃止
 *
 * 同じ決定の帰結として「他者のコメントを自由パンで探しに行く」操作を廃止した。
 * 移動はズームだけで行い、`panBy` は持たない。自分は常に中心にいるため
 * 「じぶんへ戻る」も「画面外に出た」の印も存在しない (どちらも旧設計の
 * 自由パンを前提にしていた)。
 */

import type { CameraState } from "@/components/viz/profile/renderer";

/** z=0 (×1) のときの px / world-unit。 */
const BASE_SCALE = 40;

/** 倍率段は 10 の冪 (Spec の LOD 表と揃える)。0..2 の3段。 */
const MIN_Z = 0;
const MAX_Z = 2;
const ZOOM_BASE = 10;

/** 自分 (world 原点) を常に画面中心に据えたカメラ。位置は常にこれで固定。 */
export function initialCamera(): CameraState {
  return { cx: 0, cy: 0, scale: BASE_SCALE, z: MIN_Z };
}

export function scaleForZ(z: number): number {
  return BASE_SCALE * Math.pow(ZOOM_BASE, z);
}

function clampZ(z: number): number {
  return Math.max(MIN_Z, Math.min(MAX_Z, z));
}

/**
 * 倍率段だけを変える。中心は常に自分 (world 原点) — `cx`/`cy` は常に 0 のまま
 * (差し替え可能な「ズーム中心」設定は持たない・確定事項)。
 */
export function zoomBy(camera: CameraState, deltaZ: number): CameraState {
  const nextZ = clampZ(camera.z + deltaZ);
  return { cx: 0, cy: 0, scale: scaleForZ(nextZ), z: nextZ };
}

/** 倍率段を直接指定する (ズームスライダー用)。中心は常に自分。 */
export function zoomTo(camera: CameraState, z: number): CameraState {
  const nextZ = clampZ(z);
  return { cx: 0, cy: 0, scale: scaleForZ(nextZ), z: nextZ };
}

/**
 * カメラのなめらかな追従 (EMA)。滑らかさ最優先の要件により、倍率は毎フレーム
 * 目標値へこの割合ずつ寄せる。`prefers-reduced-motion` のときは呼び出し側が
 * そもそもこれを使わず、目標値をそのまま採用する。位置は常に 0,0 なので
 * 補間は倍率 (`scale`) のみが実質的な効果を持つ。
 */
export function easeCamera(current: CameraState, target: CameraState, alpha = 0.18): CameraState {
  return {
    cx: 0,
    cy: 0,
    scale: current.scale + (target.scale - current.scale) * alpha,
    z: target.z,
  };
}

/** world 座標 → screen 座標。自分 (0,0) は常に画面中心に写る。 */
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
