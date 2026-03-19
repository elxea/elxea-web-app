"use client";

import { useTranslations } from "next-intl";
import { useCart } from "@/components/cart/cart-context";

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
      <button
        disabled
        className="w-full h-12 bg-muted text-muted-foreground text-[14px] font-medium cursor-not-allowed"
      >
        {t("soldOut")}
      </button>
    );
  }

  return (
    <button
      onClick={() => addToCart(merchandiseId, 1, sellingPlanId)}
      disabled={isPending}
      className="w-full h-12 border border-foreground bg-foreground text-background text-[14px] font-medium hover:bg-transparent hover:text-foreground transition-colors disabled:opacity-50"
    >
      {isPending ? "..." : t("addToCart")}
    </button>
  );
}
