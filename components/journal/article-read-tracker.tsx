"use client";

/**
 * ArticleReadTracker — invisible client component that fires behavior events
 * when a user views and reads an article.
 *
 * Events fired:
 *   1. view_content (page_view) — on mount
 *   2. view_content (article_read) — after 30s or when 80% of page is scrolled
 *      (whichever comes first), indicating genuine read intent
 */

import { useEffect, useRef } from "react";
import { trackPageView, trackArticleRead } from "@/lib/firebase/behavior-tracker";

type Props = {
  articleSlug: string;
  category?: string;
};

export function ArticleReadTracker({ articleSlug, category }: Props) {
  const readTrackedRef = useRef(false);

  useEffect(() => {
    // Fire page view event immediately on mount
    trackPageView({ contentId: articleSlug, category });

    // Track article read: either 30 seconds elapsed or 80% scroll depth
    const timer = setTimeout(() => {
      if (!readTrackedRef.current) {
        readTrackedRef.current = true;
        trackArticleRead({
          contentId: articleSlug,
          category,
          durationSeconds: 30,
        });
      }
    }, 30_000);

    // Scroll depth tracking (80% threshold)
    function onScroll() {
      if (readTrackedRef.current) return;
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;
      const scrollPercent = scrollTop / docHeight;
      if (scrollPercent >= 0.8) {
        readTrackedRef.current = true;
        clearTimeout(timer);
        trackArticleRead({
          contentId: articleSlug,
          category,
        });
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [articleSlug, category]);

  return null;
}
