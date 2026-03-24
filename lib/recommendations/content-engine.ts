/**
 * Content Recommendation Engine
 *
 * Scores and re-orders Sanity articles based on the user's Firestore persona
 * and behavioral history.
 *
 * Scoring logic (weights from config/scoring-weights.json):
 *   +3 — persona x contentPersona match (primary signal)
 *   +2 — targetLayer match with user's persona-derived layer mapping
 *   +1 — depthLevel of article matches user's depth level
 *   +1 — contextTime matches current time of day (JST)
 *   +1 — contextSeason matches current season (JST)
 *   -1 — already-read article penalty
 *
 * Design decisions:
 *   - Fix #3: targetLayer is now compared against a persona-to-layer mapping
 *     instead of comparing against depthLevel (which was a type mismatch bug).
 *   - Fix #4: contextTime and contextSeason from Sanity are now used in scoring.
 *   - Fix #5: Scoring weights are documented with rationale in the JSON config.
 *
 * Fallback: returns the original order (publishedAt desc) for unauthenticated
 * users or when Firestore data is unavailable.
 *
 * Usage (Server Component only — requires Firebase Admin SDK):
 *   import { getRecommendedArticles } from "@/lib/recommendations/content-engine";
 *   const articles = await getRecommendedArticles({ customerId, rawArticles });
 */

import type { PersonaType, DepthLevel, UserProfile } from "@/lib/firebase/types";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { userDoc, behaviorLogCol } from "@/lib/firebase/collections";
import scoringConfig from "./config/scoring-weights.json";

// --------------------------------------------------------------------------
// Article type (Sanity response subset used for scoring)
// --------------------------------------------------------------------------

export type ArticleWithPersona = {
  _id: string;
  contentPersona?: string | string[] | null;
  depthLevel?: string | null;
  targetLayer?: string | string[] | null;
  contextTime?: string | null;
  contextSeason?: string | null;
  [key: string]: unknown;
};

export type ScoredArticle<T extends ArticleWithPersona = ArticleWithPersona> =
  T & { _recommendScore: number };

// --------------------------------------------------------------------------
// Scoring constants (loaded from config — Fix #5)
// --------------------------------------------------------------------------

/**
 * Scoring weights with documented rationale.
 * See config/scoring-weights.json for full explanations.
 *
 * Summary:
 *   personaMatch (3): Strongest signal — cumulative behavioral pattern alignment.
 *   targetLayerMatch (2): Lifestyle segment fit (why user engages with tea).
 *   depthMatch (1): Content complexity fit — adjacent depths still useful.
 *   contextTimeMatch (1): Time-of-day relevance — subtle boost.
 *   contextSeasonMatch (1): Seasonal relevance — subtle boost.
 *   readPenalty (-1): Discovery promotion without hiding revisitable content.
 */
const SCORE_PERSONA_MATCH = scoringConfig.weights.personaMatch.value;
const SCORE_TARGET_LAYER_MATCH = scoringConfig.weights.targetLayerMatch.value;
const SCORE_DEPTH_MATCH = scoringConfig.weights.depthMatch.value;
const SCORE_CONTEXT_TIME_MATCH = scoringConfig.weights.contextTimeMatch.value;
const SCORE_CONTEXT_SEASON_MATCH = scoringConfig.weights.contextSeasonMatch.value;
const SCORE_READ_PENALTY = scoringConfig.weights.readPenalty.value;

// --------------------------------------------------------------------------
// Persona → targetLayer mapping (Fix #3)
// --------------------------------------------------------------------------

/**
 * Maps persona types to the targetLayer values they align with.
 *
 * Fix #3: The original code compared article.targetLayer (tea_lover / wellbeing /
 * gourmet) against user.depthLevel (entry / explore / deep). These are different
 * dimensions and never matched. Instead, we map the user's persona to the
 * corresponding target layer:
 *
 *   serenity → wellbeing  (wellness-oriented users → wellbeing content)
 *   explorer → tea_lover  (knowledge-seeking users → tea enthusiast content)
 *   sensory  → gourmet    (taste-focused users → gourmet/flavor content)
 */
const PERSONA_TO_LAYER: Record<PersonaType, string> = {
  serenity: "wellbeing",
  explorer: "tea_lover",
  sensory: "gourmet",
};

// --------------------------------------------------------------------------
// Context helpers (Fix #4)
// --------------------------------------------------------------------------

/**
 * Get the current time-of-day context based on JST (UTC+9).
 * Returns "morning" (5-11), "afternoon" (12-17), or "evening" (18-4).
 */
function getCurrentTimeContext(): string {
  const now = new Date();
  // Convert to JST
  const jstHour = (now.getUTCHours() + 9) % 24;

  if (jstHour >= 5 && jstHour < 12) return "morning";
  if (jstHour >= 12 && jstHour < 18) return "afternoon";
  return "evening";
}

/**
 * Get the current season context based on JST date.
 * Aligned with Japanese meteorological seasons:
 *   spring: March–May, summer: June–August,
 *   autumn: September–November, winter: December–February
 */
function getCurrentSeasonContext(): string {
  const now = new Date();
  // Use JST date for season calculation
  const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const month = jstDate.getMonth() + 1; // 1-indexed

  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

// --------------------------------------------------------------------------
// Main scoring function
// --------------------------------------------------------------------------

/**
 * Score a single article against the user's persona, depth level, and context.
 *
 * @param article - Sanity article with persona/depth/context fields
 * @param userPersona - User's primary persona type (e.g. "serenity")
 * @param userDepth - User's depth level (e.g. "entry")
 * @param currentTime - Current time-of-day context (e.g. "morning")
 * @param currentSeason - Current season context (e.g. "spring")
 */
export function scoreArticle(
  article: ArticleWithPersona,
  userPersona: string | null,
  userDepth: string | null,
  currentTime?: string,
  currentSeason?: string,
): number {
  let score = 0;

  // (1) persona x contentPersona match → +3
  if (userPersona && article.contentPersona) {
    const personas = Array.isArray(article.contentPersona)
      ? article.contentPersona
      : [article.contentPersona];
    if (personas.includes(userPersona)) {
      score += SCORE_PERSONA_MATCH;
    }
  }

  // (2) targetLayer match via persona→layer mapping → +2 (Fix #3)
  // Previously compared targetLayer against depthLevel which never matched
  // because they use different value sets (tea_lover/wellbeing/gourmet vs
  // entry/explore/deep).
  if (userPersona && article.targetLayer) {
    const userLayer = PERSONA_TO_LAYER[userPersona as PersonaType];
    if (userLayer) {
      const layers = Array.isArray(article.targetLayer)
        ? article.targetLayer
        : [article.targetLayer];
      if (layers.includes(userLayer)) {
        score += SCORE_TARGET_LAYER_MATCH;
      }
    }
  }

  // (3) depthLevel match → +1
  if (userDepth && article.depthLevel) {
    if (article.depthLevel === userDepth) {
      score += SCORE_DEPTH_MATCH;
    }
  }

  // (4) contextTime match → +1 (Fix #4)
  if (currentTime && article.contextTime) {
    if (article.contextTime === currentTime) {
      score += SCORE_CONTEXT_TIME_MATCH;
    }
  }

  // (5) contextSeason match → +1 (Fix #4)
  if (currentSeason && article.contextSeason) {
    if (article.contextSeason === currentSeason) {
      score += SCORE_CONTEXT_SEASON_MATCH;
    }
  }

  return score;
}

// --------------------------------------------------------------------------
// Firestore helpers
// --------------------------------------------------------------------------

/**
 * Retrieve the user's persona and depth level from Firestore.
 * Returns null values when the document doesn't exist or fields are missing.
 */
async function getUserPersonaData(
  customerId: string,
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
   * When true, already-read articles receive a small penalty to reduce
   * repetition. Defaults to true.
   */
  penalizeRead?: boolean;
};

/**
 * Return articles sorted by recommendation score (descending).
 * Articles with equal scores maintain their original relative order (stable sort).
 */
export async function getRecommendedArticles<T extends ArticleWithPersona>(
  options: Omit<RecommendOptions, "rawArticles"> & { rawArticles: T[] },
): Promise<(T & { _recommendScore: number })[]> {
  const { customerId, rawArticles, penalizeRead = true } = options;

  // No user → return original order with score = 0
  if (!customerId) {
    return rawArticles.map((a) => ({ ...a, _recommendScore: 0 }));
  }

  // Fetch persona data and read history in parallel
  const [{ persona, depthLevel }, readSlugs] = await Promise.all([
    getUserPersonaData(customerId),
    penalizeRead
      ? getReadArticleSlugs(customerId)
      : Promise.resolve(new Set<string>()),
  ]);

  // No persona data yet → return original order
  if (!persona && !depthLevel) {
    return rawArticles.map((a) => ({ ...a, _recommendScore: 0 }));
  }

  // Get current context for time/season matching (Fix #4)
  const currentTime = getCurrentTimeContext();
  const currentSeason = getCurrentSeasonContext();

  const scored = rawArticles.map((article) => {
    let score = scoreArticle(
      article,
      persona,
      depthLevel,
      currentTime,
      currentSeason,
    );

    // Small penalty for already-read articles
    const slug = article.slug as { current: string } | string | undefined;
    const slugStr =
      typeof slug === "object" && slug !== null
        ? slug.current
        : String(slug ?? "");
    if (penalizeRead && slugStr && readSlugs.has(slugStr)) {
      score += SCORE_READ_PENALTY; // negative value from config
    }

    return { ...article, _recommendScore: score };
  });

  // Stable sort: highest score first, preserve original order for ties
  return scored.sort((a, b) => b._recommendScore - a._recommendScore);
}
