/**
 * ProductRecommendSidebar — Server Component
 *
 * Displays persona-scored product recommendations in a sidebar layout.
 * Reads the current user's Shopify customer ID from session cookies,
 * fetches products from the Storefront API, then scores them via the
 * product recommendation engine.
 *
 * Usage:
 *   <ProductRecommendSidebar heading="おすすめ商品" locale="ja" />
 */

import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { ImagePlaceholder } from "@/components/media/image-placeholder";
import { getProducts } from "@/lib/shopify";
import { formatPrice } from "@/lib/utils";
import { getRecommendedProducts } from "@/lib/recommendations/product-engine";
import { cookies } from "next/headers";
import { decryptToken } from "@/lib/shopify/customer";
import { getSession } from "@/lib/shopify/auth";
import { getCustomer } from "@/lib/shopify/customer";
import { extractCustomerId } from "@/lib/firebase/types";

type Props = {
  heading?: string;
  limit?: number;
};

/**
 * Resolve the numeric Shopify customer ID from session cookies.
 * Returns null if the user is not authenticated.
 */
async function resolveCustomerId(): Promise<string | null> {
  try {
    const session = await getSession();
    if (!session) return null;

    // Fast path: cached from id_token
    const cookieStore = await cookies();
    const cidEnc = cookieStore.get("shop_cid")?.value;
    if (cidEnc) {
      const customerId = decryptToken(cidEnc);
      if (customerId) return customerId;
    }

    // Slow path: fetch from Shopify API
    const customer = await getCustomer(session.accessToken);
    if (!customer) return null;

    return extractCustomerId(customer.id);
  } catch {
    return null;
  }
}

export async function ProductRecommendSidebar({
  heading = "おすすめ商品",
  limit = 3,
}: Props) {
  let products;
  try {
    const { products: raw } = await getProducts({ first: 20, sortKey: "BEST_SELLING" });
    products = raw;
  } catch {
    return null;
  }

  if (!products || products.length === 0) return null;

  const customerId = await resolveCustomerId();

  const recommended = await getRecommendedProducts({
    customerId,
    rawProducts: products,
    limit,
  });

  return (
    <aside aria-label={heading} className="space-y-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">
        {heading}
      </p>

      <ul className="space-y-4" role="list">
        {recommended.map((product) => {
          const price = product.priceRange.minVariantPrice;

          return (
            <li key={product.id}>
              <Link
                href={`/products/${product.handle}`}
                className="group flex gap-3 items-start"
              >
                {/* Thumbnail */}
                <div className="w-16 h-16 shrink-0 bg-muted overflow-hidden rounded-md">
                  {product.featuredImage ? (
                    <Image
                      src={product.featuredImage.url}
                      alt={product.featuredImage.altText || product.title}
                      width={64}
                      height={64}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <ImagePlaceholder />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug line-clamp-2 group-hover:underline">
                    {product.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatPrice(price.amount, price.currencyCode)}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <Link
        href="/products"
        className="block text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
      >
        すべての商品を見る
      </Link>
    </aside>
  );
}
