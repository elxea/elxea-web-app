"use client";

import { useEffect } from "react";
import { trackViewItem } from "@/lib/analytics";
import { trackProductView } from "@/lib/firebase/behavior-tracker";

export function ProductViewTracker({
  id,
  name,
  price,
  currency,
  brand,
  category,
  variant,
}: {
  id: string;
  name: string;
  price: number;
  currency: string;
  brand?: string;
  category?: string;
  variant?: string;
}) {
  useEffect(() => {
    // GTM analytics tracking
    trackViewItem({ id, name, price, currency, brand, category, variant });
    // Firestore behavior event tracking
    trackProductView({ productId: id, title: name, category });
  }, [id, name, price, currency, brand, category, variant]);

  return null;
}
