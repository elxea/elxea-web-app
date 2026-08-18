"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Heart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import {
  AccountPanelEmpty,
  AccountPanelList,
  AccountPanelRow,
  AccountPanelSection,
  AccountPanelSkeleton,
} from "@/components/account/account-panel";

type FavoriteItem = {
  id: string;
  type: "product" | "article";
  targetId: string;
  title: string;
  imageUrl: string | null;
  createdAt: string | null;
};

type FavoritesSectionProps = {
  type: "product" | "article";
  title: string;
  emptyMessage: string;
  errorMessage: string;
  removedMessage: string;
  locale: string;
  productBaseUrl: string;
  articleBaseUrl: string;
};

export function FavoritesSection({
  type,
  title,
  emptyMessage,
  errorMessage,
  removedMessage,
  locale,
  productBaseUrl,
  articleBaseUrl,
}: FavoritesSectionProps) {
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchFavorites() {
      try {
        const res = await fetch(`/api/user/favorites?type=${type}`);
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        if (!cancelled) {
          setItems(data.favorites ?? []);
        }
      } catch {
        // Silently fail — empty state is shown
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchFavorites();

    return () => {
      cancelled = true;
    };
  }, [type]);

  async function handleRemove(item: FavoriteItem) {
    setRemovingId(item.id);

    try {
      const res = await fetch("/api/user/favorites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: item.type,
          targetId: item.targetId,
        }),
      });

      if (!res.ok) throw new Error("Failed to remove");

      setItems((prev) => prev.filter((i) => i.id !== item.id));
      toast(removedMessage);
    } catch {
      toast.error(errorMessage);
    } finally {
      setRemovingId(null);
    }
  }

  const baseUrl = type === "product" ? productBaseUrl : articleBaseUrl;

  if (isLoading) {
    return (
      <AccountPanelSection title={title}>
        <AccountPanelSkeleton rows={3} thumbClassName="w-14 h-14" />
      </AccountPanelSection>
    );
  }

  return (
    <AccountPanelSection title={title}>
      {items.length === 0 ? (
        <AccountPanelEmpty
          icon={<Heart className="size-4" />}
          message={emptyMessage}
        />
      ) : (
        <AccountPanelList>
          {items.map((item) => (
            <AccountPanelRow key={item.id} divided>
              <a
                href={`/${locale}${baseUrl}/${item.targetId}`}
                className="shrink-0"
              >
                {item.imageUrl ? (
                  <Image
                    src={item.imageUrl}
                    alt={item.title}
                    width={56}
                    height={56}
                    className="w-14 h-14 object-cover"
                  />
                ) : (
                  <div className="w-14 h-14 bg-muted flex items-center justify-center text-xs text-muted-foreground">
                    —
                  </div>
                )}
              </a>
              <a
                href={`/${locale}${baseUrl}/${item.targetId}`}
                className="flex-1 min-w-0"
              >
                <p className="text-sm truncate hover:underline">{item.title}</p>
                {item.createdAt && (
                  <p className="text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleDateString(locale, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                )}
              </a>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => handleRemove(item)}
                disabled={removingId === item.id}
                aria-label={`Remove ${item.title}`}
              >
                <Trash2 className="size-3.5 text-muted-foreground" />
              </Button>
            </AccountPanelRow>
          ))}
        </AccountPanelList>
      )}
    </AccountPanelSection>
  );
}
