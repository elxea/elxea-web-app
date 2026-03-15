"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Users, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type FollowItem = {
  id: string;
  farmerSlug: string;
  farmerName: string;
  farmerImageUrl: string | null;
  createdAt: string | null;
};

type FollowsSectionProps = {
  title: string;
  emptyMessage: string;
  errorMessage: string;
  removedMessage: string;
  locale: string;
};

export function FollowsSection({
  title,
  emptyMessage,
  errorMessage,
  removedMessage,
  locale,
}: FollowsSectionProps) {
  const [items, setItems] = useState<FollowItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchFollows() {
      try {
        const res = await fetch("/api/user/follows");
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        if (!cancelled) {
          setItems(data.follows ?? []);
        }
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchFollows();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUnfollow(item: FollowItem) {
    setRemovingId(item.id);

    try {
      const res = await fetch("/api/user/follows", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ farmerSlug: item.farmerSlug }),
      });

      if (!res.ok) throw new Error("Failed to unfollow");

      setItems((prev) => prev.filter((i) => i.id !== item.id));
      toast(removedMessage);
    } catch {
      toast.error(errorMessage);
    } finally {
      setRemovingId(null);
    }
  }

  if (isLoading) {
    return (
      <section className="mb-12">
        <h2 className="text-lg mb-6 pb-3 border-b border-border">{title}</h2>
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 py-3 animate-pulse">
              <div className="w-10 h-10 bg-muted rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted w-1/2" />
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
          <Users className="size-4" />
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
                href={`/${locale}/farmers/${item.farmerSlug}`}
                className="shrink-0"
              >
                {item.farmerImageUrl ? (
                  <Image
                    src={item.farmerImageUrl}
                    alt={item.farmerName}
                    width={40}
                    height={40}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center text-xs text-muted-foreground">
                    <Users className="size-4" />
                  </div>
                )}
              </a>
              <a
                href={`/${locale}/farmers/${item.farmerSlug}`}
                className="flex-1 min-w-0"
              >
                <p className="text-sm truncate hover:underline">
                  {item.farmerName}
                </p>
              </a>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => handleUnfollow(item)}
                disabled={removingId === item.id}
                aria-label={`Unfollow ${item.farmerName}`}
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
