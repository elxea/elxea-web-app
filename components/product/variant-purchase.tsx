"use client";

import type { SellingPlanGroup } from "@/lib/shopify/types";

import { AddToCartButton } from "./add-to-cart-button";
import { ProductPurchaseOptions } from "./product-purchase-options";
import { useVariantSelection } from "./variant-selection-context";

/**
 * 購入導線 (定期便の選択 or 単品のカート追加)。
 *
 * カートに入れる先 (`merchandiseId`) と在庫・価格は**選択中の変種**で決まる。
 * ここも選択と同じ入れ物から読むので、押した瞬間に投入先まで切り替わる。
 * サーバから変種を受け取る作りに戻すと、枠だけ先に動いて投入先が往復ぶん
 * 遅れる = 一瞬だけ「前の変種を買う」状態が生まれるため、戻してはいけない。
 */
export function VariantPurchase({
  sellingPlanGroups,
  productName,
}: {
  sellingPlanGroups: SellingPlanGroup[];
  productName: string;
}) {
  const { selectedVariant } = useVariantSelection();
  if (!selectedVariant) return null;

  if (sellingPlanGroups.length > 0) {
    return (
      <ProductPurchaseOptions
        merchandiseId={selectedVariant.id}
        availableForSale={selectedVariant.availableForSale}
        sellingPlanGroups={sellingPlanGroups}
        sellingPlanAllocations={selectedVariant.sellingPlanAllocations}
        productName={productName}
        price={selectedVariant.price.amount}
        currencyCode={selectedVariant.price.currencyCode}
        subscriptionOnly
      />
    );
  }

  return (
    <AddToCartButton
      merchandiseId={selectedVariant.id}
      availableForSale={selectedVariant.availableForSale}
      productName={productName}
      price={selectedVariant.price.amount}
      currencyCode={selectedVariant.price.currencyCode}
    />
  );
}
