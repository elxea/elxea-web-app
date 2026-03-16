/**
 * Content Recommendation Engine
 *
 * Scores and re-orders Sanity articles based on the user's Firestore persona
 * and behavioral history.
 *
 * Scoring logic:
 *   +3 — persona × contentPersona match (primary signal)
 *   +2 — targetLayer match with user's depthLevel
 *   +1 — depthLevel of article matches user's reading depth history
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
  targetLayer?: string | null;
  [key: string]: unknown;
};

export type ScoredArticle<T extends ArticleWithPersona = ArticleWithPersona> =
  T & { _recommendScore: number };

// --------------------------------------------------------------------------
// Scoring constants
// --------------------------------------------------------------------------

const SCORE_PERSONA_MATCH = 3;
const SCORE_TARGET_LAYER_MATCH = 2;
const SCORE_DEPTH_MATCH = 1;

// --------------------------------------------------------------------------
// Main scoring function
// --------------------------------------------------------------------------

/**
 * Score a single article against the user's persona and depth level.
 */
export function scoreArticle(
  article: ArticleWithPersona,
  userPersona: string | null,
  userDepth: string | null
): number {
  let score = 0;

  // (1) persona × contentPersona match → +3
  if (userPersona && article.contentPersona) {
    const personas = Array.isArray(article.contentPersona)
      ? article.contentPersona
      : [article.contentPersona];
    if (personas.includes(userPersona)) {
      score += SCORE_PERSONA_MATCH;
    }
  }

  // (2) targetLayer × depthLevel match → +2
  // targetLayer indicates the experience level the article is written for
  if (userDepth && article.targetLayer) {
    if (article.targetLayer === userDepth) {
      score += SCORE_TARGET_LAYER_MATCH;
    }
  }

  // (3) depthLevel of article matches user's reading depth history → +1
  if (userDepth && article.depthLevel) {
    if (article.depthLevel === userDepth) {
      score += SCORE_DEPTH_MATCH;
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

  // No user → return original order with score = 0
  if (!customerId) {
    return rawArticles.map((a) => ({ ...a, _recommendScore: 0 }));
  }

  // Fetch persona data and read history in parallel
  const [{ persona, depthLevel }, readSlugs] = await Promise.all([
    getUserPersonaData(customerId),
    penalizeRead ? getReadArticleSlugs(customerId) : Promise.resolve(new Set<string>()),
  ]);

  // No persona data yet → return original order
  if (!persona && !depthLevel) {
    return rawArticles.map((a) => ({ ...a, _recommendScore: 0 }));
  }

  const scored = rawArticles.map((article) => {
    let score = scoreArticle(article, persona, depthLevel);

    // Small penalty for already-read articles
    const slug = article.slug as { current: string } | string | undefined;
    const slugStr = typeof slug === "object" && slug !== null ? slug.current : String(slug ?? "");
    if (penalizeRead && slugStr && readSlugs.has(slugStr)) {
      score -= 1;
    }

    return { ...article, _recommendScore: score };
  });

  // Stable sort: highest score first, preserve original order for ties
  return scored.sort((a, b) => b._recommendScore - a._recommendScore);
}
