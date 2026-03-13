"use client";

import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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
  const locale = useLocale();
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
      onClick={async () => {
        trackAddToCart({
          id: merchandiseId,
          name: productName || "",
          price: parseFloat(price || "0"),
          currency: currencyCode || "JPY",
          quantity: 1,
        });
        await addToCart(merchandiseId, 1, sellingPlanId);
        toast(t("addedToCart"), {
          action: {
            label: t("viewCart"),
            onClick: () => {
              window.location.href = `/${locale}/cart`;
            },
          },
        });
      }}
      disabled={isPending}
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : sellingPlanId ? t("subscribe") : t("addToCart")}
    </Button>
  );
}
