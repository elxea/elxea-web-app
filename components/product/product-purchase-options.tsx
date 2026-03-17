"use client";

import { useState } from "react";
import { SellingPlanSelector } from "./selling-plan-selector";
import { AddToCartButton } from "./add-to-cart-button";
import { formatPrice } from "@/lib/utils";
import type { SellingPlanGroup, SellingPlanAllocation } from "@/lib/shopify/types";

export function ProductPurchaseOptions({
  merchandiseId,
  availableForSale,
  sellingPlanGroups,
  sellingPlanAllocations,
  productName,
  price,
  currencyCode,
  subscriptionOnly = false,
}: {
  merchandiseId: string;
  availableForSale: boolean;
  sellingPlanGroups: SellingPlanGroup[];
  sellingPlanAllocations: SellingPlanAllocation[];
  productName?: string;
  price?: string;
  currencyCode?: string;
  subscriptionOnly?: boolean;
}) {
  const allPlans = sellingPlanGroups.flatMap((g) => g.sellingPlans);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    subscriptionOnly && allPlans.length > 0 ? allPlans[0]!.id : null
  );

  // Resolve the display price: use selling plan perDeliveryPrice when a plan
  // is selected; fall back to the variant price otherwise.
  let displayPrice = price;
  let displayCurrency = currencyCode;

  if (selectedPlanId) {
    const allocation = sellingPlanAllocations.find(
      (a) => a.sellingPlan.id === selectedPlanId
    );
    const perDelivery = allocation?.priceAdjustments[0]?.perDeliveryPrice;
    if (perDelivery && parseFloat(perDelivery.amount) > 0) {
      displayPrice = perDelivery.amount;
      displayCurrency = perDelivery.currencyCode;
    }
  }

  return (
    <>
      {displayPrice && displayCurrency && parseFloat(displayPrice) > 0 && (
        <p className="text-lg">
          {formatPrice(displayPrice, displayCurrency)}
        </p>
      )}

      <SellingPlanSelector
        sellingPlanGroups={sellingPlanGroups}
        sellingPlanAllocations={sellingPlanAllocations}
        selectedPlanId={selectedPlanId}
        onSelectPlan={setSelectedPlanId}
        subscriptionOnly={subscriptionOnly}
      />
      <AddToCartButton
        merchandiseId={merchandiseId}
        availableForSale={availableForSale}
        sellingPlanId={selectedPlanId ?? undefined}
        productName={productName}
        price={displayPrice}
        currencyCode={displayCurrency}
      />
    </>
  );
}
