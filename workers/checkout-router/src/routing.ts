/**
 * elxea Checkout Router — routing table (pure, dependency-free)
 *
 * Kept in its own module, separate from the Worker entrypoint (index.ts), so the
 * unit tests can import the REAL routing decision instead of re-declaring a copy.
 * index.ts carries Cloudflare Worker globals (ExecutionContext / fetch handler)
 * that must not be pulled into the Node test environment.
 *
 * Do not duplicate this table anywhere else — a copy is a test that cannot fail.
 */

/** Paths that Shopify must handle — proxy to Shopify origin */
export const SHOPIFY_PATH_PREFIXES = [
  '/checkouts/',
  '/checkouts',
  '/cart/add',
  '/cart/update',
  '/cart/change',
  '/cart/clear',
  '/cart.js',
  '/cart.json',
  '/services/',
  '/.well-known/shopify/',
  '/payments/',
  '/wallets/',
  // Shopify CDN paths — only allow specific subdirectories needed by checkout
  '/cdn/shopifycloud/',
  '/cdn/s/',
] as const;

export function isShopifyPath(pathname: string): boolean {
  return SHOPIFY_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix)
  );
}
