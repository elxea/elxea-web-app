"use client";

import { useTranslations } from "next-intl";
import { useCart } from "@/components/cart/cart-context";
import { Button } from "@/components/ui/button";
import { trackAddToCart } from "@/lib/analytics";

export function AddToCartButton({
  merchandiseId,
  availableForSale,
  sellingPlanId,
  productName,
  price,
  currencyCode,
}: {
  merchandiseId: string;
  availableForSale: boolean;
  sellingPlanId?: string;
  productName?: string;
  price?: string;
  currencyCode?: string;
}) {
  const t = useTranslations("common");
  const { addToCart, isPending } = useCart();

  if (!availableForSale) {
    return (
      <Button variant="secondary" size="lg" className="w-full h-12" disabled>
        {t("soldOut")}
      </Button>
    );
  }

  return (
    <Button
      size="lg"
      className="w-full h-12"
      onClick={() => {
        trackAddToCart({
          id: merchandiseId,
          name: productName || "",
          price: parseFloat(price || "0"),
          currency: currencyCode || "JPY",
          quantity: 1,
        });
        addToCart(merchandiseId, 1, sellingPlanId);
      }}
      disabled={isPending}
    >
      {isPending ? "..." : sellingPlanId ? t("subscribe") : t("addToCart")}
    </Button>
  );
}
