"use client";

import { useTranslations } from "next-intl";
import { useCart } from "@/components/cart/cart-context";
import { Button } from "@/components/ui/button";

export function AddToCartButton({
  merchandiseId,
  availableForSale,
}: {
  merchandiseId: string;
  availableForSale: boolean;
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
      onClick={() => addToCart(merchandiseId)}
      disabled={isPending}
    >
      {isPending ? "..." : t("addToCart")}
    </Button>
  );
}
