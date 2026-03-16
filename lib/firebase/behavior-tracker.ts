/**
 * Client-side behavior event tracker.
 *
 * Sends behavior events to /api/user/behavior (server route → Firestore).
 * All functions are fire-and-forget — errors are silently ignored to avoid
 * disrupting user experience.
 *
 * Usage:
 *   import { trackPageView, trackArticleRead, trackProductView, trackFavoriteAdd } from "@/lib/firebase/behavior-tracker";
 *
 *   // In a useEffect or event handler:
 *   trackPageView({ contentId: "article-slug", category: "tea-culture" });
 */

export type TrackPageViewParams = {
  contentId: string;
  category?: string;
  title?: string;
};

export type TrackArticleReadParams = {
  contentId: string;
  category?: string;
  title?: string;
  /** Approximate reading time in seconds */
  durationSeconds?: number;
};

export type TrackProductViewParams = {
  productId: string;
  title?: string;
  category?: string;
};

export type TrackFavoriteAddParams = {
  contentId?: string;
  productId?: string;
  type: "article" | "product";
};

export type TrackSearchParams = {
  query: string;
};

/**
 * Send a behavior event to the server. Fire-and-forget.
 */
async function sendEvent(
  action: string,
  metadata: Record<string, string | number | undefined>,
): Promise<void> {
  try {
    // Only track for logged-in users (check for session cookie)
    if (typeof document === "undefined") return;
    if (!document.cookie.includes("shop_auth=1")) return;

    await fetch("/api/user/behavior", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, channel: "web", metadata }),
    });
  } catch {
    // Silently ignore — behavior tracking must never break UX
  }
}

/**
 * Track a page view (article or static content).
 */
export function trackPageView(params: TrackPageViewParams): void {
  sendEvent("view_content", {
    contentId: params.contentId,
    ...(params.category ? { query: params.category } : {}),
  }).catch(() => {});
}

/**
 * Track article read completion (reached end of article or spent significant time).
 */
export function trackArticleRead(params: TrackArticleReadParams): void {
  sendEvent("view_content", {
    contentId: params.contentId,
    ...(params.category ? { query: `read:${params.category}` } : {}),
  }).catch(() => {});
}

/**
 * Track a product detail page view.
 */
export function trackProductView(params: TrackProductViewParams): void {
  sendEvent("view_product", {
    productId: params.productId,
    ...(params.category ? { query: params.category } : {}),
  }).catch(() => {});
}

/**
 * Track when a user adds something to favorites.
 */
export function trackFavoriteAdd(params: TrackFavoriteAddParams): void {
  sendEvent("tap_button", {
    buttonLabel: `favorite_${params.type}`,
    ...(params.contentId ? { contentId: params.contentId } : {}),
    ...(params.productId ? { productId: params.productId } : {}),
  }).catch(() => {});
}

/**
 * Track a search query.
 */
export function trackSearch(params: TrackSearchParams): void {
  sendEvent("search", {
    query: params.query,
  }).catch(() => {});
}
