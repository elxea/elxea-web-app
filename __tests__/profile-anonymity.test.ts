import { beforeEach, describe, expect, it, vi } from "vitest";

import { getProfileSource, ProfileSourceConfigError } from "@/lib/profile/source";
import { SyntheticSource } from "@/lib/profile/synthetic";
import { resolveProfileCacheControl } from "@/lib/profile/cache-policy";
import { buildPersonalWords } from "@/lib/profile/words";
import { resolveFieldState, roundCohort } from "@/lib/profile/thresholds";
import { buildFieldGrid, type WeightedPoint } from "@/lib/profile/field";

/**
 * 匿名性テスト (Spec §「テスト計画」2)。
 *
 * (a) field/words の応答を実際の JSON として再帰走査し、識別子が1つも
 *     現れないことを assert (型ではなく値そのものを見る)。
 * (b) 母集団が最小人数未満のとき grid:null かつ cohort:0。
 * (c) personal に引用許可がfalseの記録が1件も混ざらない。
 * (d) 生成データが production で throw する。
 * (e) 前日版との差分で単一座標が復元できない (差分攻撃対策・QA 2周目致命・Spec追記3)。
 * (f) synthetic・非本番応答の Cache-Control が常に private, no-store。
 */

const FORBIDDEN_KEY = /subject_?id|user_?key|shopify_?id|customer_?id|line_?user_?id/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

function walkJson(value: unknown, onNode: (key: string | null, v: unknown) => void, key: string | null = null): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const v of value) walkJson(v, onNode, key);
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      onNode(k, v);
      walkJson(v, onNode, k);
    }
    return;
  }
  onNode(key, value);
}

describe("匿名性 (a) — field/words 応答の実JSONを再帰走査しても識別子が現れない", () => {
  const synthetic = new SyntheticSource();

  it("field 応答", async () => {
    const res = await synthetic.getField({ facet: "tea", category: "green", z: 2 });
    const asJson = JSON.parse(JSON.stringify(res));
    walkJson(asJson, (key, v) => {
      if (key) expect(FORBIDDEN_KEY.test(key)).toBe(false);
      if (typeof v === "string") expect(EMAIL_RE.test(v)).toBe(false);
    });
  });

  it("words 応答 (userKey に渡した値がどこにも漏れない)", async () => {
    const res = await synthetic.getWords({
      facet: "reading",
      bbox: [-1, -1, 1, 1],
      userKey: "leak-marker-should-not-appear",
    });
    const asJson = JSON.parse(JSON.stringify(res));
    walkJson(asJson, (key, v) => {
      if (key) expect(FORBIDDEN_KEY.test(key)).toBe(false);
      if (typeof v === "string") expect(v).not.toContain("leak-marker-should-not-appear");
    });
  });
});

describe("匿名性 (b) — 最小人数未満は grid:null かつ cohort:0", () => {
  it("実人数3名は quiet かつ丸め後cohortは0", () => {
    expect(resolveFieldState(3, null)).toBe("quiet");
    expect(roundCohort(3)).toBe(0);
  });
});

describe("匿名性 (c) — personal に引用許可falseの記録が1件も混ざらない", () => {
  it("引用許可の仕組みが未実装のため常に空配列 (欠損ではなく正しい振る舞い)", () => {
    expect(buildPersonalWords()).toEqual([]);
  });
});

describe("匿名性 (d) — 生成データは production で throw する (fail-closed)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("VERCEL_ENV=production かつ PROFILE_DATA_SOURCE=synthetic は例外", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PROFILE_DATA_SOURCE", "synthetic");
    await expect(getProfileSource()).rejects.toBeInstanceOf(ProfileSourceConfigError);
  });

  it("非本番なら synthetic を選べる", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PROFILE_DATA_SOURCE", "synthetic");
    const source = await getProfileSource();
    expect(source.kind).toBe("synthetic");
  });

  it("PROFILE_DATA_SOURCE 未設定 (既定 live) は production でも例外にならない", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PROFILE_DATA_SOURCE", "");
    const source = await getProfileSource();
    expect(source.kind).toBe("live");
  });
});

describe("匿名性 (e) — 前日版との差分で単一座標が復元できない (差分攻撃対策)", () => {
  const bbox: [number, number, number, number] = [-9, -9, 9, 9];

  function basePoints(): WeightedPoint[] {
    return Array.from({ length: 60 }, (_, i) => ({ x: (i % 10) - 5, y: Math.floor(i / 10) - 3, w: 1 }));
  }

  it("新規参加が k=10 未満なら grid・levels・cohort・version が完全に据え置きになる", () => {
    const day1Points = basePoints();
    const day1 = buildFieldGrid({ points: day1Points, rawCohort: day1Points.length, prevState: null, z: 1, bbox });
    expect(day1.grid).not.toBeNull();

    // 攻撃者が狙う典型ケース: 前版から1人だけ増える。
    const day2Points = [...day1Points, { x: 4.2, y: 2.7, w: 1 }];
    const day2 = buildFieldGrid({
      points: day2Points,
      rawCohort: day2Points.length,
      prevState: day1.state,
      z: 1,
      bbox,
      previousPublish: day1.publish,
    });

    // 版が同じ = 中身も完全に同一。差分を取っても新規参加者の座標は一切出ない。
    expect(day2.version).toBe(day1.version);
    expect(day2.grid).toEqual(day1.grid);
    expect(day2.levels).toEqual(day1.levels);
    expect(day2.cohort).toBe(day1.cohort);
  });

  it("新規参加が k=10 以上なら再公開され、版番号が上がる", () => {
    const day1Points = basePoints();
    const day1 = buildFieldGrid({ points: day1Points, rawCohort: day1Points.length, prevState: null, z: 1, bbox });

    const grownPoints = [
      ...day1Points,
      ...Array.from({ length: 10 }, (_, i) => ({ x: i * 0.3 - 1, y: 3, w: 1 })),
    ];
    const day2 = buildFieldGrid({
      points: grownPoints,
      rawCohort: grownPoints.length,
      prevState: day1.state,
      z: 1,
      bbox,
      previousPublish: day1.publish,
    });

    expect(day2.version).toBe(day1.version + 1);
  });

  it("1人ずつ9回増やし続けても版が上がらない (サラミ攻撃対策・基準点は据え置きのまま動かない)", () => {
    let points = basePoints();
    let result = buildFieldGrid({ points, rawCohort: points.length, prevState: null, z: 1, bbox });
    const firstVersion = result.version;
    const firstGrid = result.grid;

    for (let i = 0; i < 9; i++) {
      points = [...points, { x: (i - 4) * 0.1, y: 0.05 * i, w: 1 }];
      result = buildFieldGrid({
        points,
        rawCohort: points.length,
        prevState: result.state,
        z: 1,
        bbox,
        previousPublish: result.publish,
      });
      expect(result.version).toBe(firstVersion);
      expect(result.grid).toEqual(firstGrid);
    }

    // 10人目でようやく上がる (合計+9のあとの+1で閾値10に到達)。
    points = [...points, { x: 0, y: 0, w: 1 }];
    result = buildFieldGrid({
      points,
      rawCohort: points.length,
      prevState: result.state,
      z: 1,
      bbox,
      previousPublish: result.publish,
    });
    expect(result.version).toBe(firstVersion + 1);
  });
});

describe("匿名性 (f) — Cache-Control は synthetic・非本番で常に private, no-store", () => {
  it.each([
    ["synthetic", "production"] as const,
    ["synthetic", undefined] as const,
    ["live", undefined] as const,
    ["live", "preview"] as const,
  ])("(%s, %s) => private, no-store", (kind, vercelEnv) => {
    expect(resolveProfileCacheControl(kind, vercelEnv)).toBe("private, no-store");
  });

  it("live かつ production だけが public (キャッシュ隔離)", () => {
    expect(resolveProfileCacheControl("live", "production")).toContain("public");
  });
});
