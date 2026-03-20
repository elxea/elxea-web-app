"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useCart } from "./cart-context";
import { formatPrice } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { trackBeginCheckout, trackRemoveFromCart } from "@/lib/analytics";
import { toast } from "sonner";

export function CartContent() {
  const t = useTranslations("common");
  const { cart, updateQuantity, removeFromCart, isPending } = useCart();

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground text-sm mb-6">{t("emptyCart")}</p>
        <Button variant="outline" asChild>
          <Link href="/products">{t("products")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Lines */}
      <div className="divide-y divide-border">
        {cart.lines.map((item) => (
          <div key={item.id} className="py-6 flex gap-6">
            {/* Image */}
            {item.merchandise.product.featuredImage && (
              <div className="w-20 h-20 bg-muted flex-shrink-0 rounded-md overflow-hidden">
                <Image
                  src={item.merchandise.product.featuredImage.url}
                  alt={
                    item.merchandise.product.featuredImage.altText ||
                    item.merchandise.product.title
                  }
                  width={80}
                  height={80}
                  sizes="80px"
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Details */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {item.merchandise.product.title}
              </p>
              {item.merchandise.title !== "Default Title" && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {item.merchandise.title}
                </p>
              )}
              {item.sellingPlanAllocation && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {item.sellingPlanAllocation.sellingPlan.name}
                </p>
              )}
              <p className="text-sm mt-2">
                {formatPrice(
                  item.merchandise.price.amount,
                  item.merchandise.price.currencyCode
                )}
              </p>

              {/* Quantity */}
              <div className="flex items-center gap-1 mt-3">
                <Button
                  variant="outline"
                  size="icon-xs"
                  onClick={() =>
                    updateQuantity(
                      item.id,
                      item.merchandise.id,
                      item.quantity - 1
                    )
                  }
                  disabled={isPending}
                  aria-label={`${t("quantity")} -1`}
                >
                  -
                </Button>
                <span className="text-sm w-8 text-center" aria-label={t("quantity")}>
                  {item.quantity}
                </span>
                <Button
                  variant="outline"
                  size="icon-xs"
                  onClick={() =>
                    updateQuantity(
                      item.id,
                      item.merchandise.id,
                      item.quantity + 1
                    )
                  }
                  disabled={isPending}
                  aria-label={`${t("quantity")} +1`}
                >
                  +
                </Button>
              </div>
            </div>

            {/* Remove + Line total */}
            <div className="flex flex-col items-end justify-between">
              <Button
                variant="link"
                size="sm"
                className="text-muted-foreground h-auto p-0"
                onClick={async () => {
                  trackRemoveFromCart({
                    id: item.merchandise.id,
                    name: item.merchandise.product.title,
                    price: parseFloat(item.merchandise.price.amount),
                    currency: item.merchandise.price.currencyCode,
                    quantity: item.quantity,
                  });
                  await removeFromCart(item.id);
                  toast(t("removedFromCart"));
                }}
                disabled={isPending}
              >
                {t("remove")}
              </Button>
              <p className="text-sm">
                {formatPrice(
                  item.cost.totalAmount.amount,
                  item.cost.totalAmount.currencyCode
                )}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <Separator className="mt-6" />
      <div className="pt-6">
        <div className="flex justify-between mb-6">
          <p className="text-sm">{t("subtotal")}</p>
          <p className="text-sm font-medium">
            {formatPrice(
              cart.cost.subtotalAmount.amount,
              cart.cost.subtotalAmount.currencyCode
            )}
          </p>
        </div>

        <Button
          size="lg"
          className="w-full h-12"
          asChild
          onClick={() => {
            trackBeginCheckout(
              cart.lines.map((item) => ({
                id: item.merchandise.id,
                name: item.merchandise.product.title,
                price: parseFloat(item.merchandise.price.amount),
                quantity: item.quantity,
              })),
              cart.cost.subtotalAmount.currencyCode,
              parseFloat(cart.cost.subtotalAmount.amount)
            );
          }}
        >
          <a href={cart.checkoutUrl.replace("https://elxea.com/", "https://elxea.myshopify.com/")}>
            {t("checkout")}
          </a>
        </Button>
      </div>
    </div>
  );
}
