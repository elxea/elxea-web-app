"use client";

import { useState, useEffect, useCallback } from "react";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Phase 1/2: treat either Shopify or LINE sessions as "logged in".
 * The favorites API resolves identity across both providers, so the client
 * should surface the button for either auth cookie.
 */
function isAuthed() {
  if (typeof document === "undefined") return false;
  return (
    document.cookie.includes("shop_auth=1") ||
    document.cookie.includes("line_auth=1")
  );
}

type FavoriteButtonProps = {
  /** Shopify product handle — used as targetId in Firestore */
  productHandle: string;
  /** Product title — stored for display in my-page without re-fetching */
  productTitle: string;
  /** Product image URL — stored for quick display */
  productImageUrl: string | null;
  /** Label text for screen readers and tooltip */
  addLabel: string;
  /** Label text when already favorited */
  removeLabel: string;
  /** Toast message on add */
  addedMessage: string;
  /** Toast message on remove */
  removedMessage: string;
  /** Error toast message */
  errorMessage: string;
  /** Login required toast message */
  loginRequiredMessage: string;
  /** Optional className for the wrapper */
  className?: string;
  /** Display variant */
  variant?: "icon" | "text";
};

export function FavoriteButton({
  productHandle,
  productTitle,
  productImageUrl,
  addLabel,
  removeLabel,
  addedMessage,
  removedMessage,
  errorMessage,
  loginRequiredMessage,
  className,
  variant = "icon",
}: FavoriteButtonProps) {
  const [isFavorited, setIsFavorited] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecked, setIsChecked] = useState(false);

  // Check initial favorite status
  useEffect(() => {
    let cancelled = false;

    async function checkStatus() {
      try {
        const res = await fetch(
          `/api/user/favorites?check=${encodeURIComponent(productHandle)}&checkType=product`
        );
        if (!res.ok) return; // Not logged in or other error — silently ignore
        const data = await res.json();
        if (!cancelled) {
          setIsFavorited(data.favorited === true);
          setIsChecked(true);
        }
      } catch {
        // Silently fail — button will show unfavorited state
      }
    }

    // Only check if any auth cookie exists (non-httpOnly flag).
    if (isAuthed()) {
      checkStatus();
    }

    return () => {
      cancelled = true;
    };
  }, [productHandle]);

  const toggleFavorite = useCallback(async () => {
    // Check if user is logged in via any supported auth cookie.
    if (!isAuthed()) {
      toast(loginRequiredMessage);
      return;
    }

    setIsLoading(true);

    try {
      if (isFavorited) {
        const res = await fetch("/api/user/favorites", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "product",
            targetId: productHandle,
          }),
        });

        if (!res.ok) throw new Error("Failed to remove favorite");

        setIsFavorited(false);
        toast(removedMessage);
      } else {
        const res = await fetch("/api/user/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "product",
            targetId: productHandle,
            title: productTitle,
            imageUrl: productImageUrl,
          }),
        });

        if (!res.ok) throw new Error("Failed to add favorite");

        setIsFavorited(true);
        toast(addedMessage);
      }
    } catch {
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [
    isFavorited,
    productHandle,
    productTitle,
    productImageUrl,
    addedMessage,
    removedMessage,
    errorMessage,
    loginRequiredMessage,
  ]);

  if (variant === "text") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={toggleFavorite}
        disabled={isLoading}
        aria-label={isFavorited ? removeLabel : addLabel}
        aria-pressed={isFavorited}
        className={cn("gap-2", className)}
      >
        <Heart
          className={cn(
            "size-4 transition-colors duration-200",
            isFavorited
              ? "fill-red-500 text-red-500"
              : "fill-none text-current"
          )}
        />
        {isFavorited ? removeLabel : addLabel}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleFavorite}
      disabled={isLoading}
      aria-label={isFavorited ? removeLabel : addLabel}
      aria-pressed={isFavorited}
      className={cn(
        "transition-colors duration-200",
        isChecked ? "opacity-100" : "opacity-60",
        className
      )}
    >
      <Heart
        className={cn(
          "size-5 transition-colors duration-200",
          isFavorited
            ? "fill-red-500 text-red-500"
            : "fill-none text-muted-foreground"
        )}
      />
    </Button>
  );
}
