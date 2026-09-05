/**
 * カメラ・慣性・ズーム中心・戻る。座標だけ知る純粋な状態機械 (DOM を持たない)。
 *
 * 試作 `roji-r4-zoom-20260904.html` の「入れ子の10の冪」(`SX`/`SY`/`NX`/`NY`) と
 * `zoomAt` (ズーム中心の方針) ・`goHome` の考え方を移植。
 */

import type { CameraState } from "@/components/viz/profile/renderer";

/** z=0 (×1) のときの px / world-unit。 */
const BASE_SCALE = 40;

/** 倍率段は 10 の冪 (Spec の LOD 表と揃える)。0..2 の3段。 */
const MIN_Z = 0;
const MAX_Z = 2;
const ZOOM_BASE = 10;

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
 * 触れた画面座標 (screenX, screenY) を中心に保ったまま倍率を変える
 * (試作 `zoomAt` の方針)。
 */
export function zoomAt(
  camera: CameraState,
  screenX: number,
  screenY: number,
  viewW: number,
  viewH: number,
  deltaZ: number,
): CameraState {
  const worldXBefore = camera.cx + (screenX - viewW / 2) / camera.scale;
  const worldYBefore = camera.cy + (screenY - viewH / 2) / camera.scale;
  const nextZ = clampZ(camera.z + deltaZ);
  const nextScale = scaleForZ(nextZ);
  const cx = worldXBefore - (screenX - viewW / 2) / nextScale;
  const cy = worldYBefore - (screenY - viewH / 2) / nextScale;
  return { cx, cy, scale: nextScale, z: nextZ };
}

/** 「じぶんへ戻る」— 自分 (world 原点) を画面中心に据える。倍率は変えない。 */
export function goHome(camera: CameraState): CameraState {
  return { ...camera, cx: 0, cy: 0 };
}

export function panBy(camera: CameraState, dxScreen: number, dyScreen: number): CameraState {
  return {
    ...camera,
    cx: camera.cx - dxScreen / camera.scale,
    cy: camera.cy - dyScreen / camera.scale,
  };
}

/**
 * カメラのなめらかな追従 (EMA)。滑らかさ最優先の要件により、位置・倍率は
 * 毎フレーム目標値へこの割合ずつ寄せる。`prefers-reduced-motion` のときは
 * 呼び出し側がそもそもこれを使わず、目標値をそのまま採用する。
 */
export function easeCamera(current: CameraState, target: CameraState, alpha = 0.18): CameraState {
  return {
    cx: current.cx + (target.cx - current.cx) * alpha,
    cy: current.cy + (target.cy - current.cy) * alpha,
    scale: current.scale + (target.scale - current.scale) * alpha,
    z: target.z,
  };
}

/** world 座標 → screen 座標。 */
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

export function isAway(camera: CameraState, viewW: number, viewH: number): boolean {
  const { x, y } = worldToScreen(camera, 0, 0, viewW, viewH);
  return x < 0 || y < 0 || x > viewW || y > viewH;
}
