// Shopify Admin API mutations for subscription management

export const SELLING_PLAN_GROUP_CREATE_MUTATION = /* GraphQL */ `
  mutation SellingPlanGroupCreate($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput) {
    sellingPlanGroupCreate(input: $input, resources: $resources) {
      sellingPlanGroup {
        id
        name
        merchantCode
        options
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
      userErrors {
        field
        message
      }
    }
  }
`;

export const SELLING_PLAN_GROUP_UPDATE_MUTATION = /* GraphQL */ `
  mutation SellingPlanGroupUpdate($id: ID!, $input: SellingPlanGroupInput!) {
    sellingPlanGroupUpdate(id: $id, input: $input) {
      sellingPlanGroup {
        id
        name
        merchantCode
        options
        sellingPlans(first: 10) {
          edges {
            node {
              id
              name
              description
              options
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const SELLING_PLAN_GROUP_ADD_PRODUCTS_MUTATION = /* GraphQL */ `
  mutation SellingPlanGroupAddProducts($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
      sellingPlanGroup {
        id
        name
        productCount
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const SELLING_PLAN_GROUP_DELETE_MUTATION = /* GraphQL */ `
  mutation SellingPlanGroupDelete($id: ID!) {
    sellingPlanGroupDelete(id: $id) {
      deletedSellingPlanGroupId
      userErrors {
        field
        message
      }
    }
  }
`;

export const SUBSCRIPTION_BILLING_ATTEMPT_CREATE_MUTATION = /* GraphQL */ `
  mutation SubscriptionBillingAttemptCreate(
    $subscriptionContractId: ID!
    $subscriptionBillingAttemptInput: SubscriptionBillingAttemptInput!
  ) {
    subscriptionBillingAttemptCreate(
      subscriptionContractId: $subscriptionContractId
      subscriptionBillingAttemptInput: $subscriptionBillingAttemptInput
    ) {
      subscriptionBillingAttempt {
        id
        ready
        errorMessage
        errorCode
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const CUSTOMER_TAGS_ADD_MUTATION = /* GraphQL */ `
  mutation tagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

export const CUSTOMER_TAGS_REMOVE_MUTATION = /* GraphQL */ `
  mutation tagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

export const SUBSCRIPTION_CONTRACT_UPDATE_MUTATION = /* GraphQL */ `
  mutation SubscriptionContractUpdate($contractId: ID!) {
    subscriptionContractUpdate(contractId: $contractId) {
      draft {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const SUBSCRIPTION_DRAFT_COMMIT_MUTATION = /* GraphQL */ `
  mutation SubscriptionDraftCommit($draftId: ID!) {
    subscriptionDraftCommit(draftId: $draftId) {
      contract {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const SUBSCRIPTION_DRAFT_LINE_ADD_MUTATION = /* GraphQL */ `
  mutation SubscriptionDraftLineAdd($draftId: ID!, $input: SubscriptionLineInput!) {
    subscriptionDraftLineAdd(draftId: $draftId, input: $input) {
      lineAdded {
        id
        title
        variantTitle
        quantity
        currentPrice { amount currencyCode }
        productId
        variantId
        variantImage { url altText }
        sku
      }
      draft {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const SUBSCRIPTION_DRAFT_LINE_REMOVE_MUTATION = /* GraphQL */ `
  mutation SubscriptionDraftLineRemove($draftId: ID!, $lineId: ID!) {
    subscriptionDraftLineRemove(draftId: $draftId, lineId: $lineId) {
      lineRemoved {
        id
        title
      }
      draft {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const SUBSCRIPTION_DRAFT_UPDATE_MUTATION = /* GraphQL */ `
  mutation SubscriptionDraftUpdate($draftId: ID!, $input: SubscriptionDraftInput!) {
    subscriptionDraftUpdate(draftId: $draftId, input: $input) {
      draft {
        id
        status
        deliveryPolicy {
          interval
          intervalCount
        }
        billingPolicy {
          interval
          intervalCount
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;
