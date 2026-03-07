import { shopifyFetch } from "./client";
import {
  GET_PRODUCTS_QUERY,
  GET_PRODUCT_BY_HANDLE_QUERY,
  GET_COLLECTIONS_QUERY,
  GET_COLLECTION_BY_HANDLE_QUERY,
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
  Collection,
  Cart,
  CartItem,
  Image,
  ShopifyConnection,
} from "./types";

// Helper to flatten Shopify connection edges
function flattenConnection<T>(connection: ShopifyConnection<T>): T[] {
  return connection.edges.map((edge) => edge.node);
}

// Reshape product from GraphQL response
function reshapeProduct(raw: Record<string, unknown>): Product {
  const product = raw as Product & {
    variants: ShopifyConnection<ProductVariant>;
    images?: ShopifyConnection<Image>;
  };
  return {
    ...product,
    variants: flattenConnection(
      product.variants as unknown as ShopifyConnection<ProductVariant>
    ),
    images: product.images
      ? flattenConnection(product.images as unknown as ShopifyConnection<Image>)
      : product.featuredImage
        ? [product.featuredImage]
        : [],
  };
}

// Products
export async function getProducts(options?: {
  first?: number;
  after?: string;
  sortKey?: string;
  reverse?: boolean;
}) {
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

export async function getCollectionByHandle(
  handle: string,
  options?: { first?: number; after?: string; sortKey?: string; reverse?: boolean }
) {
  const data = await shopifyFetch<{
    collection: (Omit<Collection, "products"> & {
      products: ShopifyConnection<Record<string, unknown>>;
    }) | null;
  }>({
    query: GET_COLLECTION_BY_HANDLE_QUERY,
    variables: { handle, ...options },
    tags: ["collections"],
  });

  if (!data.collection) return null;

  return {
    ...data.collection,
    products: flattenConnection(data.collection.products).map(reshapeProduct),
    pageInfo: data.collection.products.pageInfo,
  };
}

// Search
export async function searchProducts(
  query: string,
  options?: { first?: number; after?: string }
) {
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
  lines: { merchandiseId: string; quantity: number }[]
) {
  const data = await shopifyFetch<{
    cartCreate: { cart: Cart; userErrors: { field: string; message: string }[] };
  }>({
    query: CREATE_CART_MUTATION,
    variables: { input: { lines } },
    cache: "no-store",
  });

  return data.cartCreate.cart;
}

export async function addToCart(
  cartId: string,
  lines: { merchandiseId: string; quantity: number }[]
) {
  const data = await shopifyFetch<{
    cartLinesAdd: { cart: Cart; userErrors: { field: string; message: string }[] };
  }>({
    query: ADD_TO_CART_MUTATION,
    variables: { cartId, lines },
    cache: "no-store",
  });

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

  return data.cartLinesRemove.cart;
}
