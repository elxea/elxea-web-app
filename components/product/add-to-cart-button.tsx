"use client";

import { useTranslations } from "next-intl";
import { useCart } from "@/components/cart/cart-context";
import { trackAddToCart } from "@/lib/analytics";
import { Button } from "@/components/ui/button";

export function AddToCartButton({
  merchandiseId,
  availableForSale,
  productName,
  price,
  currency,
  variant,
}: {
  merchandiseId: string;
  availableForSale: boolean;
  productName: string;
  price: string;
  currency: string;
  variant?: string;
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
        addToCart(merchandiseId);
        trackAddToCart({
          id: merchandiseId,
          name: productName,
          price: parseFloat(price),
          currency,
          quantity: 1,
          variant,
        });
      }}
      disabled={isPending}
    >
      {isPending ? "..." : t("addToCart")}
    </Button>
  );
}
