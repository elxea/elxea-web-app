/**
 * 定期便LP の月額導出 (lib/subscription-pricing.ts) の単体テスト。
 *
 * 守りたい性質:
 *   1. 「毎月お届け」プランをプラン名ではなく配送間隔で特定する (店舗が名前を変えても壊れない)
 *   2. 月額として出すのは **継続価格**。初回特別価格を月額として出さない
 *   3. 導出できないときは `null`。推測値や壊れた文字列を画面に出さない
 *
 * フィクスチャの形と数値は 2026-08-10 に本番ストアから実測した selling plan
 * (group「elxea 定期便プラン」/ 毎月・2ヶ月ごと・3ヶ月ごと / 初回 1,880 円・継続 2,280 円) に合わせている。
 */

import { describe, expect, it } from "vitest";

import type { Money, Product, SellingPlan, SellingPlanGroup } from "@/lib/shopify/types";
import {
  findMonthlySellingPlanId,
  formatMoneyJa,
  hasFirstDeliveryDiscount,
  monthlyPriceLabel,
  resolveMonthlyPlanPricing,
} from "@/lib/subscription-pricing";

const jpy = (amount: string): Money => ({ amount, currencyCode: "JPY" });

const MONTHLY_ID = "gid://shopify/SellingPlan/3809411230";
const EVERY_2_MONTHS_ID = "gid://shopify/SellingPlan/3809443998";

function plan(overrides: Partial<SellingPlan> & Pick<SellingPlan, "id">): SellingPlan {
  return {
    name: "プラン",
    description: null,
    recurringDeliveries: true,
    options: [],
    priceAdjustments: [],
    ...overrides,
  };
}

function group(plans: SellingPlan[]): SellingPlanGroup {
  return { name: "elxea 定期便プラン", options: [], sellingPlans: plans };
}

/** 実ストア相当: 2ヶ月ごとが先に並んでいても毎月を拾えることを確かめられる順序。 */
const REAL_GROUPS: SellingPlanGroup[] = [
  group([
    plan({
      id: EVERY_2_MONTHS_ID,
      name: "2ヶ月ごとお届け",
      deliveryPolicy: { interval: "MONTH", intervalCount: 2 },
    }),
    plan({
      id: MONTHLY_ID,
      name: "毎月お届け",
      deliveryPolicy: { interval: "MONTH", intervalCount: 1 },
    }),
  ]),
];

function productWith(
  groups: SellingPlanGroup[],
  allocations: Product["variants"][number]["sellingPlanAllocations"]
): Pick<Product, "sellingPlanGroups" | "variants"> {
  return {
    sellingPlanGroups: groups,
    variants: [
      {
        id: "gid://shopify/ProductVariant/1",
        title: "Default Title",
        availableForSale: true,
        selectedOptions: [],
        price: jpy("1880.0"),
        compareAtPrice: null,
        image: null,
        sellingPlanAllocations: allocations,
      },
    ],
  };
}

/** 初回 1,880 円 / 継続 2,280 円 (本番ストアの実測値)。 */
const REAL_ALLOCATIONS = [
  {
    sellingPlan: { id: MONTHLY_ID, name: "毎月お届け" },
    priceAdjustments: [
      { price: jpy("1880.0"), compareAtPrice: jpy("2280.0"), perDeliveryPrice: jpy("1880.0") },
      { price: jpy("2280.0"), compareAtPrice: jpy("2280.0"), perDeliveryPrice: jpy("2280.0") },
    ],
  },
];

describe("findMonthlySellingPlanId", () => {
  it("配送間隔 1 ヶ月のプランを (名前ではなく) 間隔で特定する", () => {
    expect(findMonthlySellingPlanId(REAL_GROUPS)).toBe(MONTHLY_ID);
  });

  it("プラン名が「毎月お届け」でなくても間隔が一致すれば拾う", () => {
    const renamed = [
      group([
        plan({
          id: MONTHLY_ID,
          name: "Monthly box (renamed by merchant)",
          deliveryPolicy: { interval: "MONTH", intervalCount: 1 },
        }),
      ]),
    ];
    expect(findMonthlySellingPlanId(renamed)).toBe(MONTHLY_ID);
  });

  it("毎月のプランが無ければ null (別間隔のプランを月額扱いしない)", () => {
    const noMonthly = [
      group([
        plan({ id: EVERY_2_MONTHS_ID, deliveryPolicy: { interval: "MONTH", intervalCount: 2 } }),
        plan({ id: "weekly", deliveryPolicy: { interval: "WEEK", intervalCount: 1 } }),
      ]),
    ];
    expect(findMonthlySellingPlanId(noMonthly)).toBeNull();
  });

  it("deliveryPolicy を持たないプラン (単発購入) は無視する", () => {
    expect(findMonthlySellingPlanId([group([plan({ id: "one-time" })])])).toBeNull();
    expect(
      findMonthlySellingPlanId([group([plan({ id: "one-time", deliveryPolicy: null })])])
    ).toBeNull();
  });

  it("group が空なら null", () => {
    expect(findMonthlySellingPlanId([])).toBeNull();
  });
});

describe("resolveMonthlyPlanPricing", () => {
  it("初回と継続の 1 回あたり価格を分けて返す", () => {
    const pricing = resolveMonthlyPlanPricing(productWith(REAL_GROUPS, REAL_ALLOCATIONS));
    expect(pricing).not.toBeNull();
    expect(pricing?.sellingPlanId).toBe(MONTHLY_ID);
    expect(pricing?.firstDeliveryPrice.amount).toBe("1880.0");
    expect(pricing?.recurringPrice.amount).toBe("2280.0");
  });

  it("価格調整が 1 件だけなら初回 = 継続", () => {
    const single = [
      {
        sellingPlan: { id: MONTHLY_ID, name: "毎月お届け" },
        priceAdjustments: [
          { price: jpy("2280.0"), compareAtPrice: jpy("2280.0"), perDeliveryPrice: jpy("2280.0") },
        ],
      },
    ];
    const pricing = resolveMonthlyPlanPricing(productWith(REAL_GROUPS, single));
    expect(pricing?.firstDeliveryPrice.amount).toBe("2280.0");
    expect(pricing?.recurringPrice.amount).toBe("2280.0");
  });

  it("毎月プランの allocation が無ければ null (別プランの価格で代用しない)", () => {
    const otherPlanOnly = [
      {
        sellingPlan: { id: EVERY_2_MONTHS_ID, name: "2ヶ月ごとお届け" },
        priceAdjustments: [
          { price: jpy("1880.0"), compareAtPrice: jpy("1880.0"), perDeliveryPrice: jpy("1880.0") },
        ],
      },
    ];
    expect(resolveMonthlyPlanPricing(productWith(REAL_GROUPS, otherPlanOnly))).toBeNull();
  });

  it("価格調整が空なら null", () => {
    const empty = [{ sellingPlan: { id: MONTHLY_ID, name: "毎月お届け" }, priceAdjustments: [] }];
    expect(resolveMonthlyPlanPricing(productWith(REAL_GROUPS, empty))).toBeNull();
  });

  it("商品が無い / 定期便プランが無いときは null", () => {
    expect(resolveMonthlyPlanPricing(null)).toBeNull();
    expect(resolveMonthlyPlanPricing(undefined)).toBeNull();
    expect(resolveMonthlyPlanPricing(productWith([], REAL_ALLOCATIONS))).toBeNull();
  });
});

describe("formatMoneyJa", () => {
  it("JPY は 3 桁区切り + 円 (小数は整数に丸める)", () => {
    expect(formatMoneyJa(jpy("2280.0"))).toBe("2,280円");
    expect(formatMoneyJa(jpy("1880"))).toBe("1,880円");
    expect(formatMoneyJa(jpy("1880.4"))).toBe("1,880円");
    expect(formatMoneyJa(jpy("980"))).toBe("980円");
  });

  it("JPY 以外は通貨記号つきで出す", () => {
    expect(formatMoneyJa({ amount: "19.00", currencyCode: "USD" })).toContain("19");
  });

  it("数値として読めない金額 / 未指定は null (壊れた文字列を画面に出さない)", () => {
    expect(formatMoneyJa(jpy("なし"))).toBeNull();
    expect(formatMoneyJa(null)).toBeNull();
    expect(formatMoneyJa(undefined)).toBeNull();
  });
});

describe("monthlyPriceLabel", () => {
  it("月額として継続価格を返す (初回特別価格ではない)", () => {
    expect(monthlyPriceLabel(productWith(REAL_GROUPS, REAL_ALLOCATIONS))).toBe("2,280円");
  });

  it("導出できないときは null (呼び出し側が文言に落とす)", () => {
    expect(monthlyPriceLabel(null)).toBeNull();
    expect(monthlyPriceLabel(productWith([], REAL_ALLOCATIONS))).toBeNull();
  });
});

describe("hasFirstDeliveryDiscount", () => {
  it("初回と継続が違えば true", () => {
    expect(
      hasFirstDeliveryDiscount(resolveMonthlyPlanPricing(productWith(REAL_GROUPS, REAL_ALLOCATIONS)))
    ).toBe(true);
  });

  it("同額なら false / 導出不能なら false", () => {
    expect(
      hasFirstDeliveryDiscount({
        sellingPlanId: MONTHLY_ID,
        firstDeliveryPrice: jpy("2280.0"),
        recurringPrice: jpy("2280.0"),
      })
    ).toBe(false);
    expect(hasFirstDeliveryDiscount(null)).toBe(false);
    expect(
      hasFirstDeliveryDiscount({
        sellingPlanId: MONTHLY_ID,
        firstDeliveryPrice: jpy("不明"),
        recurringPrice: jpy("2280.0"),
      })
    ).toBe(false);
  });
});
