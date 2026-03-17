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
