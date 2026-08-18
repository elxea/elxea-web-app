// Shopify Storefront API types

export type Money = {
  amount: string;
  currencyCode: string;
};

export type Image = {
  url: string;
  altText: string | null;
  width: number;
  height: number;
};

export type SEO = {
  title: string | null;
  description: string | null;
};

export type SellingPlanPriceAdjustment = {
  adjustmentValue:
    | { adjustmentPercentage: number }
    | { adjustmentAmount: Money }
    | { price: Money };
};

/**
 * 定期便プランの配送間隔。
 *
 * Storefront API が返すのは `interval` / `intervalCount` だけで、締日 (`cutoff`) と
 * 起算日 (`anchors`) は Admin API 専用。よって「毎月のプランはどれか」は判定できるが
 * 「次の発送日はいつか」は Storefront だけでは判定できない。
 *
 * 単発購入プラン (SellingPlanFixedDeliveryPolicy) には interval が無いため
 * `null` になりうる。
 */
export type SellingPlanRecurringDeliveryPolicy = {
  interval: "DAY" | "WEEK" | "MONTH" | "YEAR";
  intervalCount: number;
};

export type SellingPlan = {
  id: string;
  name: string;
  description: string | null;
  recurringDeliveries: boolean;
  options: { name: string; value: string }[];
  priceAdjustments: SellingPlanPriceAdjustment[];
  deliveryPolicy?: SellingPlanRecurringDeliveryPolicy | null;
};

export type SellingPlanGroup = {
  name: string;
  options: { name: string; values: string[] }[];
  sellingPlans: SellingPlan[];
};

export type SellingPlanAllocation = {
  sellingPlan: Pick<SellingPlan, "id" | "name">;
  priceAdjustments: {
    price: Money;
    compareAtPrice: Money;
    perDeliveryPrice: Money;
  }[];
};

export type ProductVariant = {
  id: string;
  title: string;
  availableForSale: boolean;
  selectedOptions: { name: string; value: string }[];
  price: Money;
  compareAtPrice: Money | null;
  image: Image | null;
  sellingPlanAllocations: SellingPlanAllocation[];
};

export type ProductFeature = {
  title: string;
  body: string;
  imageUrl: string | null;
};

export type ProductMetafields = {
  features: ProductFeature[];
  howToEnjoy: string | null;
  menuNumber: string | null;
  teaCategory: string | null;
  variety: string | null;
  season: string | null;
  taste: string | null;
  aroma: string | null;
};

export type Product = {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  availableForSale: boolean;
  featuredImage: Image | null;
  images: Image[];
  options: { id: string; name: string; values: string[] }[];
  variants: ProductVariant[];
  priceRange: {
    minVariantPrice: Money;
    maxVariantPrice: Money;
  };
  seo: SEO;
  tags: string[];
  vendor: string;
  productType: string;
  createdAt: string;
  updatedAt: string;
  sellingPlanGroups: SellingPlanGroup[];
  metafields: ProductMetafields;
};

export type Collection = {
  id: string;
  handle: string;
  title: string;
  description: string;
  image: Image | null;
  seo: SEO;
  products: Product[];
};

export type CartItem = {
  id: string;
  quantity: number;
  merchandise: {
    id: string;
    title: string;
    selectedOptions: { name: string; value: string }[];
    product: Pick<Product, "id" | "handle" | "title" | "featuredImage" | "vendor">;
    price: Money;
  };
  cost: {
    totalAmount: Money;
  };
  sellingPlanAllocation: {
    sellingPlan: { id: string; name: string };
  } | null;
};

export type Cart = {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  cost: {
    subtotalAmount: Money;
    totalAmount: Money;
    totalTaxAmount: Money | null;
  };
  lines: CartItem[];
};

// Shopify GraphQL response shapes
export type ShopifyConnection<T> = {
  edges: { node: T; cursor: string }[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
};
