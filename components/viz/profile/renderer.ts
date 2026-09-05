/**
 * 描画の差し替え境界。
 *
 * `ProfileScene` は「何を描くか」だけを持ち、色も形も持たない。色・形は
 * Renderer 側の裁量。これにより Figma が表現を変えても契約と場の計算は
 * 不変のまま (Spec §「描画アーキテクチャ」)。
 */

import type { ProfileFieldResponse, ProfileSelfResponse, ProfileWordsResponse } from "@/lib/profile/contract";

export interface ProfileScene {
  self: ProfileSelfResponse | null;
  field: ProfileFieldResponse | null;
  words: ProfileWordsResponse | null;
}

export interface CameraState {
  /** world 座標系での中心。 */
  cx: number;
  cy: number;
  /** px per world-unit。 */
  scale: number;
  /** 倍率段 (10 の冪。0 = ×1)。 */
  z: number;
}

/**
 * 1フレームに描いた要素数・間引いた数・画面外に落ちた数。性能予算の測定点。
 */
export interface DrawStats {
  drawn: number;
  culled: number;
  offscreen: number;
}

export interface ProfileRenderer {
  mount(host: HTMLElement, opts: { reducedMotion: boolean }): void;
  resize(w: number, h: number, dpr: number): void;
  draw(scene: ProfileScene, camera: CameraState): DrawStats;
  destroy(): void;
}
