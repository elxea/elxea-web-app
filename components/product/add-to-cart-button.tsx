"use client";

import { useTranslations } from "next-intl";
import { useCart } from "@/components/cart/cart-context";

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
      <button
        disabled
        className="w-full h-12 bg-light text-cream text-[14px] font-medium cursor-not-allowed"
      >
        {t("soldOut")}
      </button>
    );
  }

  return (
    <button
      onClick={() => addToCart(merchandiseId)}
      disabled={isPending}
      className="w-full h-12 bg-charcoal text-cream text-[14px] font-medium hover:bg-charcoal/90 transition-colors disabled:opacity-50"
    >
      {isPending ? "..." : t("addToCart")}
    </button>
  );
}
