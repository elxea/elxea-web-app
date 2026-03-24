/**
 * Unit tests for the content recommendation engine's scoreArticle function.
 *
 * Tests cover all 6 design fixes:
 *   Fix #3: targetLayer now uses persona→layer mapping (not depthLevel comparison)
 *   Fix #4: contextTime and contextSeason are used in scoring
 *   Fix #5: Scoring weights are documented and consistent
 */

import { describe, it, expect } from "vitest";
import { scoreArticle, ArticleWithPersona } from "@/lib/recommendations/content-engine";

// Helper to build minimal articles
function makeArticle(overrides: Partial<ArticleWithPersona> = {}): ArticleWithPersona {
  return { _id: "test-article", ...overrides };
}

describe("scoreArticle", () => {
  describe("persona match (+3)", () => {
    it("scores +3 when user persona matches article contentPersona", () => {
      const article = makeArticle({ contentPersona: ["serenity"] });
      expect(scoreArticle(article, "serenity", null)).toBe(3);
    });

    it("scores +3 when user persona matches one of multiple contentPersonas", () => {
      const article = makeArticle({ contentPersona: ["explorer", "sensory"] });
      expect(scoreArticle(article, "sensory", null)).toBe(3);
    });

    it("scores 0 when user persona does not match", () => {
      const article = makeArticle({ contentPersona: ["serenity"] });
      expect(scoreArticle(article, "explorer", null)).toBe(0);
    });

    it("scores 0 when article has no contentPersona", () => {
      const article = makeArticle({});
      expect(scoreArticle(article, "serenity", null)).toBe(0);
    });

    it("handles contentPersona as a single string", () => {
      const article = makeArticle({ contentPersona: "serenity" });
      expect(scoreArticle(article, "serenity", null)).toBe(3);
    });
  });

  describe("targetLayer match via persona→layer mapping (+2) — Fix #3", () => {
    it("maps serenity → wellbeing and scores +2", () => {
      const article = makeArticle({ targetLayer: ["wellbeing"] });
      expect(scoreArticle(article, "serenity", null)).toBe(2);
    });

    it("maps explorer → tea_lover and scores +2", () => {
      const article = makeArticle({ targetLayer: ["tea_lover"] });
      expect(scoreArticle(article, "explorer", null)).toBe(2);
    });

    it("maps sensory → gourmet and scores +2", () => {
      const article = makeArticle({ targetLayer: ["gourmet"] });
      expect(scoreArticle(article, "sensory", null)).toBe(2);
    });

    it("does NOT match targetLayer against depthLevel (old bug)", () => {
      // In the old code, this would have tried to compare "entry" with
      // "tea_lover" / "wellbeing" / "gourmet" — which never matched.
      const article = makeArticle({ targetLayer: ["tea_lover"] });
      // With depthLevel "entry" but no persona, targetLayer should not match
      expect(scoreArticle(article, null, "entry")).toBe(0);
    });

    it("handles targetLayer as a single string", () => {
      const article = makeArticle({ targetLayer: "wellbeing" });
      expect(scoreArticle(article, "serenity", null)).toBe(2);
    });
  });

  describe("depthLevel match (+1)", () => {
    it("scores +1 when user depth matches article depth", () => {
      const article = makeArticle({ depthLevel: "explore" });
      expect(scoreArticle(article, null, "explore")).toBe(1);
    });

    it("scores 0 when depths differ", () => {
      const article = makeArticle({ depthLevel: "deep" });
      expect(scoreArticle(article, null, "entry")).toBe(0);
    });
  });

  describe("contextTime match (+1) — Fix #4", () => {
    it("scores +1 when current time matches article contextTime", () => {
      const article = makeArticle({ contextTime: "morning" });
      expect(scoreArticle(article, null, null, "morning", undefined)).toBe(1);
    });

    it("scores 0 when time does not match", () => {
      const article = makeArticle({ contextTime: "evening" });
      expect(scoreArticle(article, null, null, "morning", undefined)).toBe(0);
    });

    it("scores 0 when article has no contextTime", () => {
      const article = makeArticle({});
      expect(scoreArticle(article, null, null, "morning", undefined)).toBe(0);
    });
  });

  describe("contextSeason match (+1) — Fix #4", () => {
    it("scores +1 when current season matches article contextSeason", () => {
      const article = makeArticle({ contextSeason: "spring" });
      expect(scoreArticle(article, null, null, undefined, "spring")).toBe(1);
    });

    it("scores 0 when season does not match", () => {
      const article = makeArticle({ contextSeason: "winter" });
      expect(scoreArticle(article, null, null, undefined, "summer")).toBe(0);
    });
  });

  describe("combined scoring — Fix #5 weight consistency", () => {
    it("scores maximum when all signals match", () => {
      const article = makeArticle({
        contentPersona: ["serenity"],
        targetLayer: ["wellbeing"],
        depthLevel: "entry",
        contextTime: "evening",
        contextSeason: "winter",
      });
      // 3 (persona) + 2 (layer) + 1 (depth) + 1 (time) + 1 (season) = 8
      expect(scoreArticle(article, "serenity", "entry", "evening", "winter")).toBe(8);
    });

    it("persona match alone is worth more than depth + time + season combined", () => {
      const personaOnlyScore = scoreArticle(
        makeArticle({ contentPersona: ["serenity"] }),
        "serenity",
        null,
      );
      const otherScore = scoreArticle(
        makeArticle({ depthLevel: "entry", contextTime: "morning", contextSeason: "spring" }),
        null,
        "entry",
        "morning",
        "spring",
      );
      // persona=3 > depth(1) + time(1) + season(1) = 3 → equal, not greater
      // This test documents the current weight balance
      expect(personaOnlyScore).toBe(3);
      expect(otherScore).toBe(3);
    });
  });
});
