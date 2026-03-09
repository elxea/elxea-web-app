"use client";

import { useState } from "react";
import { SellingPlanSelector } from "./selling-plan-selector";
import { AddToCartButton } from "./add-to-cart-button";
import type { SellingPlanGroup, SellingPlanAllocation } from "@/lib/shopify/types";

export function ProductPurchaseOptions({
  merchandiseId,
  availableForSale,
  sellingPlanGroups,
  sellingPlanAllocations,
  productName,
  price,
  currencyCode,
}: {
  merchandiseId: string;
  availableForSale: boolean;
  sellingPlanGroups: SellingPlanGroup[];
  sellingPlanAllocations: SellingPlanAllocation[];
  productName?: string;
  price?: string;
  currencyCode?: string;
}) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  return (
    <>
      <SellingPlanSelector
        sellingPlanGroups={sellingPlanGroups}
        sellingPlanAllocations={sellingPlanAllocations}
        selectedPlanId={selectedPlanId}
        onSelectPlan={setSelectedPlanId}
      />
      <AddToCartButton
        merchandiseId={merchandiseId}
        availableForSale={availableForSale}
        sellingPlanId={selectedPlanId ?? undefined}
        productName={productName}
        price={price}
        currencyCode={currencyCode}
      />
    </>
  );
}
