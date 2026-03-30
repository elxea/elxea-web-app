/**
 * Validate that an image URL hostname is allowed by next.config.ts remotePatterns.
 * Returns the URL if valid, or null if the hostname is not in the allowlist.
 *
 * This prevents Next.js Image optimization errors when external data sources
 * (e.g. Shopify metafields) contain unexpected image hostnames.
 */

const ALLOWED_HOSTNAMES = [
  "cdn.shopify.com",
  "cdn.sanity.io",
];

const ALLOWED_PATTERNS = [
  /^.*\.shopify\.com$/,
];

export function sanitizeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  // Allow relative URLs (local images)
  if (url.startsWith("/")) return url;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    if (ALLOWED_HOSTNAMES.includes(hostname)) return url;
    if (ALLOWED_PATTERNS.some((p) => p.test(hostname))) return url;

    // Hostname not in allowlist — reject to prevent Next.js Image errors
    console.warn(`[image-utils] Blocked image from unregistered host: ${hostname}`);
    return null;
  } catch {
    // Malformed URL
    return null;
  }
}
