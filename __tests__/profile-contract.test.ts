import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProfileFieldResponseSchema,
  ProfileSelfResponseSchema,
  ProfileWordsResponseSchema,
  type ProfileFacet,
  type TeaCategory,
} from "@/lib/profile/contract";
import { SyntheticSource } from "@/lib/profile/synthetic";
import { LiveSource } from "@/lib/profile/live";
import { mapTeaAxes } from "@/lib/profile/axes";
import {
  buildFieldGrid,
  clampGridToBudget,
  resolveGridDims,
} from "@/lib/profile/field";
import { resolveFieldState, roundCohort } from "@/lib/profile/thresholds";

const FACETS: readonly ProfileFacet[] = ["tea", "reading", "event"];
const CATEGORIES: readonly TeaCategory[] = ["green", "red", "oolong"];

describe("契約テスト — LiveSource と SyntheticSource は同一スキーマを満たす (parity)", () => {
  const synthetic = new SyntheticSource();
  const live = new LiveSource();

  beforeEach(() => {
    // cx-agent 側の GET /api/profile/* は段1時点で未実装 (D11・PR本文に明記)。
    // 404 を返すふりをして「欠損への倒れ方」を検証する。
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => null }),
    );
  });

  it.each(CATEGORIES)("self(%s) は両ソースともスキーマを満たす", async (category) => {
    const s = await synthetic.getSelf({ facet: "tea", category, userKey: "u1" });
    const l = await live.getSelf({ facet: "tea", category, userKey: "u1" });
    expect(ProfileSelfResponseSchema.safeParse(s).success).toBe(true);
    expect(ProfileSelfResponseSchema.safeParse(l).success).toBe(true);
    expect(s.state).toBe("ready");
    // live は cx-agent 未実装 (404) のため欠損として正しく空へ倒れる。
    expect(l.state).toBe("empty");
    expect(l.centroid).toBeNull();
  });

  it.each(FACETS)("field(%s) は両ソースともスキーマを満たす", async (facet) => {
    const category = facet === "tea" ? "green" : undefined;
    const s = await synthetic.getField({ facet, category, z: 0 });
    const l = await live.getField({ facet, category, z: 0 });
    expect(ProfileFieldResponseSchema.safeParse(s).success).toBe(true);
    expect(ProfileFieldResponseSchema.safeParse(l).success).toBe(true);
    expect(l.state).toBe("quiet");
    expect(l.cohort).toBe(0);
    expect(l.grid).toBeNull();
  });

  it.each(FACETS)("words(%s) は両ソースともスキーマを満たす", async (facet) => {
    const category = facet === "tea" ? "green" : undefined;
    const bbox: [number, number, number, number] = [-1, -1, 1, 1];
    const s = await synthetic.getWords({ facet, category, bbox, userKey: null });
    const l = await live.getWords({ facet, category, bbox, userKey: null });
    expect(ProfileWordsResponseSchema.safeParse(s).success).toBe(true);
    expect(ProfileWordsResponseSchema.safeParse(l).success).toBe(true);
    // 引用許可の仕組みが未実装のため、どちらのソースでも常に空 (D6/QA致命1)。
    expect(s.personal).toEqual([]);
    expect(l.personal).toEqual([]);
  });

  it("お茶の言葉 (facet=tea) は段1の対象外で常に空", async () => {
    const s = await synthetic.getWords({ facet: "tea", category: "green", bbox: [-9, -9, 9, 9], userKey: null });
    expect(s.general).toEqual([]);
    expect(s.shared).toEqual([]);
  });
});

describe("axes — 写像A/B (判断点D3・実測24件で検算済み)", () => {
  it("写像A は横=香りの強さ・縦=味の太さ", () => {
    expect(mapTeaAxes(2, 3, "A")).toEqual({ x: 3, y: 2 });
  });

  it("写像B (既定) は u=香り-味・v=香り+味。24件中3件だけ u<0", () => {
    // Spec 実測表: 紅茶50501(味5,香4) / 緑茶10701(味3,香2) / 緑茶10801(味4,香3) が u<0。
    expect(mapTeaAxes(5, 4, "B").x).toBeLessThan(0);
    expect(mapTeaAxes(3, 2, "B").x).toBeLessThan(0);
    expect(mapTeaAxes(4, 3, "B").x).toBeLessThan(0);
    // 残り21件の代表例は u>=0。
    expect(mapTeaAxes(2, 3, "B").x).toBeGreaterThanOrEqual(0);
    expect(mapTeaAxes(4, 4, "B").x).toBeGreaterThanOrEqual(0);
  });

  it("写像Bは構造的に市松格子になる (v-u は必ず偶数 = 2×味)", () => {
    for (const [flavor, aroma] of [[2, 3], [4, 4], [1, 4], [3, 3]] as const) {
      const { x: u, y: v } = mapTeaAxes(flavor, aroma, "B");
      expect((v - u) % 2).toBe(0);
    }
  });
});

describe("thresholds — 母集団状態のヒステリシス (QA致命2)", () => {
  it("素直な上昇は quiet → sparse → formed", () => {
    expect(resolveFieldState(5, null)).toBe("quiet");
    expect(resolveFieldState(12, "quiet")).toBe("sparse");
    expect(resolveFieldState(55, "sparse")).toBe("formed");
  });

  it("formed からの境界1名の増減で quiet へ戻らない", () => {
    expect(resolveFieldState(48, "formed")).toBe("formed");
    expect(resolveFieldState(44, "formed")).toBe("sparse");
  });

  it("sparse からの境界1名の増減で quiet へ即戻らない", () => {
    expect(resolveFieldState(8, "sparse")).toBe("sparse");
    expect(resolveFieldState(6, "sparse")).toBe("quiet");
  });

  it("roundCohort は閾値未満を常に0にする (実数を返さない)", () => {
    expect(roundCohort(9)).toBe(0);
    expect(roundCohort(23)).toBe(20);
    expect(roundCohort(10)).toBe(10);
  });
});

describe("field — LOD 表 (QA致命3・重大7) とセル数予算", () => {
  it("quiet は格子を持たない", () => {
    expect(resolveGridDims("quiet", "macro")).toBeNull();
  });

  it("sparse/macro は 16×12、formed/micro は 96×64 (上限)", () => {
    expect(resolveGridDims("sparse", "macro")).toEqual({ w: 16, h: 12 });
    expect(resolveGridDims("formed", "micro")).toEqual({ w: 96, h: 64 });
  });

  it.each([10, 100, 1_000, 10_000])("セル数は人数 %i でも上限8000を超えない", (cohort) => {
    const dims = clampGridToBudget({ w: 96, h: 64 }, cohort);
    expect(dims.w * dims.h).toBeLessThanOrEqual(8_000);
  });

  it("buildFieldGrid は formed 帯の点群から非nullの格子を作る", () => {
    const points = Array.from({ length: 60 }, (_, i) => ({
      x: (i % 10) - 5,
      y: Math.floor(i / 10) - 3,
      w: 1,
    }));
    const result = buildFieldGrid({ points, rawCohort: 60, prevState: null, z: 0, bbox: [-9, -9, 9, 9] });
    expect(result.state).toBe("formed");
    expect(result.grid).not.toBeNull();
    expect(result.cohort).toBe(60);
  });
});
