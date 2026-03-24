/**
 * Unit tests for the content recommendation engine's scoreArticle function.
 *
 * Tests cover the simplified scoring model after Phase 1 cleanup:
 *   - contentPersona matching (+3)
 *   - depthLevel matching (+2)
 *   - Content strategy matrix bonus (+1)
 *   - targetLayer is deprecated (not used in scoring)
 *   - contextTime and contextSeason removed (Phase 1 simplification per P4)
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

  describe("depthLevel match (+2)", () => {
    it("scores +2 when user depth matches article depthLevel", () => {
      const article = makeArticle({ depthLevel: "explore" });
      expect(scoreArticle(article, null, "explore")).toBe(2);
    });

    it("scores 0 when depths differ", () => {
      const article = makeArticle({ depthLevel: "deep" });
      expect(scoreArticle(article, null, "entry")).toBe(0);
    });

    it("scores 0 when article has no depthLevel", () => {
      const article = makeArticle({});
      expect(scoreArticle(article, null, "entry")).toBe(0);
    });
  });

  describe("targetLayer is deprecated and not used in scoring", () => {
    it("targetLayer alone does not add to score", () => {
      const article = makeArticle({ targetLayer: ["wellbeing"] });
      expect(scoreArticle(article, "serenity", null)).toBe(0);
    });

    it("targetLayer does not interact with depthLevel", () => {
      const article = makeArticle({ targetLayer: ["tea_lover"], depthLevel: "explore" });
      // Only depthLevel contributes (+2), not targetLayer
      expect(scoreArticle(article, null, "explore")).toBe(2);
    });
  });

  describe("combined scoring — weight consistency", () => {
    it("persona + depth + strategy bonus scores 6 (3 + 2 + 1)", () => {
      // When both persona and depth match, strategy bonus is automatically applied
      // 3 (persona) + 2 (depth) + 1 (strategy bonus) = 6
      const article = makeArticle({
        contentPersona: ["serenity"],
        depthLevel: "entry",
      });
      expect(scoreArticle(article, "serenity", "entry")).toBe(6);
    });

    it("persona match alone is worth more than depth alone", () => {
      const personaOnly = scoreArticle(
        makeArticle({ contentPersona: ["serenity"] }),
        "serenity",
        null,
      );
      const depthOnly = scoreArticle(
        makeArticle({ depthLevel: "entry" }),
        null,
        "entry",
      );
      // persona=3 > depth=2
      expect(personaOnly).toBeGreaterThan(depthOnly);
    });

    it("no user signals scores 0", () => {
      const article = makeArticle({
        contentPersona: ["serenity"],
        depthLevel: "entry",
      });
      expect(scoreArticle(article, null, null)).toBe(0);
    });
  });
});
