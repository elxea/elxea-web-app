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
  /**
   * world 座標系での中心 = **自分**。
   *
   * 原点 (0,0) ではない — 嗜好空間の写像によっては原点が空間の外にある
   * (`lib/profile/framing.ts` の冒頭参照)。未ログインで自分の粒が描かれない
   * ときはみんなの分布の重心が入る。
   */
  cx: number;
  cy: number;
  /** z=0 (×1) のときの px per world-unit。板の大きさと中身の広がりで決まる。 */
  baseScale: number;
  /** px per world-unit (= `baseScale * 10^z`)。 */
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
