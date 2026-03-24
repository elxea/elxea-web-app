"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Heart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

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
        // Silently fail
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
      <section className="mb-12">
        <h2 className="text-lg mb-6 pb-3 border-b border-border">{title}</h2>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 py-3 animate-pulse">
              <div className="w-14 h-14 bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted w-3/4" />
                <div className="h-3 bg-muted w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="mb-12">
      <h2 className="text-lg mb-6 pb-3 border-b border-border">{title}</h2>

      {items.length === 0 ? (
        <div className="flex items-center gap-3 text-muted-foreground">
          <Heart className="size-4" />
          <p className="text-sm">{emptyMessage}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-4 py-3 border-b border-border"
            >
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
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
