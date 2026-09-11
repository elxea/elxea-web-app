"use client";

import { useState, useEffect } from "react";
import { Heart, Users, Calendar, ShoppingBag, RefreshCw } from "lucide-react";
import Link from "next/link";

type DashboardCounts = {
  favorites: number;
  follows: number;
  eventRegistrations: number;
};

type DashboardSummaryProps = {
  orderCount: number;
  subscriptionCount: number;
  labels: {
    favorites: string;
    follows: string;
    events: string;
    orders: string;
    subscriptions: string;
  };
  links?: {
    subscriptions?: string;
    orders?: string;
  };
};

export function DashboardSummary({
  orderCount,
  subscriptionCount,
  labels,
  links,
}: DashboardSummaryProps) {
  const [counts, setCounts] = useState<DashboardCounts | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchCounts() {
      try {
        const res = await fetch("/api/user/dashboard");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setCounts({
            favorites: data.favorites?.length ?? 0,
            follows: data.follows?.length ?? 0,
            eventRegistrations: data.eventRegistrations?.length ?? 0,
          });
        }
      } catch {
        // Silently fail
      }
    }

    if (typeof document !== "undefined" && document.cookie.includes("shop_auth=1")) {
      fetchCounts();
    }

    return () => {
      cancelled = true;
    };
  }, []);

  type DashboardItem = {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    count: number;
    loading: boolean;
    href?: string;
  };

  const items: DashboardItem[] = [
    {
      icon: Heart,
      label: labels.favorites,
      count: counts?.favorites ?? 0,
      loading: counts === null,
    },
    {
      icon: Users,
      label: labels.follows,
      count: counts?.follows ?? 0,
      loading: counts === null,
    },
    {
      icon: Calendar,
      label: labels.events,
      count: counts?.eventRegistrations ?? 0,
      loading: counts === null,
    },
    {
      icon: ShoppingBag,
      label: labels.orders,
      count: orderCount,
      loading: false,
      href: links?.orders,
    },
    {
      icon: RefreshCw,
      label: labels.subscriptions,
      count: subscriptionCount,
      loading: false,
      href: links?.subscriptions,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-12">
      {items.map((item) => {
        const content = (
          <>
            <item.icon className="size-5 mx-auto mb-2 text-muted-foreground" />
            {item.loading ? (
              <p className="text-2xl font-light animate-pulse">--</p>
            ) : (
              <p className="text-2xl font-light">{item.count}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">{item.label}</p>
          </>
        );

        if (item.href) {
          return (
            <Link
              key={item.label}
              href={item.href}
              className="border border-border p-4 text-center hover:border-foreground/30 transition-colors"
            >
              {content}
            </Link>
          );
        }

        return (
          <div
            key={item.label}
            className="border border-border p-4 text-center"
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
