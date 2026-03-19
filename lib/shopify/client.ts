const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "";
const SHOPIFY_STOREFRONT_ACCESS_TOKEN =
  process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "";
const API_VERSION = "2025-04";

const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/api/${API_VERSION}/graphql.json`;

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
