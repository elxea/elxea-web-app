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

import type { FavoriteKind } from "@/lib/account-favorites";
import { logger } from "@/lib/log";

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
  /**
   * お気に入りの種類。正本は `FAVORITE_KINDS` (`lib/account-favorites.ts`)。
   * ここで語をベタ書きすると、種類を足したときに計測だけ古い語のまま残る。
   */
  type: FavoriteKind;
};

export type TrackSearchParams = {
  query: string;
};

export type TrackAudioPlayParams = {
  /** 記事 slug 等、音声が載っているコンテンツの ID */
  contentId: string;
  /** 楽曲プレイリストかインタビューか */
  kind: "track" | "interview";
  /** 曲名など。プレイリストの何曲目を鳴らしたかを残すために使う */
  title?: string;
};

/**
 * Send a behavior event to the server. Fire-and-forget.
 */
async function sendEvent(
  action: string,
  metadata: Record<string, string | number | undefined>,
): Promise<void> {
  try {
    // Only track for logged-in users (check for session cookie).
    // A5: LINE ログイン (`line_auth=1`) も対象に含める。以前は Shopify
    // (`shop_auth=1`) だけを見ていたため、LINE で入った会員の閲覧・読了が
    // 行動ログに 1 件も残らず、パーソナライズの入力から丸ごと欠けていた。
    // サーバ側 (`/api/user/behavior`) も `resolveIdentity()` で LINE を
    // 受けるようにしてあるので、ここを開けると実際に書き込まれる。
    if (typeof document === "undefined") return;
    if (
      !document.cookie.includes("shop_auth=1") &&
      !document.cookie.includes("line_auth=1")
    ) {
      return;
    }

    await fetch("/api/user/behavior", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, channel: "web", metadata }),
    });
  } catch (err) {
    /* 画面は今までどおり止めない。ただし送信が全滅してもパーソナライズの入力が
       静かに欠けるだけだったので、行動の中身ではなく種別だけを残す。 */
    logger.error("firebase.behavior-tracker.send-failed", err, { action });
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
 * Includes durationSeconds for engagement depth scoring in persona calculation.
 */
export function trackArticleRead(params: TrackArticleReadParams): void {
  sendEvent("view_content", {
    contentId: params.contentId,
    ...(params.category ? { query: `read:${params.category}` } : {}),
    ...(params.durationSeconds ? { durationSeconds: params.durationSeconds } : {}),
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

/**
 * Track the start of in-article audio playback (W3-4).
 *
 * 記事内プレイヤーの再生開始だけを送る。BGM (サイト常駐の環境音) は対象外で、
 * 「この記事の音を聴こうと思った」という意思のある行動だけを残す。
 * 一時停止・再開・シークは送らない — 1 再生で何十件も積むと、他の行動と
 * 比べたときの重みが壊れるため。
 */
export function trackAudioPlay(params: TrackAudioPlayParams): void {
  sendEvent("audio_play", {
    contentId: params.contentId,
    buttonLabel: `audio_${params.kind}`,
    ...(params.title ? { query: params.title } : {}),
  }).catch(() => {});
}
