/**
 * Unit tests for Content Recommendation Engine
 *
 * Tests the pure scoring logic (scoreArticle) without Firestore dependencies.
 * The Firestore-dependent functions (getRecommendedArticles) are tested
 * via integration tests with mocked Firestore.
 */

import { describe, it, expect } from "vitest";
import {
  scoreArticle,
  getStrategyCell,
  CONTENT_STRATEGY_MATRIX,
  SCORE_PERSONA_MATCH,
  SCORE_DEPTH_MATCH,
  SCORE_STRATEGY_BONUS,
  type ArticleWithPersona,
} from "../content-engine";

// ---------------------------------------------------------------------------
// Helper: create a minimal article for testing
// ---------------------------------------------------------------------------

function makeArticle(overrides: Partial<ArticleWithPersona> = {}): ArticleWithPersona {
  return {
    _id: "test-article-1",
    contentPersona: null,
    depthLevel: null,
    targetLayer: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// scoreArticle — persona matching
// ---------------------------------------------------------------------------

describe("scoreArticle: persona matching", () => {
  it("returns 0 when user has no persona", () => {
    const article = makeArticle({ contentPersona: ["serenity"] });
    expect(scoreArticle(article, null, null)).toBe(0);
  });

  it("returns 0 when article has no contentPersona", () => {
    const article = makeArticle({ contentPersona: null });
    expect(scoreArticle(article, "serenity", null)).toBe(0);
  });

  it("returns SCORE_PERSONA_MATCH when persona matches (string)", () => {
    const article = makeArticle({ contentPersona: "serenity" });
    expect(scoreArticle(article, "serenity", null)).toBe(SCORE_PERSONA_MATCH);
  });

  it("returns SCORE_PERSONA_MATCH when persona matches (array)", () => {
    const article = makeArticle({ contentPersona: ["explorer", "sensory"] });
    expect(scoreArticle(article, "explorer", null)).toBe(SCORE_PERSONA_MATCH);
  });

  it("returns 0 when persona does not match", () => {
    const article = makeArticle({ contentPersona: ["serenity"] });
    expect(scoreArticle(article, "explorer", null)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreArticle — depth matching
// ---------------------------------------------------------------------------

describe("scoreArticle: depth matching", () => {
  it("returns SCORE_DEPTH_MATCH when depthLevel matches", () => {
    const article = makeArticle({ depthLevel: "entry" });
    expect(scoreArticle(article, null, "entry")).toBe(SCORE_DEPTH_MATCH);
  });

  it("returns 0 when depthLevel does not match", () => {
    const article = makeArticle({ depthLevel: "deep" });
    expect(scoreArticle(article, null, "entry")).toBe(0);
  });

  it("returns 0 when article has no depthLevel", () => {
    const article = makeArticle({ depthLevel: null });
    expect(scoreArticle(article, null, "entry")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreArticle — combined scoring
// ---------------------------------------------------------------------------

describe("scoreArticle: combined scoring", () => {
  it("adds persona + depth scores together", () => {
    const article = makeArticle({
      contentPersona: ["serenity"],
      depthLevel: "entry",
    });
    expect(scoreArticle(article, "serenity", "entry")).toBe(
      SCORE_PERSONA_MATCH + SCORE_DEPTH_MATCH + SCORE_STRATEGY_BONUS
    );
  });

  it("gives strategy bonus when persona AND depth both match", () => {
    const article = makeArticle({
      contentPersona: ["explorer"],
      depthLevel: "deep",
    });
    const score = scoreArticle(article, "explorer", "deep");
    // persona(3) + depth(2) + strategy(1) = 6
    expect(score).toBe(SCORE_PERSONA_MATCH + SCORE_DEPTH_MATCH + SCORE_STRATEGY_BONUS);
  });

  it("does NOT give strategy bonus when only persona matches", () => {
    const article = makeArticle({
      contentPersona: ["explorer"],
      depthLevel: "entry",
    });
    const score = scoreArticle(article, "explorer", "deep");
    // persona(3) only, depth doesn't match, no strategy bonus
    expect(score).toBe(SCORE_PERSONA_MATCH);
  });

  it("does NOT give strategy bonus when only depth matches", () => {
    const article = makeArticle({
      contentPersona: ["serenity"],
      depthLevel: "entry",
    });
    const score = scoreArticle(article, "explorer", "entry");
    // depth(2) only, persona doesn't match
    expect(score).toBe(SCORE_DEPTH_MATCH);
  });
});

// ---------------------------------------------------------------------------
// scoreArticle — targetLayer bug fix (P3)
// ---------------------------------------------------------------------------

describe("scoreArticle: targetLayer bug fix (P3)", () => {
  it("does NOT use targetLayer for scoring (old bug: compared tea_lover vs entry)", () => {
    const article = makeArticle({
      targetLayer: ["tea_lover"],
      depthLevel: null,
      contentPersona: null,
    });
    // targetLayer should not contribute to the score
    expect(scoreArticle(article, "serenity", "entry")).toBe(0);
  });

  it("ignores targetLayer even when it matches depthLevel string (was the bug)", () => {
    // This was the exact bug: targetLayer="entry" would have matched depthLevel="entry"
    // but targetLayer values are supposed to be tea_lover/wellbeing/gourmet
    const article = makeArticle({
      targetLayer: "entry" as string,
      depthLevel: null,
      contentPersona: null,
    });
    expect(scoreArticle(article, null, "entry")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Content Strategy Matrix
// ---------------------------------------------------------------------------

describe("Content Strategy Matrix", () => {
  it("has exactly 9 cells (3 personas x 3 depths)", () => {
    expect(CONTENT_STRATEGY_MATRIX).toHaveLength(9);
  });

  it("covers all persona x depth combinations", () => {
    const personas = ["serenity", "explorer", "sensory"] as const;
    const depths = ["entry", "explore", "deep"] as const;

    for (const persona of personas) {
      for (const depth of depths) {
        const cell = getStrategyCell(persona, depth);
        expect(cell).toBeDefined();
        expect(cell!.persona).toBe(persona);
        expect(cell!.depth).toBe(depth);
        expect(cell!.themes.length).toBeGreaterThan(0);
        expect(cell!.description).toBeTruthy();
      }
    }
  });

  it("returns undefined for invalid persona/depth", () => {
    expect(getStrategyCell("invalid" as any, "entry")).toBeUndefined();
    expect(getStrategyCell("serenity", "invalid" as any)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scoring edge cases
// ---------------------------------------------------------------------------

describe("scoreArticle: edge cases", () => {
  it("handles empty article (all null fields)", () => {
    const article = makeArticle();
    expect(scoreArticle(article, "serenity", "entry")).toBe(0);
  });

  it("handles article with empty contentPersona array", () => {
    const article = makeArticle({ contentPersona: [], depthLevel: "entry" });
    expect(scoreArticle(article, "serenity", "entry")).toBe(SCORE_DEPTH_MATCH);
  });

  it("handles both user values as null", () => {
    const article = makeArticle({
      contentPersona: ["serenity"],
      depthLevel: "entry",
    });
    expect(scoreArticle(article, null, null)).toBe(0);
  });
});
