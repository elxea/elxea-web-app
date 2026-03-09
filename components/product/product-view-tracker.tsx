"use client";

import { useEffect } from "react";
import { trackViewItem } from "@/lib/analytics";

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
    trackViewItem({ id, name, price, currency, brand, category, variant });
  }, [id, name, price, currency, brand, category, variant]);

  return null;
}
