import { describe, expect, it } from "vitest";

import { applyFrameBudget } from "@/lib/profile/frame-budget";
import { clampGridToBudget, resolveGridDims } from "@/lib/profile/field";
import { makeSyntheticTeaPeople } from "@/lib/profile/synthetic/generators";
import {
  PROFILE_FRAME_ELEMENT_BUDGET,
  PROFILE_GRID_CELL_BUDGET,
} from "@/lib/profile/thresholds";

/**
 * 性能予算テスト (Spec §「テスト計画」3)。
 *
 * 「視野の間引き後の描画要素数 ≤ 1,500」「格子セル数 ≤ 8,000」を人数
 * 10 / 100 / 1,000 / 10,000 の4点で assert する。実機 fps は対象外
 * (Playwright 初回描画計測・SP 実機 fps は本 PR の範囲外。PR 本文「未実施」参照)。
 */

const POPULATION_POINTS = [10, 100, 1_000, 10_000] as const;

describe("性能予算 — 描画要素数は人数によらず上限を超えない", () => {
  it.each(POPULATION_POINTS)("%i 人でも drawn <= 1,500", (n) => {
    const { drawn, culled } = applyFrameBudget(n);
    expect(drawn).toBeLessThanOrEqual(PROFILE_FRAME_ELEMENT_BUDGET);
    expect(drawn + culled).toBe(n);
  });
});

describe("性能予算 — 格子セル数は人数によらず上限を超えない (LOD 表準拠)", () => {
  it.each(POPULATION_POINTS)("%i 人 × formed/micro (96×64上限) でもセル数 <= 8,000", (n) => {
    const raw = resolveGridDims("formed", "micro");
    expect(raw).not.toBeNull();
    const dims = clampGridToBudget(raw!, n);
    expect(dims.w * dims.h).toBeLessThanOrEqual(PROFILE_GRID_CELL_BUDGET);
  });

  it.each(POPULATION_POINTS)("%i 人 × sparse/macro でもセル数 <= 8,000", (n) => {
    const raw = resolveGridDims("sparse", "macro");
    expect(raw).not.toBeNull();
    const dims = clampGridToBudget(raw!, n);
    expect(dims.w * dims.h).toBeLessThanOrEqual(PROFILE_GRID_CELL_BUDGET);
  });
});

describe("性能予算 — 生成データの人数を増やしても合成コストが破綻しない", () => {
  it.each([10, 100, 1_000] as const)("makeSyntheticTeaPeople(green, %i) は要求件数以下を返す", (n) => {
    const people = makeSyntheticTeaPeople("green", n);
    expect(people.length).toBeLessThanOrEqual(n);
    for (const p of people) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});
