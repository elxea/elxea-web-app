"use client";

/**
 * ArticleReadTracker — invisible client component that fires behavior events
 * when a user views and reads an article.
 *
 * Events fired:
 *   1. view_content (page_view) — on mount
 *   2. view_content (article_read) — 可視時間が 30 秒に達したとき、または
 *      ページの 80% までスクロールしたとき (早い方)
 *
 * A6 で直した 2 点:
 * - バックグラウンドタブでも 30 秒で読了が立っていた。タブを開いたまま放置した
 *   だけの記事が「読んだ」として行動ログに入り、パーソナライズの入力が汚れる。
 *   → `visibilitychange` でタイマーを止め、可視だった時間だけを数える。
 * - 1 画面に収まる短い記事は `scrollHeight - innerHeight <= 0` でスクロール読了が
 *   永久に成立しなかった。→ スクロールでは判定不能と扱い、可視時間 30 秒で成立
 *   させる (判定ロジックは `lib/journal/read-tracking.ts` に切り出して単体テスト)。
 */

import { useEffect, useRef } from "react";
import { trackPageView, trackArticleRead } from "@/lib/firebase/behavior-tracker";
import { createVisibleTimer, scrollReadState } from "@/lib/journal/read-tracking";

type Props = {
  articleSlug: string;
  category?: string;
};

export function ArticleReadTracker({ articleSlug, category }: Props) {
  const readTrackedRef = useRef(false);

  useEffect(() => {
    // Fire page view event immediately on mount
    trackPageView({ contentId: articleSlug, category });

    const timer = createVisibleTimer();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function clearPending() {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    }

    function fireRead() {
      if (readTrackedRef.current) return;
      readTrackedRef.current = true;
      clearPending();
      trackArticleRead({
        contentId: articleSlug,
        category,
        durationSeconds: Math.round(timer.elapsedMs() / 1000),
      });
    }

    /** 可視中だけタイマーを張り直す。不可視なら張らない (時間が進まないため)。 */
    function schedule() {
      clearPending();
      if (readTrackedRef.current) return;
      const remaining = timer.remainingMs();
      if (remaining === null) return;
      timeoutId = setTimeout(fireRead, remaining);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        timer.pause();
        clearPending();
      } else {
        timer.resume();
        schedule();
      }
    }

    function onScroll() {
      if (readTrackedRef.current) return;
      const state = scrollReadState(
        window.scrollY,
        document.documentElement.scrollHeight,
        window.innerHeight
      );
      // `undecidable` (= 1 画面に収まる短い記事) は可視時間タイマーに委ねる。
      if (state === "read") fireRead();
    }

    // 初期状態。バックグラウンドで開かれたタブ (リンクの新規タブ開き等) は
    // 可視になるまで 1 秒も数えない。
    if (document.visibilityState === "visible") {
      timer.resume();
      schedule();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      clearPending();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("scroll", onScroll);
    };
  }, [articleSlug, category]);

  return null;
}
