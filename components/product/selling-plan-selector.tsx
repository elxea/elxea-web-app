"use client";

import { useTranslations } from "next-intl";
import type { SellingPlanGroup, SellingPlanAllocation } from "@/lib/shopify/types";
import { formatPrice } from "@/lib/utils";

export function SellingPlanSelector({
  sellingPlanGroups,
  sellingPlanAllocations,
  selectedPlanId,
  onSelectPlan,
  subscriptionOnly = false,
}: {
  sellingPlanGroups: SellingPlanGroup[];
  sellingPlanAllocations: SellingPlanAllocation[];
  selectedPlanId: string | null;
  onSelectPlan: (planId: string | null) => void;
  subscriptionOnly?: boolean;
}) {
  const t = useTranslations("product");

  if (sellingPlanGroups.length === 0) return null;

  const allPlans = sellingPlanGroups.flatMap((g) => g.sellingPlans);
  if (allPlans.length === 0) return null;

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{t("purchaseType")}</p>

      {!subscriptionOnly && (
        <div className="flex gap-3">
          <button
            type="button"
            className={`flex-1 border px-4 py-3 text-sm transition-colors ${
              selectedPlanId === null
                ? "border-foreground bg-foreground text-background"
                : "border-border hover:border-foreground"
            }`}
            onClick={() => onSelectPlan(null)}
          >
            {t("oneTimePurchase")}
          </button>
          <button
            type="button"
            className={`flex-1 border px-4 py-3 text-sm transition-colors ${
              selectedPlanId !== null
                ? "border-foreground bg-foreground text-background"
                : "border-border hover:border-foreground"
            }`}
            onClick={() => onSelectPlan(allPlans[0]!.id)}
          >
            {t("subscription")}
          </button>
        </div>
      )}

      {selectedPlanId !== null && allPlans.length > 1 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("deliveryFrequency")}</p>
          <div className="flex flex-wrap gap-2">
            {allPlans.map((plan) => {
              const allocation = sellingPlanAllocations.find(
                (a) => a.sellingPlan.id === plan.id
              );
              const perDeliveryPrice = allocation?.priceAdjustments[0]?.perDeliveryPrice;

              return (
                <button
                  key={plan.id}
                  type="button"
                  className={`border px-3 py-2 text-sm transition-colors ${
                    selectedPlanId === plan.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border hover:border-foreground"
                  }`}
                  onClick={() => onSelectPlan(plan.id)}
                >
                  <span>{plan.name}</span>
                  {perDeliveryPrice && (
                    <span className="block text-xs opacity-80">
                      {formatPrice(perDeliveryPrice.amount, perDeliveryPrice.currencyCode)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedPlanId !== null && (
        <SellingPlanPriceInfo
          sellingPlanAllocations={sellingPlanAllocations}
          selectedPlanId={selectedPlanId}
        />
      )}
    </div>
  );
}

function SellingPlanPriceInfo({
  sellingPlanAllocations,
  selectedPlanId,
}: {
  sellingPlanAllocations: SellingPlanAllocation[];
  selectedPlanId: string;
}) {
  const t = useTranslations("product");

  const allocation = sellingPlanAllocations.find(
    (a) => a.sellingPlan.id === selectedPlanId
  );
  if (!allocation) return null;

  const adj = allocation.priceAdjustments[0];
  if (!adj) return null;

  const hasDiscount =
    parseFloat(adj.compareAtPrice.amount) > parseFloat(adj.price.amount);

  if (!hasDiscount) return null;

  return (
    <p className="text-sm text-muted-foreground">
      {t("subscriptionPrice", {
        price: formatPrice(adj.price.amount, adj.price.currencyCode),
        compareAtPrice: formatPrice(adj.compareAtPrice.amount, adj.compareAtPrice.currencyCode),
      })}
    </p>
  );
}
