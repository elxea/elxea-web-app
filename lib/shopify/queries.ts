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

/**
 * `products(first: 1)` は**中身があるかどうかだけ**を見るための探り。
 *
 * 空のコレクションをタイルや一覧に出すと、押した先が必ず 0 件になる
 * (2026-08-27 実測: 本番 18 件のうち中身があるのは 6 件だけ。トップの
 * 「お茶のコレクション」= `single-item` は 0 件だった)。件数そのものは要らない
 * ので 1 件だけ引く — `first: 250` にすると collections との積で Storefront の
 * クエリコスト上限に当たる。
 */
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
          products(first: 1) {
            edges {
              node {
                id
              }
            }
          }
        }
        cursor
      }
    }
  }
`;

/**
 * コレクションの所属商品 **handle だけ**。
 *
 * 商品一覧の `?category=` は productType 軸だが、トップ / 検索 / コレクション
 * 一覧のタイルは**コレクション名**を渡してくる。コレクション名は productType と
 * 一致しないことがある (`お茶のアソートセット` は緑茶・紅茶・烏龍茶にまたがる)
 * ので、その場合は所属で絞る。突き合わせに要るのは handle だけなので他は引かない。
 */
export const GET_COLLECTION_PRODUCT_HANDLES_QUERY = /* GraphQL */ `
  query GetCollectionProductHandles($handle: String!, $first: Int = 250) {
    collection(handle: $handle) {
      handle
      title
      products(first: $first) {
        edges {
          node {
            handle
          }
        }
      }
    }
  }
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
