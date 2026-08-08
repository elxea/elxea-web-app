import { describe, expect, it } from "vitest";

import type { SubscriptionContract } from "@/lib/shopify/customer";
import {
  FREQUENCY_OPTIONS,
  canManageSubscription,
  intervalLabelKey,
  isSameFrequency,
  sortSubscriptionCards,
  subscriptionNoteKey,
  subscriptionStatusKind,
  subscriptionStatusLabelKey,
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

describe("FREQUENCY_OPTIONS / isSameFrequency", () => {
  it("carries the five chips of the confirmed design in order", () => {
    expect(FREQUENCY_OPTIONS.map((o) => o.labelKey)).toEqual([
      "frequencyEveryWeek",
      "frequencyEvery2Weeks",
      "frequencyEveryMonth",
      "frequencyEvery2Months",
      "frequencyEvery3Months",
    ]);
  });

  it("only ever offers intervals the Server Action accepts", () => {
    for (const option of FREQUENCY_OPTIONS) {
      expect(["WEEK", "MONTH"]).toContain(option.interval);
      expect(option.intervalCount).toBeGreaterThanOrEqual(1);
      expect(option.intervalCount).toBeLessThanOrEqual(12);
    }
  });

  it("detects the currently contracted frequency", () => {
    const monthly = FREQUENCY_OPTIONS[2];
    expect(isSameFrequency(monthly, "MONTH", 1)).toBe(true);
    expect(isSameFrequency(monthly, "month", 1)).toBe(true);
    expect(isSameFrequency(monthly, "MONTH", 2)).toBe(false);
    expect(isSameFrequency(monthly, "WEEK", 1)).toBe(false);
  });

  it("treats missing frequency data as 'not current' rather than matching", () => {
    const weekly = FREQUENCY_OPTIONS[0];
    expect(isSameFrequency(weekly, undefined, undefined)).toBe(false);
    expect(isSameFrequency(weekly, "WEEK", undefined)).toBe(false);
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
