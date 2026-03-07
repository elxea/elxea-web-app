"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useCart } from "./cart-context";
import { formatPrice } from "@/lib/utils";
import { Link } from "@/i18n/navigation";

export function CartContent() {
  const t = useTranslations("common");
  const { cart, updateQuantity, removeFromCart, isPending } = useCart();

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-muted text-[14px] mb-6">{t("emptyCart")}</p>
        <Link
          href="/products"
          className="inline-block border border-charcoal px-8 py-3 text-[13px] font-medium hover:bg-charcoal hover:text-cream transition-colors"
        >
          {t("products")}
        </Link>
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
              <div className="w-20 h-20 bg-surface flex-shrink-0">
                <Image
                  src={item.merchandise.product.featuredImage.url}
                  alt={
                    item.merchandise.product.featuredImage.altText ||
                    item.merchandise.product.title
                  }
                  width={80}
                  height={80}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Details */}
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-medium truncate">
                {item.merchandise.product.title}
              </p>
              {item.merchandise.title !== "Default Title" && (
                <p className="text-[13px] text-muted mt-0.5">
                  {item.merchandise.title}
                </p>
              )}
              <p className="text-[14px] mt-2">
                {formatPrice(
                  item.merchandise.price.amount,
                  item.merchandise.price.currencyCode
                )}
              </p>

              {/* Quantity */}
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={() =>
                    updateQuantity(
                      item.id,
                      item.merchandise.id,
                      item.quantity - 1
                    )
                  }
                  disabled={isPending}
                  className="w-8 h-8 border border-border text-[13px] hover:border-charcoal transition-colors disabled:opacity-50"
                >
                  -
                </button>
                <span className="text-[13px] w-6 text-center">
                  {item.quantity}
                </span>
                <button
                  onClick={() =>
                    updateQuantity(
                      item.id,
                      item.merchandise.id,
                      item.quantity + 1
                    )
                  }
                  disabled={isPending}
                  className="w-8 h-8 border border-border text-[13px] hover:border-charcoal transition-colors disabled:opacity-50"
                >
                  +
                </button>
              </div>
            </div>

            {/* Remove + Line total */}
            <div className="flex flex-col items-end justify-between">
              <button
                onClick={() => removeFromCart(item.id)}
                disabled={isPending}
                className="text-[12px] text-muted hover:text-charcoal transition-colors disabled:opacity-50"
              >
                {t("remove")}
              </button>
              <p className="text-[14px]">
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
      <div className="border-t border-border pt-6 mt-6">
        <div className="flex justify-between mb-6">
          <p className="text-[14px]">{t("subtotal")}</p>
          <p className="text-[14px] font-medium">
            {formatPrice(
              cart.cost.subtotalAmount.amount,
              cart.cost.subtotalAmount.currencyCode
            )}
          </p>
        </div>

        <a
          href={cart.checkoutUrl}
          className="block w-full h-12 bg-charcoal text-cream text-[14px] font-medium flex items-center justify-center hover:bg-charcoal/90 transition-colors"
        >
          {t("checkout")}
        </a>
      </div>
    </div>
  );
}
