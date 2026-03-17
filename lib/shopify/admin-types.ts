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

export type SubscriptionLineInput = {
  /** The price of the product (required). */
  currentPrice: string;
  /** The ID of the product variant (required). */
  productVariantId: string;
  /** The quantity of the product (required). */
  quantity: number;
  /** The selling plan ID (optional). */
  sellingPlanId?: string;
  /** The selling plan name (optional). */
  sellingPlanName?: string;
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
