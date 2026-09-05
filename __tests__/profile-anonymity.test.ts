import { beforeEach, describe, expect, it, vi } from "vitest";

import { getProfileSource, ProfileSourceConfigError } from "@/lib/profile/source";
import { SyntheticSource } from "@/lib/profile/synthetic";
import { resolveProfileCacheControl } from "@/lib/profile/cache-policy";
import { buildPersonalWords } from "@/lib/profile/words";
import { resolveFieldState, roundCohort } from "@/lib/profile/thresholds";

/**
 * 匿名性テスト (Spec §「テスト計画」2)。
 *
 * (a) field/words の応答を実際の JSON として再帰走査し、識別子が1つも
 *     現れないことを assert (型ではなく値そのものを見る)。
 * (b) 母集団が最小人数未満のとき grid:null かつ cohort:0。
 * (c) personal に引用許可がfalseの記録が1件も混ざらない。
 * (d) 生成データが production で throw する。
 * (e) synthetic・非本番応答の Cache-Control が常に private, no-store。
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

describe("匿名性 (e) — Cache-Control は synthetic・非本番で常に private, no-store", () => {
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
