/**
 * Client-side behavior event tracker.
 *
 * Sends behavior events to /api/user/behavior (server route → Firestore)
 * via `navigator.sendBeacon` — 送りっぱなしで、画面は一切待たない。
 * 送信できなかったときだけ Sentry に種別を残す (中身は残さない)。
 * なぜ `fetch` ではないかは `sendEvent` の doc を参照。
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
 * 行動ログを 1 件サーバへ送る。**返事は見ない。**
 *
 * ## なぜ `fetch` ではなく `navigator.sendBeacon` なのか (2026-08-27 / 憲章 R9)
 *
 * ここは長らく `fetch(..., { method: "POST" })` だった。それには 2 つの問題が
 * 同時にあった。
 *
 * **1. 送ったつもりのイベントが消えていた。** 呼び出し元は `useEffect` の中や
 * 遷移の直前で叩く (`product-view-tracker.tsx` / `article-read-tracker.tsx`)。
 * ページを離れると走っている `fetch` は**ブラウザに打ち切られる**ので、
 * 「見た直後に次へ進んだ」という最も普通の行動ほど記録に残らない。しかも返事を
 * 一切見ない作りなので、**打ち切られたこと自体がどこにも出ない**。
 * `sendBeacon` はこのために用意されている API で、離脱後もブラウザが送り切る。
 *
 * **2. 検査の視界の外で「画面からの書き込み」をしていた。** このファイルは
 * `"use client"` を持たない `.ts` なので、`mutation-through-shared-primitive` の
 * 網に入っていなかった (網羅表 A25)。網を到達可能性ベースに直した時点でここは
 * 違反として出る。
 *
 * ただし **2 を「例外表に 1 行足す」で畳むのは間違い**である。あのルールが守る
 * 4 つ (押した瞬間の反応・失敗時の巻き戻し・言い直し・連打の整理) は、行動ログ
 * には 1 つも当てはまらない — 誰も待っていないし、外れて困る画面も無い。
 * 「共通の通り道を通っていない」のではなく、**そもそも通り道に乗せる種類の
 * 書き込みではない**。だから逃げ道を作るのではなく、この用途に本来ふさわしい
 * プラットフォーム API へ移す。結果として fetch ではなくなるので、違反も
 * 例外表も残らない (構造で消す)。
 *
 * ## 失われるもの
 *
 * 応答が読めない。ただし**移行前も読んでいなかった** (`res.ok` を見る行が無く、
 * サーバの 400 はブラウザの console にしか出ていなかった。それが読了イベントを
 * 数か月落とした原因で、`__tests__/behavior-payload-contract.test.ts` はその穴を
 * 埋めるために在る)。送り手と受け口の突き合わせは引き続きそのテストが担う。
 */
function sendEvent(
  action: string,
  metadata: Record<string, string | number | undefined>,
): void {
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

  const beacon = globalThis.navigator?.sendBeacon?.bind(globalThis.navigator);
  if (!beacon) return;

  /* Blob の type がそのまま Content-Type になる。サーバ (`parseJsonBody`) は
     JSON を期待するので、ここを省くと `text/plain` で届いて弾かれる。
     cookie は sendBeacon が同一オリジンへ自動で付ける (credentials 指定は不要)。 */
  const body = new Blob([JSON.stringify({ action, channel: "web", metadata })], {
    type: "application/json",
  });

  let queued = false;
  try {
    queued = beacon("/api/user/behavior", body);
  } catch (err) {
    /* 画面は止めない。ただし送信が全滅してもパーソナライズの入力が静かに欠ける
       だけだったので、行動の中身ではなく種別だけを残す (憲章 R1)。 */
    logger.error("firebase.behavior-tracker.send-failed", err, { action });
    return;
  }

  /* `false` は「ブラウザが受け取りを拒んだ」(送信待ちが多すぎる等)。例外は
     投げられないので、ここを見ないと**静かに落ちる唯一の経路**になる。 */
  if (!queued) {
    logger.error(
      "firebase.behavior-tracker.send-failed",
      new Error("navigator.sendBeacon refused to queue the event"),
      { action },
    );
  }
}

/**
 * Track a page view (article or static content).
 */
export function trackPageView(params: TrackPageViewParams): void {
  sendEvent("view_content", {
    contentId: params.contentId,
    ...(params.category ? { query: params.category } : {}),
  });
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
  });
}

/**
 * Track a product detail page view.
 */
export function trackProductView(params: TrackProductViewParams): void {
  sendEvent("view_product", {
    productId: params.productId,
    ...(params.category ? { query: params.category } : {}),
  });
}

/**
 * Track when a user adds something to favorites.
 */
export function trackFavoriteAdd(params: TrackFavoriteAddParams): void {
  sendEvent("tap_button", {
    buttonLabel: `favorite_${params.type}`,
    ...(params.contentId ? { contentId: params.contentId } : {}),
    ...(params.productId ? { productId: params.productId } : {}),
  });
}

/**
 * Track a search query.
 */
export function trackSearch(params: TrackSearchParams): void {
  sendEvent("search", {
    query: params.query,
  });
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
  });
}
