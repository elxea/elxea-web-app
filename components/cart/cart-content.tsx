"use client";

import { useTranslations } from "next-intl";

import { useCart } from "./cart-context";
import { CartLine } from "./cart-line";
import { OrderSummary } from "./order-summary";
import { Button } from "@/components/ui/button";
import { bodySmClass } from "@/components/editorial/rule-list";
import { Link } from "@/i18n/navigation";
import { trackBeginCheckout, trackRemoveFromCart } from "@/lib/analytics";
import { formatPrice, cn } from "@/lib/utils";
import type { CartItem } from "@/lib/shopify/types";
import { toast } from "sonner";

/**
 * CartContent —【R2: 確定版】カート 変A（部品ベース）6679:14041。
 *
 * - 商品あり (Figma `CartContent (Module) / State=filled` 6844:124 /
 *   PC `CartBody` 6684:162 / SP 6686:14185)
 * - 空カート (Figma `CartContent (Module) / State=empty` 6845:17103)
 *
 * 行部品は `CartLine`、サマリー枠は `OrderSummary`、数量ステッパは
 * `components/ui/quantity-stepper.tsx` に切り出してある (Storybook / 将来の
 * ミニカートで再利用するため)。本ファイルは Storefront Cart との配線のみを持つ。
 *
 * レイアウト (Figma 実測 → 実装):
 * - PC `CartBody` 横並び gap 48 / items-start   → `lg:flex-row lg:items-start lg:gap-12`
 * - SP 縦積み、明細 → サマリー gap 40           → `flex-col gap-10`
 * - 明細は `divide-y divide-border` の 1px 罫線 (Figma `Divider` 6684:143 / 6686:14207)
 */
export function CartContent() {
  const t = useTranslations("common");
  const { cart, updateQuantity, removeFromCart, isPending } = useCart();

  if (!cart || cart.lines.length === 0) {
    /* Figma 6845:17103 — 中央寄せ / 上下余白 80 / gap 24 / outline ボタン。 */
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-20 text-center">
        <p className={cn(bodySmClass, "text-muted-foreground")}>{t("emptyCart")}</p>
        <Button variant="outline" asChild>
          <Link href="/products">{t("products")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-12">
      {/* 書き込みが走っているあいだ、行の操作は `disabled` で止まる。見た目の
          薄さだけでは支援技術に何も伝わらないので、`aria-busy` で「いま処理中」
          であることを明示する (監査 #15 の「進行表示が無い」の読み上げ側)。 */}
      <ul
        data-slot="cart-lines"
        aria-busy={isPending}
        className="divide-border min-w-0 flex-1 divide-y"
      >
        {cart.lines.map((item) => (
          <CartLine
            key={item.id}
            imageUrl={item.merchandise.product.featuredImage?.url}
            imageAlt={
              item.merchandise.product.featuredImage?.altText ||
              item.merchandise.product.title
            }
            title={item.merchandise.product.title}
            variantLabel={variantLabel(item)}
            planLabel={
              item.sellingPlanAllocation
                ? `${t("subscription")}: ${item.sellingPlanAllocation.sellingPlan.name}`
                : null
            }
            unitPrice={formatPrice(
              item.merchandise.price.amount,
              item.merchandise.price.currencyCode,
            )}
            linePrice={formatPrice(
              item.cost.totalAmount.amount,
              item.cost.totalAmount.currencyCode,
            )}
            quantity={item.quantity}
            disabled={isPending}
            quantityLabel={t("quantity")}
            removeLabel={t("remove")}
            onQuantityChange={(next) =>
              updateQuantity(item.id, item.merchandise.id, next)
            }
            onRemove={async () => {
              trackRemoveFromCart({
                id: item.merchandise.id,
                name: item.merchandise.product.title,
                price: parseFloat(item.merchandise.price.amount),
                currency: item.merchandise.price.currencyCode,
                quantity: item.quantity,
              });
              /* 着地を待たずに知らせる (監査 #15 / 2026-08-25)。
                 以前は `await removeFromCart(...)` の**後**にトーストを出して
                 いたので、行が消えたあとの本番実測 4.3 秒は「消えたけれど本当に
                 消えたのか分からない」無言の時間だった。しかも着地の成否に
                 関わらず「削除しました」と言い切っていたので、失敗して行が
                 戻ってきたときに**嘘だけが残る**。
                 いまは押した瞬間に知らせ、外れたときだけ言い直す
                 (`AddToCartButton` と同じ約束)。 */
              const pending = removeFromCart(item.id);
              toast(t("removedFromCart"));
              if ((await pending) === "failed") {
                toast.error(t("removeFromCartFailed"));
              }
            }}
          />
        ))}
      </ul>

      <OrderSummary
        heading={t("orderSummary")}
        subtotalLabel={t("subtotal")}
        subtotal={formatPrice(
          cart.cost.subtotalAmount.amount,
          cart.cost.subtotalAmount.currencyCode,
        )}
        totalLabel={t("total")}
        total={formatPrice(
          cart.cost.totalAmount.amount,
          cart.cost.totalAmount.currencyCode,
        )}
        checkoutLabel={t("checkout")}
        checkoutUrl={cart.checkoutUrl}
        onCheckout={() =>
          trackBeginCheckout(
            cart.lines.map((item) => ({
              id: item.merchandise.id,
              name: item.merchandise.product.title,
              price: parseFloat(item.merchandise.price.amount),
              quantity: item.quantity,
            })),
            cart.cost.subtotalAmount.currencyCode,
            parseFloat(cart.cost.subtotalAmount.amount),
          )
        }
      />
    </div>
  );
}

/**
 * Figma の「内容量: 100g」行。Shopify の `selectedOptions` をそのまま
 * `名前: 値` で並べる (ラベルをコードに焼かない)。単一バリアント商品は
 * Shopify が `Title / Default Title` を返すので落とす。
 */
function variantLabel(item: CartItem): string | null {
  const options = item.merchandise.selectedOptions.filter(
    (option) => option.name !== "Title" && option.value !== "Default Title",
  );
  if (options.length > 0) {
    return options.map((option) => `${option.name}: ${option.value}`).join(" / ");
  }
  return item.merchandise.title !== "Default Title" ? item.merchandise.title : null;
}
