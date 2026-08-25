import { shopifyFetch, storefrontConfigured } from "./client";
import { stripPlaceholderCopy } from "./placeholder-copy";
import {
  previewSeedStorefrontEnabled,
  seedProductByHandle,
  seedProductCatalogue,
  seedSearchProducts,
} from "@/lib/preview-seed-storefront";
import {
  GET_PRODUCTS_QUERY,
  GET_PRODUCT_BY_HANDLE_QUERY,
  GET_COLLECTIONS_QUERY,
  SEARCH_PRODUCTS_QUERY,
  GET_CART_QUERY,
} from "./queries";
import {
  CREATE_CART_MUTATION,
  ADD_TO_CART_MUTATION,
  UPDATE_CART_MUTATION,
  REMOVE_FROM_CART_MUTATION,
} from "./mutations";
import type {
  Product,
  ProductVariant,
  ProductFeature,
  ProductMetafields,
  Collection,
  Cart,
  CartItem,
  Image,
  SellingPlan,
  SellingPlanGroup,
  SellingPlanAllocation,
  ShopifyConnection,
} from "./types";

// Helper to flatten Shopify connection edges
function flattenConnection<T>(connection: ShopifyConnection<T>): T[] {
  return connection.edges.map((edge) => edge.node);
}

// Parse metafields array into structured ProductMetafields
type RawMetafield = { namespace: string; key: string; value: string; type: string } | null;

/**
 * Shopify の list.* 型 metafield は Storefront API 上、JSON 配列の**文字列**
 * (`["春摘み","夏摘み"]`) として返る。そのまま描画すると角括弧と引用符が
 * 画面に出るため、配列として解釈できたときだけ読点で連結して 1 行にする。
 *
 * - `[` 始まりでない / JSON として壊れている値は素通し (single_line_text_field 等)
 * - 要素は文字列化して trim し、空要素は落とす
 * - 全要素が空なら null (= 値なし) を返し、呼び出し側の「行を出さない」判定に乗せる
 */
export function normalizeMetafieldValue(value: string | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("[")) return trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return trimmed;
    const joined = parsed
      .map((item) => (typeof item === "string" ? item : String(item)).trim())
      .filter(Boolean)
      .join("、");
    return joined || null;
  } catch {
    return trimmed;
  }
}

function parseProductMetafields(raw: RawMetafield[]): ProductMetafields {
  const map = new Map<string, string>();
  for (const mf of raw) {
    if (mf) map.set(`${mf.namespace}.${mf.key}`, mf.value);
  }
  const read = (key: string) => normalizeMetafieldValue(map.get(key));

  const features: ProductFeature[] = [];
  for (let i = 1; i <= 4; i++) {
    const title = map.get(`custom.feature_0${i}_title`);
    const body = map.get(`custom.feature_0${i}_text_body`);
    if (title || body) {
      features.push({
        title: title || "",
        body: body || "",
        imageUrl: map.get(`custom.feature_0${i}_image_url`) || null,
      });
    }
  }

  return {
    features,
    howToEnjoy: read("my_fields._how-to-enjoy"),
    menuNumber: read("custom.menu_number"),
    teaCategory: read("custom._type-of-tea"),
    variety: read("custom.variety"),
    // 摘採。list.single_line_text_field のため JSON 配列文字列で返る。
    season: read("custom.season"),
    taste: read("custom.taste"),
    aroma: read("custom.aroma"),
  };
}

// Reshape product from GraphQL response
function reshapeProduct(raw: Record<string, unknown>): Product {
  const product = raw as Product & {
    variants: ShopifyConnection<ProductVariant & {
      sellingPlanAllocations: ShopifyConnection<SellingPlanAllocation>;
    }>;
    images?: ShopifyConnection<Image>;
    sellingPlanGroups: ShopifyConnection<Omit<SellingPlanGroup, "sellingPlans"> & {
      sellingPlans: ShopifyConnection<SellingPlan>;
    }>;
    metafields?: RawMetafield[];
  };

  return {
    ...product,
    /* 入稿待ちの印 (`【準備中】`) だけの説明文は、説明が無いものとして扱う。
       画面・SEO の両方がこの 1 か所を通るので、ここで落とせば「売っているのに
       準備中と書いてある」表示が全経路から消える。詳細は placeholder-copy.ts。 */
    description: stripPlaceholderCopy(product.description),
    descriptionHtml: stripPlaceholderCopy(product.descriptionHtml),
    variants: flattenConnection(
      product.variants as unknown as ShopifyConnection<ProductVariant & {
        sellingPlanAllocations: ShopifyConnection<SellingPlanAllocation>;
      }>
    ).map((v) => ({
      ...v,
      sellingPlanAllocations: v.sellingPlanAllocations
        ? flattenConnection(v.sellingPlanAllocations as unknown as ShopifyConnection<SellingPlanAllocation>)
        : [],
    })),
    images: product.images
      ? flattenConnection(product.images as unknown as ShopifyConnection<Image>)
      : product.featuredImage
        ? [product.featuredImage]
        : [],
    sellingPlanGroups: product.sellingPlanGroups
      ? flattenConnection(product.sellingPlanGroups as unknown as ShopifyConnection<Omit<SellingPlanGroup, "sellingPlans"> & {
          sellingPlans: ShopifyConnection<SellingPlan>;
        }>).map((g) => ({
          ...g,
          sellingPlans: flattenConnection(g.sellingPlans as unknown as ShopifyConnection<SellingPlan>),
        }))
      : [],
    metafields: parseProductMetafields(product.metafields || []),
  };
}

/**
 * True when the seeded catalogue should stand in for the Storefront API.
 *
 * Requires BOTH the opt-in flag and the absence of credentials, so a configured
 * store never silently serves dummy products. See
 * `lib/preview-seed-storefront.ts` for the full rationale.
 */
function seededStorefrontActive(): boolean {
  return !storefrontConfigured() && previewSeedStorefrontEnabled();
}

/** Empty `pageInfo`, for seeded results (there is no cursor to page through). */
const SEED_PAGE_INFO = {
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
};

// Products
export async function getProducts(options?: {
  first?: number;
  after?: string;
  sortKey?: string;
  reverse?: boolean;
}) {
  if (seededStorefrontActive()) {
    const all = seedProductCatalogue();
    const sorted =
      options?.sortKey === "PRICE"
        ? [...all].sort(
            (a, b) =>
              Number(a.priceRange.minVariantPrice.amount) -
              Number(b.priceRange.minVariantPrice.amount),
          )
        : [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (options?.reverse) sorted.reverse();
    return {
      products: sorted.slice(0, options?.first ?? sorted.length),
      pageInfo: SEED_PAGE_INFO,
    };
  }

  const data = await shopifyFetch<{
    products: ShopifyConnection<Record<string, unknown>>;
  }>({
    query: GET_PRODUCTS_QUERY,
    variables: options,
    tags: ["products"],
  });

  return {
    products: flattenConnection(data.products).map(reshapeProduct),
    pageInfo: data.products.pageInfo,
  };
}

export async function getProductByHandle(handle: string) {
  // Returns null for an unknown handle, so the page reaches `notFound()` and
  // answers 404 instead of the soft-404 "商品を読み込めませんでした" it used to
  // render when the Storefront call threw.
  if (seededStorefrontActive()) return seedProductByHandle(handle);

  const data = await shopifyFetch<{ product: Record<string, unknown> | null }>({
    query: GET_PRODUCT_BY_HANDLE_QUERY,
    variables: { handle },
    tags: ["products"],
  });

  return data.product ? reshapeProduct(data.product) : null;
}

// Collections
export async function getCollections(first = 20) {
  const data = await shopifyFetch<{
    collections: ShopifyConnection<Collection>;
  }>({
    query: GET_COLLECTIONS_QUERY,
    variables: { first },
    tags: ["collections"],
  });

  return flattenConnection(data.collections);
}

// コレクション詳細 (/collections/[handle]) の廃止 (2026-08-14) に伴い、
// この画面だけが呼んでいた getCollectionByHandle と
// GET_COLLECTION_BY_HANDLE_QUERY を削除した。コレクションの着地先は商品一覧の
// カテゴリ絞り込み (/products?category=) に一本化する。

// Search
export async function searchProducts(
  query: string,
  options?: { first?: number; after?: string }
) {
  if (seededStorefrontActive()) {
    const hits = seedSearchProducts(query);
    return {
      products: hits.slice(0, options?.first ?? hits.length),
      totalCount: hits.length,
      pageInfo: SEED_PAGE_INFO,
    };
  }

  const data = await shopifyFetch<{
    search: ShopifyConnection<Record<string, unknown>> & { totalCount: number };
  }>({
    query: SEARCH_PRODUCTS_QUERY,
    variables: { query, ...options },
    cache: "no-store",
  });

  return {
    products: flattenConnection(data.search).map(reshapeProduct),
    totalCount: data.search.totalCount,
    pageInfo: data.search.pageInfo,
  };
}

// Cart
export async function getCart(cartId: string) {
  const data = await shopifyFetch<{ cart: Cart | null }>({
    query: GET_CART_QUERY,
    variables: { cartId },
    cache: "no-store",
  });

  if (!data.cart) return null;

  return {
    ...data.cart,
    lines: flattenConnection(
      data.cart.lines as unknown as ShopifyConnection<CartItem>
    ),
  };
}

export async function createCart(
  lines: { merchandiseId: string; quantity: number; sellingPlanId?: string }[]
) {
  const data = await shopifyFetch<{
    cartCreate: { cart: Cart; userErrors: { field: string; message: string }[] };
  }>({
    query: CREATE_CART_MUTATION,
    variables: { input: { lines } },
    cache: "no-store",
  });

  if (data.cartCreate.userErrors.length > 0) {
    throw new Error(
      `Cart create error: ${data.cartCreate.userErrors.map((e) => e.message).join(", ")}`,
    );
  }

  return data.cartCreate.cart;
}

export async function addToCart(
  cartId: string,
  lines: { merchandiseId: string; quantity: number; sellingPlanId?: string }[]
) {
  const data = await shopifyFetch<{
    cartLinesAdd: { cart: Cart; userErrors: { field: string; message: string }[] };
  }>({
    query: ADD_TO_CART_MUTATION,
    variables: { cartId, lines },
    cache: "no-store",
  });

  if (data.cartLinesAdd.userErrors.length > 0) {
    throw new Error(
      `Cart add error: ${data.cartLinesAdd.userErrors.map((e) => e.message).join(", ")}`,
    );
  }

  return data.cartLinesAdd.cart;
}

export async function updateCart(
  cartId: string,
  lines: { id: string; merchandiseId: string; quantity: number }[]
) {
  const data = await shopifyFetch<{
    cartLinesUpdate: {
      cart: Cart;
      userErrors: { field: string; message: string }[];
    };
  }>({
    query: UPDATE_CART_MUTATION,
    variables: { cartId, lines },
    cache: "no-store",
  });

  if (data.cartLinesUpdate.userErrors.length > 0) {
    throw new Error(
      `Cart update error: ${data.cartLinesUpdate.userErrors.map((e) => e.message).join(", ")}`,
    );
  }

  return data.cartLinesUpdate.cart;
}

export async function removeFromCart(cartId: string, lineIds: string[]) {
  const data = await shopifyFetch<{
    cartLinesRemove: {
      cart: Cart;
      userErrors: { field: string; message: string }[];
    };
  }>({
    query: REMOVE_FROM_CART_MUTATION,
    variables: { cartId, lineIds },
    cache: "no-store",
  });

  if (data.cartLinesRemove.userErrors.length > 0) {
    throw new Error(
      `Cart remove error: ${data.cartLinesRemove.userErrors.map((e) => e.message).join(", ")}`,
    );
  }

  return data.cartLinesRemove.cart;
}
