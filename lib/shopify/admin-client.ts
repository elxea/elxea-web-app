const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || "";
const SHOPIFY_ADMIN_ACCESS_TOKEN =
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
const API_VERSION = "2025-04";

const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;

type AdminResponse<T> = {
  data: T;
  errors?: { message: string; locations?: { line: number; column: number }[] }[];
  extensions?: { cost: { requestedQueryCost: number; actualQueryCost: number } };
};

type UserError = {
  field: string[] | null;
  message: string;
};

export async function adminFetch<T>({
  query,
  variables,
}: {
  query: string;
  variables?: Record<string, unknown>;
}): Promise<T> {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
    throw new Error("Shopify Admin API credentials not configured.");
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Shopify Admin API error: ${res.status} ${res.statusText}`
    );
  }

  const json: AdminResponse<T> = await res.json();

  if (json.errors) {
    throw new Error(
      `Shopify Admin GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`
    );
  }

  return json.data;
}

/**
 * Extract and throw on userErrors from a Shopify Admin mutation response.
 * Returns the mutation result if no errors.
 */
export function throwOnUserErrors<T extends Record<string, unknown>>(
  data: T,
  mutationName: string
): T {
  const result = data[mutationName] as
    | { userErrors?: UserError[] }
    | undefined;
  if (result?.userErrors && result.userErrors.length > 0) {
    const messages = result.userErrors
      .map((e) => `${e.field?.join(".") ?? "unknown"}: ${e.message}`)
      .join("; ");
    throw new Error(`${mutationName} failed: ${messages}`);
  }
  return data;
}
