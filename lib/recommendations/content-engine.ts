/**
 * Content Recommendation Engine
 *
 * Scores and re-orders Sanity articles based on the user's Firestore persona
 * and behavioral history. Persona data is computed by elxea-cx-agent
 * (Single Source of Truth) and stored in Firestore.
 *
 * Scoring axes (2-axis model: persona x depth):
 *   +3 — persona x contentPersona match (primary signal)
 *   +2 — depthLevel of article matches user's depth level
 *   +1 — content strategy bonus (persona x depth matrix alignment)
 *
 * Removed in this revision:
 *   - targetLayer comparison (was buggy: compared tea_lover/wellbeing/gourmet
 *     against entry/explore/deep — type mismatch, never matched)
 *   - contextTime / contextSeason (premature — insufficient content volume)
 *
 * Fallback: returns the original order (publishedAt desc) for unauthenticated users
 * or when Firestore data is unavailable.
 *
 * Usage (Server Component only — requires Firebase Admin SDK):
 *   import { getRecommendedArticles } from "@/lib/recommendations/content-engine";
 *   const articles = await getRecommendedArticles({ customerId, rawArticles });
 */

import type { PersonaType, DepthLevel, UserProfile } from "@/lib/firebase/types";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { userDoc, behaviorLogCol } from "@/lib/firebase/collections";

// --------------------------------------------------------------------------
// Article type (Sanity response subset used for scoring)
// --------------------------------------------------------------------------

export type ArticleWithPersona = {
  _id: string;
  contentPersona?: string | string[] | null;
  depthLevel?: string | null;
  /** @deprecated targetLayer is retained for backward compat but not used in scoring */
  targetLayer?: string | string[] | null;
  [key: string]: unknown;
};

export type ScoredArticle<T extends ArticleWithPersona = ArticleWithPersona> =
  T & { _recommendScore: number };

// --------------------------------------------------------------------------
// Scoring constants
// --------------------------------------------------------------------------

/** persona x contentPersona match */
export const SCORE_PERSONA_MATCH = 3;
/** depthLevel match */
export const SCORE_DEPTH_MATCH = 2;
/** Content strategy matrix bonus */
export const SCORE_STRATEGY_BONUS = 1;
/** Penalty for already-read articles */
export const SCORE_READ_PENALTY = -1;

// --------------------------------------------------------------------------
// Content Strategy Matrix (persona x depth = 9 cells)
//
// Defines the content themes that resonate with each persona at each depth.
// Used for strategy-level bonus scoring and as a reference for editorial.
// --------------------------------------------------------------------------

export type ContentStrategyCell = {
  persona: PersonaType;
  depth: DepthLevel;
  /** Content themes / keywords that signal a good match for this cell */
  themes: string[];
  /** Human-readable description for editorial reference */
  description: string;
};

export const CONTENT_STRATEGY_MATRIX: ContentStrategyCell[] = [
  // Serenity
  {
    persona: "serenity",
    depth: "entry",
    themes: ["hojicha", "herbal", "relax", "evening", "beginner"],
    description: "Introductory calming content: hojicha, herbal tea, relaxation rituals",
  },
  {
    persona: "serenity",
    depth: "explore",
    themes: ["origin-story", "single-origin", "ritual", "meditation"],
    description: "Origin stories with calming narratives, single-origin discoveries",
  },
  {
    persona: "serenity",
    depth: "deep",
    themes: ["farm-visit", "tea-master", "interview", "limited-edition"],
    description: "Farm visits, tea master interviews, limited edition deep-dives",
  },
  // Explorer
  {
    persona: "explorer",
    depth: "entry",
    themes: ["tea-types", "guide", "introduction", "variety"],
    description: "Tea variety encyclopedia, brewing method introductions",
  },
  {
    persona: "explorer",
    depth: "explore",
    themes: ["comparison", "processing", "region", "terroir"],
    description: "Origin comparisons, processing method details, regional guides",
  },
  {
    persona: "explorer",
    depth: "deep",
    themes: ["rare-cultivar", "terroir", "seasonal", "research"],
    description: "Rare cultivars, terroir deep-dives, seasonal limited editions",
  },
  // Sensory
  {
    persona: "sensory",
    depth: "entry",
    themes: ["flavor-guide", "pairing", "taste", "beginner"],
    description: "Flavor guides, food pairing introductions, tasting basics",
  },
  {
    persona: "sensory",
    depth: "explore",
    themes: ["flavor-note", "brewing-comparison", "temperature", "extraction"],
    description: "Flavor note analysis, brewing parameter comparisons",
  },
  {
    persona: "sensory",
    depth: "deep",
    themes: ["tasting-note", "blend-proposal", "expert", "cupping"],
    description: "Professional tasting notes, blend proposals, cupping sessions",
  },
];

/**
 * Look up the content strategy cell for a given persona + depth combination.
 */
export function getStrategyCell(
  persona: PersonaType,
  depth: DepthLevel
): ContentStrategyCell | undefined {
  return CONTENT_STRATEGY_MATRIX.find(
    (cell) => cell.persona === persona && cell.depth === depth
  );
}

// --------------------------------------------------------------------------
// Main scoring function
// --------------------------------------------------------------------------

/**
 * Score a single article against the user's persona and depth level.
 *
 * Fixed bug (P3): targetLayer was previously compared against depthLevel,
 * but targetLayer values (tea_lover/wellbeing/gourmet) and depthLevel values
 * (entry/explore/deep) are different types and never matched. Now we use
 * only contentPersona for persona matching and depthLevel for depth matching.
 */
export function scoreArticle(
  article: ArticleWithPersona,
  userPersona: string | null,
  userDepth: string | null
): number {
  let score = 0;

  // (1) persona x contentPersona match -> +3
  if (userPersona && article.contentPersona) {
    const personas = Array.isArray(article.contentPersona)
      ? article.contentPersona
      : [article.contentPersona];
    if (personas.includes(userPersona)) {
      score += SCORE_PERSONA_MATCH;
    }
  }

  // (2) depthLevel match -> +2
  if (userDepth && article.depthLevel) {
    if (article.depthLevel === userDepth) {
      score += SCORE_DEPTH_MATCH;
    }
  }

  // (3) Content strategy bonus -> +1
  // When both persona and depth match AND the article's contentPersona aligns
  // with the strategy matrix, give a bonus for being in the "sweet spot"
  if (
    userPersona &&
    userDepth &&
    article.contentPersona &&
    article.depthLevel
  ) {
    const validPersonas: PersonaType[] = ["serenity", "explorer", "sensory"];
    const validDepths: DepthLevel[] = ["entry", "explore", "deep"];

    if (
      validPersonas.includes(userPersona as PersonaType) &&
      validDepths.includes(userDepth as DepthLevel)
    ) {
      const cell = getStrategyCell(
        userPersona as PersonaType,
        userDepth as DepthLevel
      );
      if (cell) {
        const articlePersonas = Array.isArray(article.contentPersona)
          ? article.contentPersona
          : [article.contentPersona];
        // Bonus if article persona matches AND article depth matches user depth
        if (
          articlePersonas.includes(userPersona) &&
          article.depthLevel === userDepth
        ) {
          score += SCORE_STRATEGY_BONUS;
        }
      }
    }
  }

  return score;
}

// --------------------------------------------------------------------------
// Firestore helpers
// --------------------------------------------------------------------------

/**
 * Retrieve the user's persona and depth level from Firestore.
 * These values are computed by elxea-cx-agent's preference-pipeline
 * and stored in users/{shopifyCustomerId}.
 *
 * Returns null values when the document doesn't exist or fields are missing.
 */
async function getUserPersonaData(
  customerId: string
): Promise<{ persona: string | null; depthLevel: string | null }> {
  try {
    const db = getAdminFirestore();
    const docRef = db.doc(userDoc(customerId));
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      return { persona: null, depthLevel: null };
    }

    const data = snapshot.data() as UserProfile;
    return {
      persona: data.persona?.primary ?? null,
      depthLevel: data.depthLevel ?? null,
    };
  } catch {
    return { persona: null, depthLevel: null };
  }
}

/**
 * Retrieve the set of article slugs that the user has already read
 * (view_content events in the behaviorLog subcollection).
 */
async function getReadArticleSlugs(customerId: string): Promise<Set<string>> {
  try {
    const db = getAdminFirestore();
    const snapshot = await db
      .collection(behaviorLogCol(customerId))
      .where("action", "==", "view_content")
      .get();

    const slugs = new Set<string>();
    for (const doc of snapshot.docs) {
      const contentId = doc.data().metadata?.contentId;
      if (contentId) slugs.add(contentId);
    }
    return slugs;
  } catch {
    return new Set();
  }
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

type RecommendOptions = {
  /** Shopify numeric customer ID. If null, returns original order. */
  customerId: string | null;
  /** Articles fetched from Sanity (already filtered by locale/category). */
  rawArticles: ArticleWithPersona[];
  /**
   * When true, already-read articles receive a small penalty (-1) to reduce
   * repetition. Defaults to true.
   */
  penalizeRead?: boolean;
};

/**
 * Return articles sorted by recommendation score (descending).
 * Articles with equal scores maintain their original relative order (stable sort).
 */
export async function getRecommendedArticles<T extends ArticleWithPersona>(
  options: Omit<RecommendOptions, "rawArticles"> & { rawArticles: T[] }
): Promise<(T & { _recommendScore: number })[]> {
  const { customerId, rawArticles, penalizeRead = true } = options;

  // No user -> return original order with score = 0
  if (!customerId) {
    return rawArticles.map((a) => ({ ...a, _recommendScore: 0 }));
  }

  // Fetch persona data and read history in parallel
  const [{ persona, depthLevel }, readSlugs] = await Promise.all([
    getUserPersonaData(customerId),
    penalizeRead ? getReadArticleSlugs(customerId) : Promise.resolve(new Set<string>()),
  ]);

  // No persona data yet -> return original order
  if (!persona && !depthLevel) {
    return rawArticles.map((a) => ({ ...a, _recommendScore: 0 }));
  }

  const scored = rawArticles.map((article) => {
    let score = scoreArticle(article, persona, depthLevel);

    // Small penalty for already-read articles
    const slug = article.slug as { current: string } | string | undefined;
    const slugStr = typeof slug === "object" && slug !== null ? slug.current : String(slug ?? "");
    if (penalizeRead && slugStr && readSlugs.has(slugStr)) {
      score += SCORE_READ_PENALTY;
    }

    return { ...article, _recommendScore: score };
  });

  // Stable sort: highest score first, preserve original order for ties
  return scored.sort((a, b) => b._recommendScore - a._recommendScore);
}
