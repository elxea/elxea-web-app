/**
 * 1フレームの描画要素数の予算を、画面 (DOM/Canvas) から独立して機械検査できる
 * ようにする純関数。
 *
 * 実際の間引き (画面外カリング・重なり解消) は
 * `components/viz/profile/renderers/canvas/index.ts` が担うが、あちらは
 * `CanvasRenderingContext2D` に依存するため Vitest の Node 環境では検査できない
 * (Storybook プロジェクト側の視覚回帰が担当)。ここでは「候補が何件あっても
 * 予算を超えて描かない」という**上限の機械化**だけを人数の4点
 * (10 / 100 / 1,000 / 10,000) で固定する (Spec §「テスト計画」3)。
 */

import { PROFILE_FRAME_ELEMENT_BUDGET } from "@/lib/profile/thresholds";

export interface FrameBudgetResult {
  drawn: number;
  culled: number;
}

export function applyFrameBudget(
  candidateCount: number,
  budget: number = PROFILE_FRAME_ELEMENT_BUDGET,
): FrameBudgetResult {
  const drawn = Math.min(candidateCount, budget);
  return { drawn, culled: Math.max(0, candidateCount - drawn) };
}
