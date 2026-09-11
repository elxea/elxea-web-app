import { SHOPIFY_API_VERSION } from "./api-version";

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "";
const SHOPIFY_STOREFRONT_ACCESS_TOKEN =
  process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "";

const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`;

/**
 * True when both Storefront credentials are present.
 *
 * Callers use this to distinguish "this environment has no Shopify at all"
 * (CI, a clone without secrets) from "Shopify is configured but the request
 * failed" (outage, rate limit). Only the first case may fall back to seeded
 * catalogue data — masking a real outage with dummy products would hide a
 * production incident. See `lib/preview-seed-storefront.ts`.
 */
export function storefrontConfigured(): boolean {
  return Boolean(SHOPIFY_STORE_DOMAIN && SHOPIFY_STOREFRONT_ACCESS_TOKEN);
}

type ShopifyResponse<T> = {
  data: T;
  errors?: { message: string; locations?: { line: number; column: number }[] }[];
};

export async function shopifyFetch<T>({
  query,
  variables,
  cache,
  revalidate = 60,
  tags,
}: {
  query: string;
  variables?: Record<string, unknown>;
  cache?: RequestCache;
  revalidate?: number | false;
  tags?: string[];
}): Promise<T> {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_STOREFRONT_ACCESS_TOKEN) {
    throw new Error("Shopify API credentials not configured.");
  }

  // cache: "no-store" takes precedence (cart, search, mutations)
  // Otherwise use ISR with next.revalidate + tags
  const fetchOptions: RequestInit & { next?: { revalidate?: number; tags?: string[] } } = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  };

  if (cache === "no-store") {
    fetchOptions.cache = "no-store";
  } else {
    fetchOptions.next = {
      ...(revalidate !== false ? { revalidate } : {}),
      ...(tags ? { tags } : {}),
    };
  }

  const res = await fetch(endpoint, fetchOptions);

  if (!res.ok) {
    throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
  }

  const json: ShopifyResponse<T> = await res.json();

  if (json.errors) {
    throw new Error(
      `Shopify GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`
    );
  }

  return json.data;
}
