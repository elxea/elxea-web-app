import { describe, expect, it } from "vitest";

import type {
  AdminSellingPlan,
  AdminSellingPlanGroup,
  SellingPlanInterval,
} from "@/lib/shopify/admin-types";
import type { SubscriptionContract } from "@/lib/shopify/customer";
import {
  FALLBACK_FREQUENCY_OPTIONS,
  canManageSubscription,
  deriveFrequencyOptions,
  frequencyOptionKey,
  intervalLabelKey,
  isSameFrequency,
  sortSubscriptionCards,
  subscriptionNoteKey,
  subscriptionStatusKind,
  subscriptionStatusLabelKey,
  toFrequencyOption,
  toSubscriptionCardView,
} from "@/lib/subscription-view";

function contract(over: Partial<SubscriptionContract> = {}): SubscriptionContract {
  return {
    id: "gid://shopify/SubscriptionContract/1",
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    nextBillingDate: "2026-06-15T00:00:00.000Z",
    deliveryPolicy: { interval: "MONTH", intervalCount: { count: 1 } },
    lines: { edges: [] },
    ...over,
  };
}

describe("subscriptionStatusKind", () => {
  it("maps the three states the confirmed design draws", () => {
    expect(subscriptionStatusKind("ACTIVE")).toBe("active");
    expect(subscriptionStatusKind("PAUSED")).toBe("paused");
    expect(subscriptionStatusKind("CANCELLED")).toBe("cancelled");
  });

  it("folds EXPIRED / CANCELED into cancelled", () => {
    expect(subscriptionStatusKind("EXPIRED")).toBe("cancelled");
    expect(subscriptionStatusKind("CANCELED")).toBe("cancelled");
  });

  it("does not guess for FAILED / STALE / unknown values", () => {
    expect(subscriptionStatusKind("FAILED")).toBe("other");
    expect(subscriptionStatusKind("STALE")).toBe("other");
    expect(subscriptionStatusKind("something-new")).toBe("other");
  });

  it("is case insensitive", () => {
    expect(subscriptionStatusKind("active")).toBe("active");
    expect(subscriptionStatusKind("Paused")).toBe("paused");
  });
});

describe("canManageSubscription", () => {
  it("only offers operations on live contracts", () => {
    expect(canManageSubscription("active")).toBe(true);
    expect(canManageSubscription("paused")).toBe(true);
    expect(canManageSubscription("cancelled")).toBe(false);
    // 判定できない状態で停止・解約ボタンを出さない (勝手に操作させない)
    expect(canManageSubscription("other")).toBe(false);
  });
});

describe("label keys", () => {
  it("returns a status label key for every state", () => {
    expect(subscriptionStatusLabelKey("active")).toBe("subscriptionActive");
    expect(subscriptionStatusLabelKey("paused")).toBe("subscriptionPaused");
    expect(subscriptionStatusLabelKey("cancelled")).toBe("subscriptionCancelled");
    expect(subscriptionStatusLabelKey("other")).toBe("subscriptionStatusUnknown");
  });

  it("returns a card note key for every state", () => {
    expect(subscriptionNoteKey("active")).toBe("subscriptionNoteActive");
    expect(subscriptionNoteKey("paused")).toBe("subscriptionNotePaused");
    expect(subscriptionNoteKey("cancelled")).toBe("subscriptionNoteCancelled");
    expect(subscriptionNoteKey("other")).toBe("subscriptionNoteUnknown");
  });

  it("maps Shopify intervals to message keys and defaults to month", () => {
    expect(intervalLabelKey("WEEK")).toBe("intervalWeek");
    expect(intervalLabelKey("DAY")).toBe("intervalDay");
    expect(intervalLabelKey("YEAR")).toBe("intervalYear");
    expect(intervalLabelKey("MONTH")).toBe("intervalMonth");
    expect(intervalLabelKey("weird")).toBe("intervalMonth");
  });
});

/**
 * ストアに実在する selling plan (2026-08-11 時点): 毎月 / 2ヶ月ごと / 3ヶ月ごと の
 * 3 プラン。毎週・隔週のプランは **存在しない**。
 *
 * ここを正として FALLBACK_FREQUENCY_OPTIONS を固定する。Shopify 側でプランを
 * 増減したらこのテストが落ちるので、フォールバック一覧と訳文キーを揃えて直すまで
 * 通らない (存在しない頻度を画面に並べる事故の再発防止)。
 */
const REAL_SHOPIFY_FREQUENCIES: { interval: SellingPlanInterval; intervalCount: number }[] =
  [
    { interval: "MONTH", intervalCount: 1 },
    { interval: "MONTH", intervalCount: 2 },
    { interval: "MONTH", intervalCount: 3 },
  ];

function sellingPlan(
  interval: SellingPlanInterval,
  intervalCount: number,
  id = `${interval}-${intervalCount}`
): AdminSellingPlan {
  return {
    id: `gid://shopify/SellingPlan/${id}`,
    name: id,
    description: null,
    options: [],
    position: null,
    billingPolicy: { interval, intervalCount },
    deliveryPolicy: { interval, intervalCount },
    pricingPolicies: [],
  };
}

function planGroup(sellingPlans: AdminSellingPlan[]): AdminSellingPlanGroup {
  return {
    id: "gid://shopify/SellingPlanGroup/1",
    name: "Subscription",
    merchantCode: null,
    options: [],
    summary: null,
    productsCount: null,
    sellingPlans,
  };
}

describe("FALLBACK_FREQUENCY_OPTIONS", () => {
  it("matches the selling plans that actually exist in Shopify", () => {
    expect(
      FALLBACK_FREQUENCY_OPTIONS.map(({ interval, intervalCount }) => ({
        interval,
        intervalCount,
      }))
    ).toEqual(REAL_SHOPIFY_FREQUENCIES);
  });

  it("offers no weekly or bi-weekly plan (they do not exist in Shopify)", () => {
    expect(FALLBACK_FREQUENCY_OPTIONS.some((o) => o.interval === "WEEK")).toBe(false);
  });

  it("only ever offers intervals the Server Action accepts", () => {
    for (const option of FALLBACK_FREQUENCY_OPTIONS) {
      expect(["DAY", "WEEK", "MONTH", "YEAR"]).toContain(option.interval);
      expect(option.intervalCount).toBeGreaterThanOrEqual(1);
      expect(option.intervalCount).toBeLessThanOrEqual(12);
    }
  });

  it("labels the real plans with their own wording, not the generic one", () => {
    expect(FALLBACK_FREQUENCY_OPTIONS.map((o) => o.labelKey)).toEqual([
      "frequencyEveryMonth",
      "frequencyEvery2Months",
      "frequencyEvery3Months",
    ]);
  });
});

describe("deriveFrequencyOptions", () => {
  it("derives exactly the plans Shopify reports", () => {
    const options = deriveFrequencyOptions([
      planGroup([
        sellingPlan("MONTH", 1),
        sellingPlan("MONTH", 2),
        sellingPlan("MONTH", 3),
      ]),
    ]);
    expect(
      options.map(({ interval, intervalCount }) => ({ interval, intervalCount }))
    ).toEqual(REAL_SHOPIFY_FREQUENCIES);
  });

  it("dedupes the same frequency offered by several groups", () => {
    const options = deriveFrequencyOptions([
      planGroup([sellingPlan("MONTH", 1, "a")]),
      planGroup([sellingPlan("MONTH", 1, "b"), sellingPlan("MONTH", 3, "c")]),
    ]);
    expect(options.map(frequencyOptionKey)).toEqual(["MONTH-1", "MONTH-3"]);
  });

  it("sorts by interval length then count", () => {
    const options = deriveFrequencyOptions([
      planGroup([
        sellingPlan("YEAR", 1),
        sellingPlan("MONTH", 3),
        sellingPlan("WEEK", 2),
        sellingPlan("MONTH", 1),
        sellingPlan("DAY", 10),
      ]),
    ]);
    expect(options.map(frequencyOptionKey)).toEqual([
      "DAY-10",
      "WEEK-2",
      "MONTH-1",
      "MONTH-3",
      "YEAR-1",
    ]);
  });

  it("skips plans with no recurring delivery policy (one-time purchase)", () => {
    const oneTime = sellingPlan("MONTH", 1, "one-time");
    (oneTime as { deliveryPolicy: unknown }).deliveryPolicy = {};

    const options = deriveFrequencyOptions([planGroup([oneTime, sellingPlan("MONTH", 2)])]);
    expect(options.map(frequencyOptionKey)).toEqual(["MONTH-2"]);
  });

  it("returns nothing when the store has no selling plan group", () => {
    expect(deriveFrequencyOptions([])).toEqual([]);
  });
});

describe("toFrequencyOption", () => {
  it("falls back to the generic label with a count for unseen frequencies", () => {
    expect(toFrequencyOption("MONTH", 4)).toEqual({
      labelKey: "intervalMonth",
      labelValues: { count: 4 },
      interval: "MONTH",
      intervalCount: 4,
    });
    expect(toFrequencyOption("DAY", 10).labelKey).toBe("intervalDay");
    expect(toFrequencyOption("YEAR", 1).labelKey).toBe("intervalYear");
  });
});

describe("isSameFrequency", () => {
  it("detects the currently contracted frequency", () => {
    const monthly = toFrequencyOption("MONTH", 1);
    expect(isSameFrequency(monthly, "MONTH", 1)).toBe(true);
    expect(isSameFrequency(monthly, "month", 1)).toBe(true);
    expect(isSameFrequency(monthly, "MONTH", 2)).toBe(false);
    expect(isSameFrequency(monthly, "WEEK", 1)).toBe(false);
  });

  it("treats missing frequency data as 'not current' rather than matching", () => {
    const monthly = toFrequencyOption("MONTH", 1);
    expect(isSameFrequency(monthly, undefined, undefined)).toBe(false);
    expect(isSameFrequency(monthly, "MONTH", undefined)).toBe(false);
  });
});

describe("toSubscriptionCardView", () => {
  it("flattens edges/node and keeps the price object", () => {
    const view = toSubscriptionCardView(
      contract({
        lines: {
          edges: [
            {
              node: {
                id: "line-1",
                title: "和紅茶ティーバッグ（12個入）",
                variantTitle: "標準",
                quantity: 2,
                currentPrice: { amount: "2400", currencyCode: "JPY" },
                variantImage: { url: "/x.jpg", altText: "alt" },
              },
            },
          ],
        },
      })
    );

    expect(view.kind).toBe("active");
    expect(view.interval).toBe("MONTH");
    expect(view.intervalCount).toBe(1);
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]).toMatchObject({
      id: "line-1",
      quantity: 2,
      imageUrl: "/x.jpg",
      imageAlt: "alt",
      price: { amount: "2400", currencyCode: "JPY" },
    });
  });

  it("survives a contract with no lines and no image", () => {
    const view = toSubscriptionCardView(
      contract({
        lines: {
          edges: [
            {
              node: {
                id: "line-2",
                title: "単品",
                variantTitle: null,
                quantity: 1,
                currentPrice: { amount: "1800", currencyCode: "JPY" },
                variantImage: null,
              },
            },
          ],
        },
      })
    );
    expect(view.lines[0].imageUrl).toBeNull();
    expect(view.lines[0].variantTitle).toBeNull();
  });
});

describe("sortSubscriptionCards", () => {
  it("orders active -> paused -> other -> cancelled (confirmed design order)", () => {
    const cards = [
      toSubscriptionCardView(contract({ id: "c", status: "CANCELLED", nextBillingDate: null })),
      toSubscriptionCardView(contract({ id: "f", status: "FAILED", nextBillingDate: null })),
      toSubscriptionCardView(contract({ id: "p", status: "PAUSED", nextBillingDate: null })),
      toSubscriptionCardView(contract({ id: "a", status: "ACTIVE" })),
    ];
    expect(sortSubscriptionCards(cards).map((c) => c.id)).toEqual(["a", "p", "f", "c"]);
  });

  it("puts the nearest delivery first within the same state", () => {
    const cards = [
      toSubscriptionCardView(contract({ id: "late", nextBillingDate: "2026-09-01T00:00:00.000Z" })),
      toSubscriptionCardView(contract({ id: "none", nextBillingDate: null })),
      toSubscriptionCardView(contract({ id: "soon", nextBillingDate: "2026-06-15T00:00:00.000Z" })),
    ];
    expect(sortSubscriptionCards(cards).map((c) => c.id)).toEqual(["soon", "late", "none"]);
  });

  it("does not mutate the input array", () => {
    const cards = [
      toSubscriptionCardView(contract({ id: "p", status: "PAUSED" })),
      toSubscriptionCardView(contract({ id: "a", status: "ACTIVE" })),
    ];
    sortSubscriptionCards(cards);
    expect(cards.map((c) => c.id)).toEqual(["p", "a"]);
  });
});
