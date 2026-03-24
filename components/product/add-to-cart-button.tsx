"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useCart } from "@/components/cart/cart-context";
import { toast } from "sonner";

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
  const router = useRouter();
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
      onClick={async () => {
        await addToCart(merchandiseId, 1, sellingPlanId);
        toast(t("addedToCart"), {
          action: {
            label: t("viewCart"),
            onClick: () => router.push("/cart"),
          },
        });
      }}
      disabled={isPending}
      className="w-full h-12 border border-foreground bg-foreground text-background text-[14px] font-medium hover:bg-transparent hover:text-foreground transition-colors disabled:opacity-50"
    >
      {isPending ? "..." : t("addToCart")}
    </button>
  );
}
