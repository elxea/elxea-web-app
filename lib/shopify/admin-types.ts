// Shopify Admin API types for subscription management

export type SellingPlanInterval = "DAY" | "WEEK" | "MONTH" | "YEAR";

export type SellingPlanAnchor = {
  day: number;
  month?: number;
  type: "WEEKDAY" | "MONTHDAY" | "YEARDAY";
};

export type SellingPlanPricingPolicyAdjustmentType =
  | "PERCENTAGE"
  | "FIXED_AMOUNT"
  | "PRICE";

export type SellingPlanRecurringBillingPolicy = {
  interval: SellingPlanInterval;
  intervalCount: number;
  anchors?: SellingPlanAnchor[];
};

export type SellingPlanRecurringDeliveryPolicy = {
  interval: SellingPlanInterval;
  intervalCount: number;
  anchors?: SellingPlanAnchor[];
};

export type AdminSellingPlan = {
  id: string;
  name: string;
  description: string | null;
  options: string[];
  position: number | null;
  billingPolicy: SellingPlanRecurringBillingPolicy;
  deliveryPolicy: SellingPlanRecurringDeliveryPolicy;
  pricingPolicies: {
    adjustmentType: SellingPlanPricingPolicyAdjustmentType;
    adjustmentValue:
      | { percentage: number }
      | { amount: string; currencyCode: string };
  }[];
};

export type AdminSellingPlanGroup = {
  id: string;
  name: string;
  merchantCode: string | null;
  options: string[];
  summary: string | null;
  productsCount: { count: number; precision: string } | null;
  sellingPlans: AdminSellingPlan[];
};

export type SubscriptionContractStatus =
  | "ACTIVE"
  | "PAUSED"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED";

export type SubscriptionContractLine = {
  id: string;
  title: string;
  quantity: number;
  currentPrice: { amount: string; currencyCode: string };
  variantId: string | null;
  productId: string | null;
  variantTitle: string | null;
  variantImage: { url: string; altText: string | null } | null;
  sku: string | null;
};

export type SubscriptionContract = {
  id: string;
  status: SubscriptionContractStatus;
  createdAt: string;
  updatedAt: string;
  nextBillingDate: string | null;
  customer: {
    id: string;
    displayName: string;
    email: string;
    phone: string | null;
  };
  deliveryPolicy: {
    interval: SellingPlanInterval;
    intervalCount: number;
  };
  billingPolicy: {
    interval: SellingPlanInterval;
    intervalCount: number;
  };
  lines: SubscriptionContractLine[];
  lastPaymentStatus: string | null;
  deliveryPrice: { amount: string; currencyCode: string };
  deliveryMethod: {
    address: {
      address1: string;
      address2: string | null;
      city: string;
      province: string;
      country: string;
      zip: string;
      firstName: string;
      lastName: string;
    };
  } | null;
  customerPaymentMethod: {
    id: string;
    instrument: {
      brand: string;
      lastDigits: string;
      expiryMonth: number;
      expiryYear: number;
    } | null;
  } | null;
  originOrder: {
    id: string;
    name: string;
  } | null;
  billingAttempts: BillingAttempt[];
};

export type BillingAttempt = {
  id: string;
  createdAt: string;
  ready: boolean;
  errorMessage: string | null;
  errorCode: string | null;
};

/**
 * `SubscriptionBillingCycleBillingCycleStatus`。**この 2 値しかない** —
 * "PENDING" のような中間状態は無いので、「課金が確定したか」は
 * `BILLED` / `UNBILLED` だけで読み取れる。
 *
 * Ref: https://shopify.dev/docs/api/admin-graphql/latest/enums/SubscriptionBillingCycleBillingCycleStatus
 */
export type SubscriptionBillingCycleStatus = "BILLED" | "UNBILLED";

/**
 * 契約の 1 周期。`nextBillingDate` の導出元 (`lib/shopify/next-billing-date.ts`)。
 *
 * `billingAttemptExpectedDate` は「この周期の課金が行われるべき日時」。
 * 実測 (2026-08-12 / 本番 2 契約) では **`cycleEndAt` と同値**だった。
 * 値そのものを計算し直さず Shopify の値をそのまま採用する。
 *
 * Ref: https://shopify.dev/docs/api/admin-graphql/latest/objects/SubscriptionBillingCycle
 */
export type SubscriptionBillingCycle = {
  cycleIndex: number;
  status: SubscriptionBillingCycleStatus;
  /** 顧客/運営がこの周期をスキップした。スキップ分は課金対象にしない。 */
  skipped: boolean;
  billingAttemptExpectedDate: string;
  cycleStartAt: string;
  cycleEndAt: string;
};

/**
 * `SubscriptionBillingCyclesIndexRangeSelector`。両フィールド必須。
 * `startIndex` は 1 以上 (0 は "Billing cycle index out of range.")。
 */
export type SubscriptionBillingCyclesIndexRange = {
  startIndex: number;
  endIndex: number;
};

// Input types for mutations

export type SellingPlanGroupInput = {
  name: string;
  merchantCode?: string;
  options?: string[];
  position?: number;
  sellingPlansToCreate?: SellingPlanInput[];
  sellingPlansToUpdate?: (SellingPlanInput & { id: string })[];
  sellingPlansToDelete?: string[];
};

export type SellingPlanInput = {
  name: string;
  description?: string;
  options?: string[];
  position?: number;
  billingPolicy: {
    recurring: {
      interval: SellingPlanInterval;
      intervalCount: number;
      anchors?: SellingPlanAnchor[];
    };
  };
  deliveryPolicy: {
    recurring: {
      interval: SellingPlanInterval;
      intervalCount: number;
      anchors?: SellingPlanAnchor[];
    };
  };
  pricingPolicies?: {
    fixed?: {
      adjustmentType: SellingPlanPricingPolicyAdjustmentType;
      adjustmentValue: { percentage: number } | { fixedValue: number };
    };
    recurring?: {
      adjustmentType: SellingPlanPricingPolicyAdjustmentType;
      adjustmentValue: { percentage: number } | { fixedValue: number };
      afterCycle?: number;
    };
  }[];
};

export type SubscriptionDraftInput = {
  status?: SubscriptionContractStatus;
  nextBillingDate?: string;
  deliveryPolicy?: {
    interval: SellingPlanInterval;
    intervalCount: number;
  };
  billingPolicy?: {
    interval: SellingPlanInterval;
    intervalCount: number;
  };
};
