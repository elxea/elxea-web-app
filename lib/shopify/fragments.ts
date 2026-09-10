export const IMAGE_FRAGMENT = /* GraphQL */ `
  fragment ImageFields on Image {
    url
    altText
    width
    height
  }
`;

export const PRODUCT_VARIANT_FRAGMENT = /* GraphQL */ `
  fragment ProductVariantFields on ProductVariant {
    id
    title
    availableForSale
    selectedOptions {
      name
      value
    }
    price {
      amount
      currencyCode
    }
    compareAtPrice {
      amount
      currencyCode
    }
    image {
      ...ImageFields
    }
    sellingPlanAllocations(first: 10) {
      edges {
        node {
          sellingPlan {
            id
            name
          }
          priceAdjustments {
            price {
              amount
              currencyCode
            }
            compareAtPrice {
              amount
              currencyCode
            }
            perDeliveryPrice {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
`;

export const PRODUCT_FRAGMENT = /* GraphQL */ `
  fragment ProductFields on Product {
    id
    handle
    title
    description
    descriptionHtml
    availableForSale
    featuredImage {
      ...ImageFields
    }
    options {
      id
      name
      values
    }
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
      maxVariantPrice {
        amount
        currencyCode
      }
    }
    seo {
      title
      description
    }
    tags
    vendor
    productType
    createdAt
    updatedAt
    sellingPlanGroups(first: 10) {
      edges {
        node {
          name
          options {
            name
            values
          }
          sellingPlans(first: 10) {
            edges {
              node {
                id
                name
                description
                recurringDeliveries
                options {
                  name
                  value
                }
                # 「毎月お届け」プランを名前ではなく配送間隔で特定するために引く
                # (プラン名は店舗側で自由に変えられるので表示値の導出根拠にできない)。
                # Storefront API が公開するのは interval / intervalCount まで。
                # 締日 (cutoff) と起算日 (anchors) は Admin API 側にしかないため、
                # 「初回お届け日」はここからは導出できない (docs/placeholders.md #1)。
                deliveryPolicy {
                  ... on SellingPlanRecurringDeliveryPolicy {
                    interval
                    intervalCount
                  }
                }
                priceAdjustments {
                  adjustmentValue {
                    ... on SellingPlanPercentagePriceAdjustment {
                      adjustmentPercentage
                    }
                    ... on SellingPlanFixedAmountPriceAdjustment {
                      adjustmentAmount {
                        amount
                        currencyCode
                      }
                    }
                    ... on SellingPlanFixedPriceAdjustment {
                      price {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const CART_FRAGMENT = /* GraphQL */ `
  fragment CartFields on Cart {
    id
    checkoutUrl
    totalQuantity
    cost {
      subtotalAmount {
        amount
        currencyCode
      }
      totalAmount {
        amount
        currencyCode
      }
      totalTaxAmount {
        amount
        currencyCode
      }
    }
    lines(first: 100) {
      edges {
        node {
          id
          quantity
          merchandise {
            ... on ProductVariant {
              id
              title
              selectedOptions {
                name
                value
              }
              product {
                id
                handle
                title
                featuredImage {
                  ...ImageFields
                }
                vendor
              }
              price {
                amount
                currencyCode
              }
            }
          }
          cost {
            totalAmount {
              amount
              currencyCode
            }
            # 1 個あたりの実額。定期便プランの調整後の値なので、数量を押した
            # 瞬間に金額を引き直すときの基準になる (components/cart/cart-money.ts)。
            # merchandise.price はプラン調整前の定価なので、この用途には使えない。
            amountPerQuantity {
              amount
              currencyCode
            }
          }
          sellingPlanAllocation {
            sellingPlan {
              id
              name
            }
          }
        }
      }
    }
  }
  ${IMAGE_FRAGMENT}
`;
