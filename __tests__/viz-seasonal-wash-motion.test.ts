import { describe, expect, it } from "vitest";

import {
  MAX_TEMPO,
  MIN_TEMPO,
  REDUCED_MOTION_QUERY,
  TARGET_FPS,
  clampTempo,
  prefersReducedMotion,
  resolveMotion,
} from "@/lib/viz/seasonal-wash-motion";

/** `window` の最小の偽物。matchMedia の戻り値と、渡されたクエリを記録する。 */
function hostWith(matches: boolean) {
  const queries: string[] = [];
  return {
    queries,
    host: {
      matchMedia: (query: string) => {
        queries.push(query);
        return { matches };
      },
    },
  };
}

describe("prefersReducedMotion", () => {
  it("asks for the standard reduced-motion query", () => {
    const { host, queries } = hostWith(true);
    expect(prefersReducedMotion(host)).toBe(true);
    expect(queries).toEqual([REDUCED_MOTION_QUERY]);
  });

  it("is false when the user has no preference", () => {
    expect(prefersReducedMotion(hostWith(false).host)).toBe(false);
  });

  it("is false on the server (no window at all)", () => {
    expect(prefersReducedMotion(undefined)).toBe(false);
    expect(prefersReducedMotion(null)).toBe(false);
  });

  it("is false when matchMedia is missing", () => {
    expect(prefersReducedMotion({})).toBe(false);
  });

  it("is false when matchMedia returns null", () => {
    expect(prefersReducedMotion({ matchMedia: () => null })).toBe(false);
  });

  it("falls back to animating when matchMedia throws", () => {
    expect(
      prefersReducedMotion({
        matchMedia: () => {
          throw new Error("unsupported query");
        },
      }),
    ).toBe(false);
  });
});

describe("clampTempo", () => {
  it.each([
    [1, 1],
    [0.1, MIN_TEMPO],
    [9, MAX_TEMPO],
    [MIN_TEMPO, MIN_TEMPO],
    [MAX_TEMPO, MAX_TEMPO],
  ])("clamps %s to %s", (input, expected) => {
    expect(clampTempo(input)).toBe(expected);
  });

  it("falls back to 1 for values that are not finite numbers", () => {
    expect(clampTempo(Number.NaN)).toBe(1);
    expect(clampTempo(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("resolveMotion", () => {
  it("does not animate when the user asked for reduced motion", () => {
    const plan = resolveMotion({ tempo: 1.5, reducedMotion: true });
    expect(plan.animate).toBe(false);
    // 止めるだけで、時間の倍率そのものは保つ (静止フレームの内容は tempo に依らない)。
    expect(plan.timeScale).toBe(1.5);
  });

  it("animates at the target frame rate otherwise", () => {
    const plan = resolveMotion({ tempo: 1, reducedMotion: false });
    expect(plan.animate).toBe(true);
    expect(plan.frameIntervalMs).toBeCloseTo(1000 / TARGET_FPS, 6);
  });

  it("clamps the tempo it was given", () => {
    expect(resolveMotion({ tempo: 12, reducedMotion: false }).timeScale).toBe(
      MAX_TEMPO,
    );
    expect(resolveMotion({ tempo: 0, reducedMotion: false }).timeScale).toBe(
      MIN_TEMPO,
    );
  });

  it("defaults the tempo to 1 when omitted", () => {
    expect(resolveMotion({ reducedMotion: false }).timeScale).toBe(1);
  });

  it("targets 30fps, not 60 (slow is the point)", () => {
    expect(TARGET_FPS).toBe(30);
  });
});
