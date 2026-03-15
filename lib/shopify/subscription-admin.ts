import { adminFetch, throwOnUserErrors } from "./admin-client";
import {
  SELLING_PLAN_GROUP_CREATE_MUTATION,
  SELLING_PLAN_GROUP_UPDATE_MUTATION,
  SELLING_PLAN_GROUP_ADD_PRODUCTS_MUTATION,
  SELLING_PLAN_GROUP_DELETE_MUTATION,
  SUBSCRIPTION_BILLING_ATTEMPT_CREATE_MUTATION,
  SUBSCRIPTION_CONTRACT_UPDATE_MUTATION,
  SUBSCRIPTION_DRAFT_COMMIT_MUTATION,
  SUBSCRIPTION_DRAFT_UPDATE_MUTATION,
  SUBSCRIPTION_DRAFT_LINE_ADD_MUTATION,
  SUBSCRIPTION_DRAFT_LINE_REMOVE_MUTATION,
  CUSTOMER_TAGS_ADD_MUTATION,
  CUSTOMER_TAGS_REMOVE_MUTATION,
} from "./admin-mutations";
import {
  SELLING_PLAN_GROUPS_QUERY,
  SUBSCRIPTION_CONTRACTS_QUERY,
  SUBSCRIPTION_CONTRACT_QUERY,
  SUBSCRIPTION_BILLING_ATTEMPTS_QUERY,
} from "./admin-queries";
import type {
  AdminSellingPlanGroup,
  AdminSellingPlan,
  SellingPlanGroupInput,
  SubscriptionContract,
  SubscriptionContractLine,
  SubscriptionContractStatus,
  BillingAttempt,
  SubscriptionDraftInput,
  SubscriptionLineInput,
} from "./admin-types";

// ─── Helpers to flatten GraphQL edges ────────────────────────────────

function flattenEdges<T>(connection: {
  edges: { node: T }[];
}): T[] {
  return connection.edges.map((edge) => edge.node);
}

function flattenSellingPlanGroup(
  raw: Record<string, unknown>
): AdminSellingPlanGroup {
  const group = raw as AdminSellingPlanGroup & {
    sellingPlans: { edges: { node: AdminSellingPlan }[] };
  };
  return {
    ...group,
    sellingPlans: flattenEdges(group.sellingPlans),
  };
}

function flattenContract(
  raw: Record<string, unknown>
): SubscriptionContract {
  const contract = raw as SubscriptionContract & {
    lines: { edges: { node: SubscriptionContractLine }[] };
    billingAttempts: { edges: { node: BillingAttempt }[] };
  };
  return {
    ...contract,
    lines: flattenEdges(contract.lines),
    billingAttempts: contract.billingAttempts
      ? flattenEdges(contract.billingAttempts)
      : [],
  };
}

// ─── Selling Plan Group operations ───────────────────────────────────

/**
 * Create a selling plan group (e.g., "Monthly Tea Subscription - 10% off").
 * Optionally associates product IDs at creation time.
 */
export async function createSellingPlanGroup(
  input: SellingPlanGroupInput,
  productIds?: string[]
): Promise<AdminSellingPlanGroup> {
  const variables: Record<string, unknown> = { input };
  if (productIds && productIds.length > 0) {
    variables.resources = { productIds };
  }

  const data = await adminFetch<{
    sellingPlanGroupCreate: {
      sellingPlanGroup: Record<string, unknown>;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>({
    query: SELLING_PLAN_GROUP_CREATE_MUTATION,
    variables,
  });

  throwOnUserErrors(data, "sellingPlanGroupCreate");
  return flattenSellingPlanGroup(data.sellingPlanGroupCreate.sellingPlanGroup);
}

/**
 * Update an existing selling plan group.
 */
export async function updateSellingPlanGroup(
  groupId: string,
  input: SellingPlanGroupInput
): Promise<AdminSellingPlanGroup> {
  const data = await adminFetch<{
    sellingPlanGroupUpdate: {
      sellingPlanGroup: Record<string, unknown>;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>({
    query: SELLING_PLAN_GROUP_UPDATE_MUTATION,
    variables: { id: groupId, input },
  });

  throwOnUserErrors(data, "sellingPlanGroupUpdate");
  return flattenSellingPlanGroup(data.sellingPlanGroupUpdate.sellingPlanGroup);
}

/**
 * Associate products with a selling plan group.
 */
export async function addProductsToSellingPlanGroup(
  groupId: string,
  productIds: string[]
): Promise<{ id: string; name: string; productCount: number }> {
  const data = await adminFetch<{
    sellingPlanGroupAddProducts: {
      sellingPlanGroup: { id: string; name: string; productCount: number };
      userErrors: { field: string[] | null; message: string }[];
    };
  }>({
    query: SELLING_PLAN_GROUP_ADD_PRODUCTS_MUTATION,
    variables: { id: groupId, productIds },
  });

  throwOnUserErrors(data, "sellingPlanGroupAddProducts");
  return data.sellingPlanGroupAddProducts.sellingPlanGroup;
}

/**
 * Delete a selling plan group.
 */
export async function deleteSellingPlanGroup(
  groupId: string
): Promise<string> {
  const data = await adminFetch<{
    sellingPlanGroupDelete: {
      deletedSellingPlanGroupId: string;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>({
    query: SELLING_PLAN_GROUP_DELETE_MUTATION,
    variables: { id: groupId },
  });

  throwOnUserErrors(data, "sellingPlanGroupDelete");
  return data.sellingPlanGroupDelete.deletedSellingPlanGroupId;
}

/**
 * List all selling plan groups.
 */
export async function getSellingPlanGroups(): Promise<AdminSellingPlanGroup[]> {
  const data = await adminFetch<{
    sellingPlanGroups: {
      edges: { node: Record<string, unknown> }[];
    };
  }>({
    query: SELLING_PLAN_GROUPS_QUERY,
  });

  return data.sellingPlanGroups.edges.map((edge) =>
    flattenSellingPlanGroup(edge.node)
  );
}

// ─── Subscription Contract operations ────────────────────────────────

/**
 * List subscription contracts, optionally filtered by status.
 */
export async function getSubscriptionContracts(
  status?: SubscriptionContractStatus
): Promise<SubscriptionContract[]> {
  const queryFilter = status ? `status:${status}` : undefined;

  const data = await adminFetch<{
    subscriptionContracts: {
      edges: { node: Record<string, unknown> }[];
    };
  }>({
    query: SUBSCRIPTION_CONTRACTS_QUERY,
    variables: { query: queryFilter },
  });

  return data.subscriptionContracts.edges.map((edge) =>
    flattenContract(edge.node)
  );
}

/**
 * Get a single subscription contract by ID.
 */
export async function getSubscriptionContract(
  id: string
): Promise<SubscriptionContract> {
  const data = await adminFetch<{
    subscriptionContract: Record<string, unknown>;
  }>({
    query: SUBSCRIPTION_CONTRACT_QUERY,
    variables: { id },
  });

  return flattenContract(data.subscriptionContract);
}

/**
 * Get billing attempts for a subscription contract.
 */
export async function getBillingAttempts(
  contractId: string
): Promise<BillingAttempt[]> {
  const data = await adminFetch<{
    subscriptionContract: {
      billingAttempts: {
        edges: { node: BillingAttempt }[];
      };
    };
  }>({
    query: SUBSCRIPTION_BILLING_ATTEMPTS_QUERY,
    variables: { contractId },
  });

  return flattenEdges(data.subscriptionContract.billingAttempts);
}

// ─── Billing operations ─────────────────────────────────────────────

/**
 * Create a billing attempt to charge a customer for a subscription contract.
 * The idempotencyKey prevents duplicate charges.
 */
export async function createBillingAttempt(
  contractId: string,
  idempotencyKey: string
): Promise<{
  id: string;
  ready: boolean;
  errorMessage: string | null;
  errorCode: string | null;
}> {
  const data = await adminFetch<{
    subscriptionBillingAttemptCreate: {
      subscriptionBillingAttempt: {
        id: string;
        ready: boolean;
        errorMessage: string | null;
        errorCode: string | null;
      };
      userErrors: { field: string[] | null; message: string }[];
    };
  }>({
    query: SUBSCRIPTION_BILLING_ATTEMPT_CREATE_MUTATION,
    variables: {
      subscriptionContractId: contractId,
      subscriptionBillingAttemptInput: { idempotencyKey },
    },
  });

  throwOnUserErrors(data, "subscriptionBillingAttemptCreate");
  return data.subscriptionBillingAttemptCreate.subscriptionBillingAttempt;
}

// ─── Customer tag operations ─────────────────────────────────────────

const MEMBERSHIP_TAGS = ["member", "member-standard", "member-premium"] as const;

/**
 * Add membership tag to a customer. Removes lower-tier tags when upgrading.
 * customerId must be a Shopify Admin GID (e.g., "gid://shopify/Customer/12345").
 */
export async function addMembershipTag(
  customerId: string,
  tier: "standard" | "premium"
): Promise<void> {
  const tagToAdd = tier === "premium" ? "member-premium" : "member-standard";
  const tagsToRemove = MEMBERSHIP_TAGS.filter((t) => t !== tagToAdd);

  // Remove old tags first, then add new one
  if (tagsToRemove.length > 0) {
    try {
      await adminFetch({
        query: CUSTOMER_TAGS_REMOVE_MUTATION,
        variables: { id: customerId, tags: [...tagsToRemove] },
      });
    } catch {
      // Non-critical — tags might not exist
    }
  }

  const data = await adminFetch<{
    tagsAdd: {
      node: { id: string };
      userErrors: { field: string[] | null; message: string }[];
    };
  }>({
    query: CUSTOMER_TAGS_ADD_MUTATION,
    variables: { id: customerId, tags: [tagToAdd, "member"] },
  });

  throwOnUserErrors(data, "tagsAdd");
}

/**
 * Remove all membership tags from a customer (on cancellation/expiry).
 */
export async function removeMembershipTags(
  customerId: string
): Promise<void> {
  const data = await adminFetch<{
    tagsRemove: {
      node: { id: string };
      userErrors: { field: string[] | null; message: string }[];
    };
  }>({
    query: CUSTOMER_TAGS_REMOVE_MUTATION,
    variables: { id: customerId, tags: [...MEMBERSHIP_TAGS] },
  });

  throwOnUserErrors(data, "tagsRemove");
}

// ─── Contract modification (draft pattern) ───────────────────────────

/**
 * Create a draft from an existing contract and return the draft ID.
 * Shared by updateSubscriptionContract and changeSubscriptionLineItem.
 */
async function createContractDraft(contractId: string): Promise<string> {
  const draftData = await adminFetch<{
    subscriptionContractUpdate: {
      draft: { id: string; status: string };
      userErrors: { field: string[] | null; message: string }[];
    };
  }>({
    query: SUBSCRIPTION_CONTRACT_UPDATE_MUTATION,
    variables: { contractId },
  });

  throwOnUserErrors(draftData, "subscriptionContractUpdate");
  return draftData.subscriptionContractUpdate.draft.id;
}

/**
 * Commit a draft to apply changes and return the resulting contract.
 */
async function commitDraft(
  draftId: string
): Promise<{ id: string; status: string }> {
  const commitData = await adminFetch<{
    subscriptionDraftCommit: {
      contract: { id: string; status: string };
      userErrors: { field: string[] | null; message: string }[];
    };
  }>({
    query: SUBSCRIPTION_DRAFT_COMMIT_MUTATION,
    variables: { draftId },
  });

  throwOnUserErrors(commitData, "subscriptionDraftCommit");
  return commitData.subscriptionDraftCommit.contract;
}

/**
 * Update a subscription contract using Shopify's draft pattern:
 * 1. Create a draft from the existing contract
 * 2. Apply updates to the draft
 * 3. Commit the draft to apply changes
 */
export async function updateSubscriptionContract(
  contractId: string,
  updates: SubscriptionDraftInput
): Promise<{ id: string; status: string }> {
  const draftId = await createContractDraft(contractId);

  // Apply updates to the draft
  const updateData = await adminFetch<{
    subscriptionDraftUpdate: {
      draft: { id: string; status: string };
      userErrors: { field: string[] | null; message: string }[];
    };
  }>({
    query: SUBSCRIPTION_DRAFT_UPDATE_MUTATION,
    variables: { draftId, input: updates },
  });

  throwOnUserErrors(updateData, "subscriptionDraftUpdate");

  return commitDraft(draftId);
}

/**
 * Change a line item in a subscription contract.
 * Uses the draft pattern: create draft → remove old line → add new line → commit.
 *
 * @param contractId - The subscription contract GID
 * @param oldLineId - The GID of the line to remove
 * @param newLine - The new line item to add
 */
export async function changeSubscriptionLineItem(
  contractId: string,
  oldLineId: string,
  newLine: SubscriptionLineInput
): Promise<{ id: string; status: string }> {
  const draftId = await createContractDraft(contractId);

  // Remove old line
  const removeData = await adminFetch<{
    subscriptionDraftLineRemove: {
      lineRemoved: { id: string; title: string } | null;
      draft: { id: string; status: string };
      userErrors: { field: string[] | null; message: string }[];
    };
  }>({
    query: SUBSCRIPTION_DRAFT_LINE_REMOVE_MUTATION,
    variables: { draftId, lineId: oldLineId },
  });

  throwOnUserErrors(removeData, "subscriptionDraftLineRemove");

  // Add new line
  const addData = await adminFetch<{
    subscriptionDraftLineAdd: {
      lineAdded: { id: string; title: string } | null;
      draft: { id: string; status: string };
      userErrors: { field: string[] | null; message: string }[];
    };
  }>({
    query: SUBSCRIPTION_DRAFT_LINE_ADD_MUTATION,
    variables: { draftId, input: newLine },
  });

  throwOnUserErrors(addData, "subscriptionDraftLineAdd");

  return commitDraft(draftId);
}
