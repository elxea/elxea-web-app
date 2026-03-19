/**
 * Product Recommendation Engine
 *
 * Scores and re-orders Shopify products based on the user's Firestore persona
 * and purchase history.
 *
 * Scoring logic:
 *   +3 — persona × tag affinity match (primary signal)
 *   +1 — taste profile × product type match
 *   -2 — product already purchased (reduce repetition)
 *
 * Persona → tag affinity mapping:
 *   serenity  → floral, umami, green-tea, hojicha, calm
 *   explorer  → citrus, earthy, oolong, single-origin, terroir
 *   sensory   → rich, sweet, black-tea, matcha, roasted, complex
 *
 * Fallback: returns the original order for unauthenticated users
 * or when Firestore data is unavailable.
 *
 * Usage (Server Component only — requires Firebase Admin SDK):
 *   import { getRecommendedProducts } from "@/lib/recommendations/product-engine";
 *   const products = await getRecommendedProducts({ customerId, rawProducts });
 */

import type { Product } from "@/lib/shopify/types";
import type { PersonaType, UserProfile, TasteProfile } from "@/lib/firebase/types";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { userDoc, ordersCol } from "@/lib/firebase/collections";

// --------------------------------------------------------------------------
// Persona × Tag affinity mapping
// --------------------------------------------------------------------------

/**
 * Maps each persona to Shopify product tags that are highly relevant.
 * Tags should correspond to actual Shopify product tags used in elxea's catalog.
 */
export const PERSONA_TAG_AFFINITY: Record<PersonaType, string[]> = {
  serenity: [
    "floral",
    "umami",
    "green-tea",
    "greentea",
    "hojicha",
    "gyokuro",
    "calm",
    "relaxing",
    "evening",
    "light",
  ],
  explorer: [
    "citrus",
    "earthy",
    "oolong",
    "single-origin",
    "terroir",
    "experimental",
    "limited",
    "seasonal",
    "rare",
    "natural",
  ],
  sensory: [
    "rich",
    "sweet",
    "black-tea",
    "blacktea",
    "matcha",
    "roasted",
    "complex",
    "aged",
    "bold",
    "puerh",
  ],
};

/**
 * Maps taste profile flavor preferences to product tags.
 * Derived from TasteProfile.flavorPreferences values.
 */
const FLAVOR_TO_TAG_MAP: Record<string, string[]> = {
  floral: ["floral", "jasmine", "rose"],
  umami: ["umami", "gyokuro", "green-tea"],
  sweet: ["sweet", "hojicha", "roasted"],
  citrus: ["citrus", "bergamot"],
  earthy: ["earthy", "oolong", "puerh"],
  rich: ["rich", "bold", "matcha"],
  light: ["light", "green-tea", "white-tea"],
};

// --------------------------------------------------------------------------
// Scoring constants
// --------------------------------------------------------------------------

const SCORE_PERSONA_TAG_MATCH = 3;
const SCORE_TASTE_PROFILE_MATCH = 1;
const SCORE_PURCHASED_PENALTY = -2;

// --------------------------------------------------------------------------
// Main scoring function
// --------------------------------------------------------------------------

/**
 * Score a single product against the user's persona and taste profile.
 */
export function scoreProduct(
  product: Product,
  userPersona: PersonaType | null,
  tasteProfile: TasteProfile | null,
): number {
  let score = 0;
  const productTags = product.tags.map((t) => t.toLowerCase());

  // (1) persona × tag affinity → +3 if any affinity tag found in product tags
  if (userPersona) {
    const affinityTags = PERSONA_TAG_AFFINITY[userPersona];
    const hasMatch = affinityTags.some((tag) => productTags.includes(tag));
    if (hasMatch) {
      score += SCORE_PERSONA_TAG_MATCH;
    }
  }

  // (2) taste profile × product tags → +1 per flavor preference match
  if (tasteProfile?.flavorPreferences?.length) {
    for (const flavor of tasteProfile.flavorPreferences) {
      const relatedTags = FLAVOR_TO_TAG_MAP[flavor.toLowerCase()] ?? [];
      const hasFlavorMatch = relatedTags.some((tag) => productTags.includes(tag));
      if (hasFlavorMatch) {
        score += SCORE_TASTE_PROFILE_MATCH;
        break; // cap at +1 for taste profile
      }
    }
  }

  return score;
}

// --------------------------------------------------------------------------
// Firestore helpers
// --------------------------------------------------------------------------

/**
 * Retrieve the user's persona and taste profile from Firestore.
 */
async function getUserPersonaData(customerId: string): Promise<{
  persona: PersonaType | null;
  tasteProfile: TasteProfile | null;
}> {
  try {
    const db = getAdminFirestore();
    const snapshot = await db.doc(userDoc(customerId)).get();

    if (!snapshot.exists) {
      return { persona: null, tasteProfile: null };
    }

    const data = snapshot.data() as UserProfile;
    return {
      persona: data.persona?.primary ?? null,
      tasteProfile: data.tasteProfile ?? null,
    };
  } catch {
    return { persona: null, tasteProfile: null };
  }
}

/**
 * Retrieve the set of Shopify product variant IDs that the user has purchased.
 * Used to apply a penalty to already-purchased products.
 */
async function getPurchasedProductHandles(customerId: string): Promise<Set<string>> {
  try {
    const db = getAdminFirestore();
    const snapshot = await db.collection(ordersCol(customerId)).get();

    const handles = new Set<string>();
    for (const doc of snapshot.docs) {
      const items = doc.data().items as Array<{ variantId?: string; title?: string }> | undefined;
      if (items) {
        for (const item of items) {
          // variantId format: "gid://shopify/ProductVariant/12345"
          // We store the title as a fallback key for deduplication
          if (item.title) {
            handles.add(item.title.toLowerCase());
          }
        }
      }
    }
    return handles;
  } catch {
    return new Set();
  }
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

export type ScoredProduct = Product & { _recommendScore: number };

type ProductRecommendOptions = {
  /** Shopify numeric customer ID. If null, returns original order. */
  customerId: string | null;
  /** Products fetched from Shopify Storefront API. */
  rawProducts: Product[];
  /** Maximum number of products to return. Defaults to 4. */
  limit?: number;
  /**
   * When true, already-purchased products receive a penalty to reduce repetition.
   * Defaults to true.
   */
  penalizePurchased?: boolean;
};

/**
 * Return products sorted by recommendation score (descending).
 * Products with equal scores maintain their original relative order (stable sort).
 */
export async function getRecommendedProducts(
  options: ProductRecommendOptions,
): Promise<ScoredProduct[]> {
  const { customerId, rawProducts, limit = 4, penalizePurchased = true } = options;

  // No user → return top N products by original order (best selling)
  if (!customerId) {
    return rawProducts.slice(0, limit).map((p) => ({ ...p, _recommendScore: 0 }));
  }

  // Fetch persona data and purchase history in parallel
  const [{ persona, tasteProfile }, purchasedTitles] = await Promise.all([
    getUserPersonaData(customerId),
    penalizePurchased ? getPurchasedProductHandles(customerId) : Promise.resolve(new Set<string>()),
  ]);

  // No persona data yet → return top N products
  if (!persona && !tasteProfile) {
    return rawProducts.slice(0, limit).map((p) => ({ ...p, _recommendScore: 0 }));
  }

  const scored = rawProducts.map((product): ScoredProduct => {
    let score = scoreProduct(product, persona, tasteProfile);

    // Apply penalty for already-purchased products
    if (penalizePurchased && purchasedTitles.has(product.title.toLowerCase())) {
      score += SCORE_PURCHASED_PENALTY;
    }

    return { ...product, _recommendScore: score };
  });

  // Stable sort: highest score first, preserve original order for ties
  const sorted = scored.sort((a, b) => b._recommendScore - a._recommendScore);

  return sorted.slice(0, limit);
}
