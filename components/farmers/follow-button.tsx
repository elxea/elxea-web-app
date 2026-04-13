"use client";

import { useState, useEffect, useCallback } from "react";
import { UserPlus, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Phase 1/2: treat either Shopify or LINE sessions as "logged in".
 * The follows API resolves identity across both providers, so the client
 * should surface the button for either auth cookie.
 */
function isAuthed() {
  if (typeof document === "undefined") return false;
  return (
    document.cookie.includes("shop_auth=1") ||
    document.cookie.includes("line_auth=1")
  );
}

type FollowButtonProps = {
  /** Sanity farmer slug — used as farmerSlug in Firestore */
  farmerSlug: string;
  /** Farmer display name — stored for my-page display */
  farmerName: string;
  /** Farmer profile image URL */
  farmerImageUrl: string | null;
  /** Label when not following */
  followLabel: string;
  /** Label when already following */
  unfollowLabel: string;
  /** Toast message on follow */
  followedMessage: string;
  /** Toast message on unfollow */
  unfollowedMessage: string;
  /** Error toast message */
  errorMessage: string;
  /** Login required toast message */
  loginRequiredMessage: string;
  /** Optional className */
  className?: string;
  /** Display variant */
  variant?: "icon" | "text";
};

export function FollowButton({
  farmerSlug,
  farmerName,
  farmerImageUrl,
  followLabel,
  unfollowLabel,
  followedMessage,
  unfollowedMessage,
  errorMessage,
  loginRequiredMessage,
  className,
  variant = "text",
}: FollowButtonProps) {
  const [isFollowing, setIsFollowing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecked, setIsChecked] = useState(false);

  // Check initial follow status
  useEffect(() => {
    let cancelled = false;

    async function checkStatus() {
      try {
        const res = await fetch(
          `/api/user/follows?check=${encodeURIComponent(farmerSlug)}`
        );
        if (!res.ok) return; // Not logged in — silently ignore
        const data = await res.json();
        if (!cancelled) {
          setIsFollowing(data.following === true);
          setIsChecked(true);
        }
      } catch {
        // Silently fail
      }
    }

    if (isAuthed()) {
      checkStatus();
    }

    return () => {
      cancelled = true;
    };
  }, [farmerSlug]);

  const toggleFollow = useCallback(async () => {
    if (!isAuthed()) {
      toast(loginRequiredMessage);
      return;
    }

    setIsLoading(true);

    try {
      if (isFollowing) {
        const res = await fetch("/api/user/follows", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ farmerSlug }),
        });

        if (!res.ok) throw new Error("Failed to unfollow");

        setIsFollowing(false);
        toast(unfollowedMessage);
      } else {
        const res = await fetch("/api/user/follows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            farmerSlug,
            farmerName,
            farmerImageUrl,
          }),
        });

        if (!res.ok) throw new Error("Failed to follow");

        setIsFollowing(true);
        toast(followedMessage);
      }
    } catch {
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [
    isFollowing,
    farmerSlug,
    farmerName,
    farmerImageUrl,
    followedMessage,
    unfollowedMessage,
    errorMessage,
    loginRequiredMessage,
  ]);

  if (variant === "icon") {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleFollow}
        disabled={isLoading}
        aria-label={isFollowing ? unfollowLabel : followLabel}
        aria-pressed={isFollowing}
        className={cn(
          "transition-colors duration-200",
          isChecked ? "opacity-100" : "opacity-60",
          className
        )}
      >
        {isFollowing ? (
          <UserCheck className="size-5 text-foreground" />
        ) : (
          <UserPlus className="size-5 text-muted-foreground" />
        )}
      </Button>
    );
  }

  return (
    <Button
      variant={isFollowing ? "outline" : "default"}
      size="sm"
      onClick={toggleFollow}
      disabled={isLoading}
      aria-label={isFollowing ? unfollowLabel : followLabel}
      aria-pressed={isFollowing}
      className={cn("gap-2 transition-all duration-200", className)}
    >
      {isFollowing ? (
        <UserCheck className="size-4" />
      ) : (
        <UserPlus className="size-4" />
      )}
      {isFollowing ? unfollowLabel : followLabel}
    </Button>
  );
}
