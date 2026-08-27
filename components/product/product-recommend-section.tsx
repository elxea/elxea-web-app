/**
 * ProductRecommendSection — Server Component
 *
 * Personalized product recommendation section for the top page.
 * Displayed only when the user is authenticated and has a persona profile.
 * Falls back to null (invisible) if unauthenticated or if Firestore is unavailable.
 *
 * Usage:
 *   <Suspense fallback={null}>
 *     <ProductRecommendSection />
 *   </Suspense>
 */

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ImageCard } from "@/components/media/image-card";
import { getProducts } from "@/lib/shopify";
import { formatPriceRange } from "@/lib/utils";
import {
  getRecommendedProducts,
  PERSONA_TAG_AFFINITY,
} from "@/lib/recommendations/product-engine";
import type { PersonaType } from "@/lib/firebase/types";
import { cookies } from "next/headers";
import { getSession } from "@/lib/shopify/auth";
import { getCustomer, decryptToken } from "@/lib/shopify/customer";
import { extractCustomerId } from "@/lib/firebase/types";
import { COOKIE_NAME } from "@/lib/auth/cookie-names";

// --------------------------------------------------------------------------
// Persona display labels (Japanese)
// --------------------------------------------------------------------------

const PERSONA_LABELS: Record<PersonaType, string> = {
  serenity: "穏やか",
  explorer: "探求",
  sensory: "感覚",
};

const PERSONA_DESCRIPTIONS: Record<PersonaType, string> = {
  serenity: "あなたの「穏やか」スタイルに合う商品を選びました",
  explorer: "あなたの「探求」スタイルに合う新しい発見を",
  sensory: "あなたの「感覚」スタイルに響く味わいの商品",
};

// --------------------------------------------------------------------------
// Auth helper (same pattern as auth-guard.ts)
// --------------------------------------------------------------------------

async function resolveCustomerId(): Promise<string | null> {
  try {
    const session = await getSession();
    if (!session) return null;

    const cookieStore = await cookies();
    const cidEnc = cookieStore.get(COOKIE_NAME.shopCustomerId)?.value;
    if (cidEnc) {
      const customerId = decryptToken(cidEnc);
      if (customerId) return customerId;
    }

    const customer = await getCustomer(session.accessToken);
    if (!customer) return null;

    return extractCustomerId(customer.id);
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export async function ProductRecommendSection() {
  const customerId = await resolveCustomerId();

  // Not authenticated — hide section entirely
  if (!customerId) return null;

  let products;
  try {
    const { products: raw } = await getProducts({ first: 20, sortKey: "BEST_SELLING" });
    products = raw;
  } catch {
    return null;
  }

  if (!products || products.length === 0) return null;

  const recommended = await getRecommendedProducts({
    customerId,
    rawProducts: products,
    limit: 4,
  });

  // If all scores are 0, no persona data yet — skip section
  const hasPersonaScores = recommended.some((p) => p._recommendScore > 0);
  if (!hasPersonaScores) return null;

  // Determine the dominant persona from the top-scored products
  // (heuristic: check which persona's tags appear most in the top results)
  let dominantPersona: PersonaType | null = null;
  let maxTagHits = 0;
  for (const persona of Object.keys(PERSONA_TAG_AFFINITY) as PersonaType[]) {
    const affinityTags = PERSONA_TAG_AFFINITY[persona];
    const hits = recommended
      .slice(0, 2)
      .reduce((count, product) => {
        const productTags = product.tags.map((t) => t.toLowerCase());
        return count + affinityTags.filter((tag) => productTags.includes(tag)).length;
      }, 0);
    if (hits > maxTagHits) {
      maxTagHits = hits;
      dominantPersona = persona;
    }
  }

  const sectionLabel = dominantPersona
    ? PERSONA_DESCRIPTIONS[dominantPersona]
    : "あなたへのおすすめ";

  return (
    <section className="section-wide">
      <div className="flex items-end justify-between mb-10">
        <div>
          <h2>あなたへのおすすめ</h2>
          {dominantPersona && (
            <p className="text-sm text-muted-foreground mt-2">{sectionLabel}</p>
          )}
        </div>
        <Button variant="link" className="p-0 h-auto text-muted-foreground" asChild>
          <Link href="/products">すべて見る →</Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
        {recommended.map((product) => {
          const price = formatPriceRange(
            product.priceRange.minVariantPrice,
            product.priceRange.maxVariantPrice
          );

          return (
            <Link
              key={product.id}
              href={`/products/${product.handle}`}
              className="group block"
            >
              <ImageCard
                image={product.featuredImage?.url}
                alt={product.featuredImage?.altText || product.title}
                className="mb-4"
                width={400}
                height={267}
                sizes="(max-width: 640px) 50vw, 25vw"
                hover
              />
              <p className="text-sm font-medium leading-snug group-hover:underline line-clamp-2">
                {product.title}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {price}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
