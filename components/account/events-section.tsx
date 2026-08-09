"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Calendar, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import {
  AccountPanelEmpty,
  AccountPanelList,
  AccountPanelRow,
  AccountPanelSection,
  AccountPanelSkeleton,
} from "@/components/account/account-panel";

type EventItem = {
  id: string;
  eventSlug: string;
  eventTitle: string;
  eventDate: string | null;
  eventImageUrl: string | null;
  registeredAt: string | null;
};

type EventsSectionProps = {
  title: string;
  emptyMessage: string;
  errorMessage: string;
  cancelledMessage: string;
  locale: string;
};

export function EventsSection({
  title,
  emptyMessage,
  errorMessage,
  cancelledMessage,
  locale,
}: EventsSectionProps) {
  const [items, setItems] = useState<EventItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchRegistrations() {
      try {
        const res = await fetch("/api/user/events");
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        if (!cancelled) {
          setItems(data.registrations ?? []);
        }
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchRegistrations();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCancel(item: EventItem) {
    setRemovingId(item.id);

    try {
      const res = await fetch("/api/user/events", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventSlug: item.eventSlug }),
      });

      if (!res.ok) throw new Error("Failed to cancel");

      setItems((prev) => prev.filter((i) => i.id !== item.id));
      toast(cancelledMessage);
    } catch {
      toast.error(errorMessage);
    } finally {
      setRemovingId(null);
    }
  }

  if (isLoading) {
    return (
      <AccountPanelSection title={title}>
        <AccountPanelSkeleton rows={2} thumbClassName="w-14 h-14" />
      </AccountPanelSection>
    );
  }

  return (
    <AccountPanelSection title={title}>
      {items.length === 0 ? (
        <AccountPanelEmpty
          icon={<Calendar className="size-4" />}
          message={emptyMessage}
        />
      ) : (
        <AccountPanelList>
          {items.map((item) => (
            <AccountPanelRow key={item.id} divided>
              <a
                href={`/${locale}/events/${item.eventSlug}`}
                className="shrink-0"
              >
                {item.eventImageUrl ? (
                  <Image
                    src={item.eventImageUrl}
                    alt={item.eventTitle}
                    width={56}
                    height={56}
                    className="w-14 h-14 object-cover"
                  />
                ) : (
                  <div className="w-14 h-14 bg-muted flex items-center justify-center text-muted-foreground">
                    <Calendar className="size-5" />
                  </div>
                )}
              </a>
              <a
                href={`/${locale}/events/${item.eventSlug}`}
                className="flex-1 min-w-0"
              >
                <p className="text-sm truncate hover:underline">
                  {item.eventTitle}
                </p>
                {item.eventDate && (
                  <p className="text-xs text-muted-foreground">
                    {new Date(item.eventDate).toLocaleDateString(locale, {
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
                onClick={() => handleCancel(item)}
                disabled={removingId === item.id}
                aria-label={`Cancel ${item.eventTitle}`}
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
