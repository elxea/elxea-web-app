// Shopify Admin API queries for subscription management

export const SELLING_PLAN_GROUPS_QUERY = /* GraphQL */ `
  query SellingPlanGroups($first: Int = 20, $after: String) {
    sellingPlanGroups(first: $first, after: $after) {
      edges {
        node {
          id
          name
          merchantCode
          options
          summary
          productsCount {
            count
            precision
          }
          sellingPlans(first: 10) {
            edges {
              node {
                id
                name
                description
                options
                position
                billingPolicy {
                  ... on SellingPlanRecurringBillingPolicy {
                    interval
                    intervalCount
                    anchors {
                      day
                      month
                      type
                    }
                  }
                }
                deliveryPolicy {
                  ... on SellingPlanRecurringDeliveryPolicy {
                    interval
                    intervalCount
                    anchors {
                      day
                      month
                      type
                    }
                  }
                }
                pricingPolicies {
                  ... on SellingPlanFixedPricingPolicy {
                    adjustmentType
                    adjustmentValue {
                      ... on SellingPlanPricingPolicyPercentageValue {
                        percentage
                      }
                      ... on MoneyV2 {
                        amount
                        currencyCode
                      }
                    }
                  }
                  ... on SellingPlanRecurringPricingPolicy {
                    adjustmentType
                    adjustmentValue {
                      ... on SellingPlanPricingPolicyPercentageValue {
                        percentage
                      }
                      ... on MoneyV2 {
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
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const SUBSCRIPTION_CONTRACTS_QUERY = /* GraphQL */ `
  query SubscriptionContracts($first: Int = 20, $after: String, $query: String) {
    subscriptionContracts(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          status
          createdAt
          nextBillingDate
          customer {
            id
            displayName
            email
          }
          deliveryPolicy {
            interval
            intervalCount
          }
          billingPolicy {
            interval
            intervalCount
          }
          lines(first: 10) {
            edges {
              node {
                id
                title
                quantity
                currentPrice {
                  amount
                  currencyCode
                }
                variantId
                productId
              }
            }
          }
          lastPaymentStatus
          deliveryPrice {
            amount
            currencyCode
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const SUBSCRIPTION_CONTRACT_QUERY = /* GraphQL */ `
  query SubscriptionContract($id: ID!) {
    subscriptionContract(id: $id) {
      id
      status
      createdAt
      updatedAt
      nextBillingDate
      customer {
        id
        displayName
        email
        phone
      }
      deliveryPolicy {
        interval
        intervalCount
      }
      billingPolicy {
        interval
        intervalCount
      }
      lines(first: 50) {
        edges {
          node {
            id
            title
            quantity
            currentPrice {
              amount
              currencyCode
            }
            variantId
            productId
            variantTitle
            variantImage {
              url
              altText
            }
            sku
          }
        }
      }
      lastPaymentStatus
      deliveryPrice {
        amount
        currencyCode
      }
      deliveryMethod {
        ... on SubscriptionDeliveryMethodShipping {
          address {
            address1
            address2
            city
            province
            country
            zip
            firstName
            lastName
          }
        }
      }
      customerPaymentMethod {
        id
        instrument {
          ... on CustomerCreditCard {
            brand
            lastDigits
            expiryMonth
            expiryYear
          }
        }
      }
      originOrder {
        id
        name
      }
      billingAttempts(first: 10) {
        edges {
          node {
            id
            createdAt
            ready
            errorMessage
            errorCode
          }
        }
      }
    }
  }
`;

/**
 * `nextBillingDate` だけを読む軽量クエリ。
 *
 * `SUBSCRIPTION_CONTRACT_QUERY` は lines(50) / 支払い方法 / 配送先まで引くため、
 * requested query cost が大きい。nextBillingDate の整合 (`lib/shopify/next-billing-date.ts`)
 * は 1 契約あたり 2 回読む (判定前 + 書く直前の read-then-compare) ので、
 * 重いクエリを流用すると cron 全体の cost が跳ねる。
 *
 * Ref: https://shopify.dev/docs/api/usage/rate-limits
 */
export const SUBSCRIPTION_CONTRACT_NEXT_BILLING_DATE_QUERY = /* GraphQL */ `
  query SubscriptionContractNextBillingDate($id: ID!) {
    subscriptionContract(id: $id) {
      id
      status
      nextBillingDate
    }
  }
`;

/**
 * 契約の billing cycle を cycleIndex 昇順で引く。
 *
 * ## selector は必須 (実測で確認・2026-08-12 / API 2026-07)
 *
 * `billingCyclesIndexRangeSelector` を `SubscriptionBillingCyclesIndexRangeSelector!`
 * (非 null) として宣言しているのは、Shopify が **どちらか一方の selector を必ず要求する**
 * ため。省略すると GraphQL エラーになる:
 *
 *   "subscriptionBillingCycles requires exactly one of
 *    billing_cycles_date_range_selector, billing_cycles_index_range_selector"
 *   (extensions.code = INVALID_FIELD_ARGUMENTS)
 *
 * スキーマ上は 2 つとも optional に見える (`INPUT_OBJECT`, 非 NON_NULL) ので、
 * introspection だけでは分からない。ここで非 null にしておくことで
 * 「selector を渡し忘れたクエリ」がコンパイル時ではなく変数構築時に必ず露見する。
 *
 * ## index 系を使う理由 (date 系を使わない)
 *
 * 日付範囲で「今日以降」を引くと、**過去に置かれたまま課金されていない UNBILLED cycle
 * を取りこぼす**。取りこぼすと未収の周期を飛び越えて nextBillingDate を先に送ってしまう
 * (顧客が 1 回分払わずに進む)。index 範囲を 1 から走査すれば、過去分を含めて
 * 「cycleIndex 最小の UNBILLED」に必ず到達する。
 *
 * ## index の下限と範囲幅の実測値
 *
 * - `startIndex` は 1 から。0 を渡すと "Billing cycle index out of range."
 * - 範囲幅には上限がある。1..50 は成功、1..250 は
 *   "Upcoming billing cycle selected past limit." で失敗する。
 *   実際の窓幅は `BILLING_CYCLE_INDEX_WINDOW` (subscription-admin.ts) が持つ。
 *
 * Ref: https://shopify.dev/docs/api/admin-graphql/latest/queries/subscriptionBillingCycles
 */
export const SUBSCRIPTION_BILLING_CYCLES_QUERY = /* GraphQL */ `
  query SubscriptionBillingCycles(
    $contractId: ID!
    $first: Int = 25
    $after: String
    $billingCyclesIndexRangeSelector: SubscriptionBillingCyclesIndexRangeSelector!
  ) {
    subscriptionBillingCycles(
      contractId: $contractId
      first: $first
      after: $after
      sortKey: CYCLE_INDEX
      billingCyclesIndexRangeSelector: $billingCyclesIndexRangeSelector
    ) {
      edges {
        node {
          cycleIndex
          status
          skipped
          billingAttemptExpectedDate
          cycleStartAt
          cycleEndAt
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const SUBSCRIPTION_BILLING_ATTEMPTS_QUERY = /* GraphQL */ `
  query SubscriptionContractBillingAttempts($contractId: ID!, $first: Int = 20, $after: String) {
    subscriptionContract(id: $contractId) {
      billingAttempts(first: $first, after: $after) {
        edges {
          node {
            id
            createdAt
            ready
            errorMessage
            errorCode
          }
          cursor
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;
