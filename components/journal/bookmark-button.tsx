"use client";

import { useState, useEffect, useCallback } from "react";
import { Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { trackFavoriteAdd } from "@/lib/firebase/behavior-tracker";

type BookmarkButtonProps = {
  /** Sanity article slug — used as targetId in Firestore */
  articleSlug: string;
  /** Article title — stored for display in my-page */
  articleTitle: string;
  /** Article image URL — stored for quick display */
  articleImageUrl: string | null;
  /** Label text for screen readers */
  addLabel: string;
  /** Label text when already bookmarked */
  removeLabel: string;
  /** Toast message on add */
  addedMessage: string;
  /** Toast message on remove */
  removedMessage: string;
  /** Error toast message */
  errorMessage: string;
  /** Login required toast message */
  loginRequiredMessage: string;
  /** Optional className */
  className?: string;
};

export function BookmarkButton({
  articleSlug,
  articleTitle,
  articleImageUrl,
  addLabel,
  removeLabel,
  addedMessage,
  removedMessage,
  errorMessage,
  loginRequiredMessage,
  className,
}: BookmarkButtonProps) {
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecked, setIsChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkStatus() {
      try {
        const res = await fetch(
          `/api/user/favorites?check=${encodeURIComponent(articleSlug)}&checkType=article`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setIsBookmarked(data.favorited === true);
          setIsChecked(true);
        }
      } catch {
        // Silently fail
      }
    }

    if (typeof document !== "undefined" && document.cookie.includes("shop_auth=1")) {
      checkStatus();
    }

    return () => {
      cancelled = true;
    };
  }, [articleSlug]);

  const toggleBookmark = useCallback(async () => {
    if (typeof document !== "undefined" && !document.cookie.includes("shop_auth=1")) {
      toast(loginRequiredMessage);
      return;
    }

    setIsLoading(true);

    try {
      if (isBookmarked) {
        const res = await fetch("/api/user/favorites", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "article",
            targetId: articleSlug,
          }),
        });

        if (!res.ok) throw new Error("Failed to remove bookmark");

        setIsBookmarked(false);
        toast(removedMessage);
      } else {
        const res = await fetch("/api/user/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "article",
            targetId: articleSlug,
            title: articleTitle,
            imageUrl: articleImageUrl,
          }),
        });

        if (!res.ok) throw new Error("Failed to add bookmark");

        setIsBookmarked(true);
        toast(addedMessage);
        // Track favorite add behavior event
        trackFavoriteAdd({ contentId: articleSlug, type: "article" });
      }
    } catch {
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [
    isBookmarked,
    articleSlug,
    articleTitle,
    articleImageUrl,
    addedMessage,
    removedMessage,
    errorMessage,
    loginRequiredMessage,
  ]);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleBookmark}
      disabled={isLoading}
      aria-label={isBookmarked ? removeLabel : addLabel}
      aria-pressed={isBookmarked}
      className={cn(
        "transition-colors duration-200",
        isChecked ? "opacity-100" : "opacity-60",
        className
      )}
    >
      <Bookmark
        className={cn(
          "size-5 transition-colors duration-200",
          isBookmarked
            ? "fill-foreground text-foreground"
            : "fill-none text-muted-foreground"
        )}
      />
    </Button>
  );
}
