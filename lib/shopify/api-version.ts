/**
 * Single source of truth for the Shopify API version used across every
 * Shopify surface (Storefront API, Admin API, Customer Account API).
 *
 * Why one constant: previously each client module hard-coded its own version
 * string, so they drifted and all three were left on `2025-04` — a version that
 * is past Shopify's support window (each stable version is supported for a
 * minimum of 12 months; 2025-04 is no longer in the accessible set as of
 * 2026-08). Requests against an unsupported version silently "fall forward" to
 * the oldest accessible stable version, which means the schema we validated
 * against is not the schema we are actually talking to.
 *
 * `2026-07` is the current stable version at the time of this change and is the
 * version the store's Customer Account API was measured on.
 *
 * Ref: https://shopify.dev/docs/api/usage/versioning
 */
export const SHOPIFY_API_VERSION = "2026-07";
