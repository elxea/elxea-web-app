import { isAllowedImageUrl } from "./image-hosts";

/**
 * Validate that an image URL hostname is allowed (`lib/image-hosts.ts` — the single
 * allowlist shared with next.config.ts remotePatterns and the custom image loader).
 * Returns the URL if valid, or null if the hostname is not in the allowlist.
 *
 * This prevents Next.js Image loader errors when external data sources
 * (e.g. Shopify metafields) contain unexpected image hostnames.
 */
export function sanitizeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  // Allow relative URLs (local images)
  if (url.startsWith("/")) return url;

  try {
    const parsed = new URL(url);
    if (isAllowedImageUrl(parsed)) return url;

    // Hostname not in allowlist — reject to prevent Next.js Image errors
    console.warn(`[image-utils] Blocked image from unregistered host: ${parsed.hostname}`);
    return null;
  } catch {
    // Malformed URL
    return null;
  }
}
