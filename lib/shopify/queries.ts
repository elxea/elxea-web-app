import { CART_FRAGMENT, IMAGE_FRAGMENT, PRODUCT_FRAGMENT, PRODUCT_VARIANT_FRAGMENT } from "./fragments";

export const GET_PRODUCTS_QUERY = /* GraphQL */ `
  query GetProducts($first: Int = 20, $after: String, $sortKey: ProductSortKeys = BEST_SELLING, $reverse: Boolean = false) {
    products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
      edges {
        node {
          ...ProductFields
          variants(first: 10) {
            edges {
              node {
                ...ProductVariantFields
              }
            }
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
  ${IMAGE_FRAGMENT}
  ${PRODUCT_FRAGMENT}
  ${PRODUCT_VARIANT_FRAGMENT}
`;

export const GET_PRODUCT_BY_HANDLE_QUERY = /* GraphQL */ `
  query GetProductByHandle($handle: String!) {
    product(handle: $handle) {
      ...ProductFields
      variants(first: 100) {
        edges {
          node {
            ...ProductVariantFields
          }
        }
      }
      images(first: 20) {
        edges {
          node {
            url
            altText
            width
            height
          }
        }
      }
      metafields(identifiers: [
        { namespace: "custom", key: "feature_01_title" }
        { namespace: "custom", key: "feature_01_text_body" }
        { namespace: "custom", key: "feature_01_image_url" }
        { namespace: "custom", key: "feature_02_title" }
        { namespace: "custom", key: "feature_02_text_body" }
        { namespace: "custom", key: "feature_02_image_url" }
        { namespace: "custom", key: "feature_03_title" }
        { namespace: "custom", key: "feature_03_text_body" }
        { namespace: "custom", key: "feature_03_image_url" }
        { namespace: "custom", key: "feature_04_title" }
        { namespace: "custom", key: "feature_04_text_body" }
        { namespace: "custom", key: "feature_04_image_url" }
        { namespace: "my_fields", key: "_how-to-enjoy" }
        { namespace: "custom", key: "menu_number" }
        { namespace: "custom", key: "_type-of-tea" }
        { namespace: "custom", key: "variety" }
        { namespace: "custom", key: "season" }
        { namespace: "custom", key: "taste" }
        { namespace: "custom", key: "aroma" }
      ]) {
        namespace
        key
        value
        type
      }
    }
  }
  ${IMAGE_FRAGMENT}
  ${PRODUCT_FRAGMENT}
  ${PRODUCT_VARIANT_FRAGMENT}
`;

export const GET_COLLECTIONS_QUERY = /* GraphQL */ `
  query GetCollections($first: Int = 20) {
    collections(first: $first) {
      edges {
        node {
          id
          handle
          title
          description
          image {
            url
            altText
            width
            height
          }
          seo {
            title
            description
          }
        }
        cursor
      }
    }
  }
`;

export const GET_COLLECTION_BY_HANDLE_QUERY = /* GraphQL */ `
  query GetCollectionByHandle($handle: String!, $first: Int = 20, $after: String, $sortKey: ProductCollectionSortKeys = BEST_SELLING, $reverse: Boolean = false) {
    collection(handle: $handle) {
      id
      handle
      title
      description
      image {
        url
        altText
        width
        height
      }
      seo {
        title
        description
      }
      products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
        edges {
          node {
            ...ProductFields
            variants(first: 10) {
              edges {
                node {
                  ...ProductVariantFields
                }
              }
            }
          }
          cursor
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  }
  ${IMAGE_FRAGMENT}
  ${PRODUCT_FRAGMENT}
  ${PRODUCT_VARIANT_FRAGMENT}
`;

export const SEARCH_PRODUCTS_QUERY = /* GraphQL */ `
  query SearchProducts($query: String!, $first: Int = 20, $after: String) {
    search(query: $query, first: $first, after: $after, types: PRODUCT) {
      edges {
        node {
          ... on Product {
            ...ProductFields
            variants(first: 10) {
              edges {
                node {
                  ...ProductVariantFields
                }
              }
            }
          }
        }
        cursor
      }
      totalCount
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
  ${IMAGE_FRAGMENT}
  ${PRODUCT_FRAGMENT}
  ${PRODUCT_VARIANT_FRAGMENT}
`;

export const GET_CART_QUERY = /* GraphQL */ `
  query GetCart($cartId: ID!) {
    cart(id: $cartId) {
      ...CartFields
    }
  }
  ${CART_FRAGMENT}
`;
