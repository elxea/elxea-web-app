import { adminFetch, throwOnUserErrors } from "./admin-client";
import {
  SELLING_PLAN_GROUP_CREATE_MUTATION,
  SELLING_PLAN_GROUP_UPDATE_MUTATION,
  SELLING_PLAN_GROUP_ADD_PRODUCTS_MUTATION,
  SELLING_PLAN_GROUP_DELETE_MUTATION,
  SUBSCRIPTION_BILLING_ATTEMPT_CREATE_MUTATION,
  SUBSCRIPTION_CONTRACT_SET_NEXT_BILLING_DATE_MUTATION,
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
  SUBSCRIPTION_CONTRACT_NEXT_BILLING_DATE_QUERY,
  SUBSCRIPTION_BILLING_ATTEMPTS_QUERY,
  SUBSCRIPTION_BILLING_CYCLES_QUERY,
} from "./admin-queries";
import type {
  AdminSellingPlanGroup,
  AdminSellingPlan,
  SellingPlanGroupInput,
  SubscriptionContract,
  SubscriptionContractLine,
  SubscriptionContractStatus,
  SubscriptionBillingCycle,
  SubscriptionBillingCyclesIndexRange,
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

// ─── Cursor pagination for Admin API connections ─────────────────────

/**
 * Nodes fetched per request. Shopify's connections accept up to 250, but the
 * Admin API throttles on *requested* query cost, and the contracts query nests
 * `lines(first: 10)` per contract — so a page of N contracts requests roughly
 * N x 11 points against a 1,000-point bucket that refills at 100/s. 25 keeps one
 * page near 275 points, so several pages can be walked back-to-back without the
 * burst outrunning the bucket. Raising this trades throttle headroom for round
 * trips; it is not free.
 *
 * Ref: https://shopify.dev/docs/api/usage/rate-limits
 */
export const ADMIN_CONNECTION_PAGE_SIZE = 25;

/**
 * Safety cap on the number of pages a single call will walk
 * (25 x 100 = 2,500 nodes).
 *
 * The cap exists to bound a broken server response, not to bound real data. It
 * is therefore a **hard error, not a silent stop**: returning the first N pages
 * of a connection that still says `hasNextPage: true` is exactly the failure
 * this pagination was added to remove (contracts past the first page were never
 * billed and nothing reported it). A loud 500 from the cron — captured by Sentry
 * — is recoverable; a quiet partial run is not.
 */
export const ADMIN_CONNECTION_MAX_PAGES = 100;

type GraphQLConnection<TNode> = {
  edges: { node: TNode }[];
  // Optional in the type on purpose: a query that forgets to select `pageInfo`
  // compiles fine and would otherwise page exactly once, reintroducing the bug.
  // Absence is checked at runtime and raised.
  pageInfo?: { hasNextPage: boolean; endCursor: string | null };
};

/**
 * How many times one page is re-requested after a throttle before giving up,
 * and the base backoff. Walking pages sends a burst of cost-bearing requests, so
 * `THROTTLED` here is an expected, retryable condition — unlike the structural
 * failures below, which are bugs and must surface immediately. Waiting is also
 * the documented remedy: the bucket refills at a fixed rate.
 */
const ADMIN_THROTTLE_RETRIES = 3;
const ADMIN_THROTTLE_BASE_DELAY_MS = 1000;

/** Per-call overrides for paginated getters. Defaults are the constants above. */
export type PaginationOptions = {
  pageSize?: number;
  maxPages?: number;
  /** Base backoff for throttle retries. 0 disables waiting (tests). */
  throttleDelayMs?: number;
};

function isThrottleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /throttl/i.test(message) || message.includes("429");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Walk every page of a Relay-style Admin API connection and return all nodes.
 *
 * Fails loudly instead of truncating on any of: a missing connection/`pageInfo`,
 * `hasNextPage: true` with no `endCursor`, a cursor that does not advance
 * (server-side pagination loop), or exhausting `maxPages`. Throttling is the one
 * error retried, with exponential backoff.
 */
async function fetchAllPages<TData, TNode>({
  query,
  variables,
  label,
  selectConnection,
  pageSize = ADMIN_CONNECTION_PAGE_SIZE,
  maxPages = ADMIN_CONNECTION_MAX_PAGES,
  throttleDelayMs = ADMIN_THROTTLE_BASE_DELAY_MS,
}: {
  query: string;
  variables?: Record<string, unknown>;
  label: string;
  selectConnection: (
    data: TData
  ) => GraphQLConnection<TNode> | null | undefined;
} & PaginationOptions): Promise<TNode[]> {
  const nodes: TNode[] = [];
  const seenCursors = new Set<string>();
  let after: string | null = null;

  /** One page, retrying only on throttle. */
  const fetchPage = async (page: number): Promise<TData> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await adminFetch<TData>({
          query,
          variables: { ...variables, first: pageSize, after },
        });
      } catch (error) {
        if (!isThrottleError(error) || attempt >= ADMIN_THROTTLE_RETRIES) {
          throw error;
        }
        console.warn(
          `[${label}] throttled on page ${page} (attempt ${attempt + 1}/` +
            `${ADMIN_THROTTLE_RETRIES + 1}), backing off`
        );
        await sleep(throttleDelayMs * 2 ** attempt);
      }
    }
  };

  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchPage(page);

    const connection = selectConnection(data);
    if (!connection) {
      throw new Error(
        `${label}: page ${page} response did not contain the expected connection`
      );
    }

    for (const edge of connection.edges) {
      nodes.push(edge.node);
    }

    const pageInfo = connection.pageInfo;
    if (!pageInfo) {
      throw new Error(
        `${label}: connection has no pageInfo — the query must select ` +
          `pageInfo { hasNextPage endCursor } for pagination to terminate correctly`
      );
    }

    if (!pageInfo.hasNextPage) {
      return nodes;
    }

    if (!pageInfo.endCursor) {
      throw new Error(
        `${label}: hasNextPage is true but endCursor is null on page ${page} ` +
          `(${nodes.length} nodes collected) — refusing to return a truncated result`
      );
    }

    if (seenCursors.has(pageInfo.endCursor)) {
      throw new Error(
        `${label}: pagination cursor did not advance on page ${page} ` +
          `(${nodes.length} nodes collected) — aborting to avoid an infinite loop`
      );
    }

    seenCursors.add(pageInfo.endCursor);
    after = pageInfo.endCursor;
  }

  throw new Error(
    `${label}: exceeded the pagination safety cap of ${maxPages} pages ` +
      `x ${pageSize} nodes (${nodes.length} collected, more pages remain) — ` +
      `refusing to return a truncated result`
  );
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
 *
 * Walks **every** page of the connection. Before this was paginated the caller
 * silently received only the first 20 contracts, so the 21st ACTIVE contract
 * onward was never picked up by the billing cron.
 */
export async function getSubscriptionContracts(
  status?: SubscriptionContractStatus,
  options: PaginationOptions = {}
): Promise<SubscriptionContract[]> {
  const queryFilter = status ? `status:${status}` : undefined;

  const nodes = await fetchAllPages<
    {
      subscriptionContracts: GraphQLConnection<Record<string, unknown>> | null;
    },
    Record<string, unknown>
  >({
    query: SUBSCRIPTION_CONTRACTS_QUERY,
    variables: { query: queryFilter },
    label: `subscriptionContracts${status ? ` (status:${status})` : ""}`,
    selectConnection: (data) => data.subscriptionContracts,
    ...options,
  });

  return nodes.map((node) => flattenContract(node));
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
 *
 * Walks every page. The dunning logic counts failed attempts to decide whether
 * to retry or pause, so a truncated list under-counts failures and can retry a
 * contract past its retry budget.
 */
export async function getBillingAttempts(
  contractId: string,
  options: PaginationOptions = {}
): Promise<BillingAttempt[]> {
  return fetchAllPages<
    {
      subscriptionContract: {
        billingAttempts: GraphQLConnection<BillingAttempt> | null;
      } | null;
    },
    BillingAttempt
  >({
    query: SUBSCRIPTION_BILLING_ATTEMPTS_QUERY,
    variables: { contractId },
    label: `subscriptionContract.billingAttempts (${contractId})`,
    selectConnection: (data) => data.subscriptionContract?.billingAttempts,
    ...options,
  });
}

/**
 * Read only `nextBillingDate` (plus id/status) for one contract.
 *
 * Deliberately not `getSubscriptionContract`: that query pulls lines, payment
 * method and shipping address, and `advanceNextBillingDate` reads this value
 * twice per contract (once to decide, once immediately before writing). Using
 * the heavy query there multiplies the cron's requested query cost for two
 * fields.
 */
export async function getContractNextBillingDate(
  contractId: string
): Promise<string | null> {
  const data = await adminFetch<{
    subscriptionContract: {
      id: string;
      status: SubscriptionContractStatus;
      nextBillingDate: string | null;
    } | null;
  }>({
    query: SUBSCRIPTION_CONTRACT_NEXT_BILLING_DATE_QUERY,
    variables: { id: contractId },
  });

  if (!data.subscriptionContract) {
    throw new Error(
      `subscriptionContract(${contractId}) returned null — the contract does not ` +
        `exist or the Admin token cannot read it`
    );
  }

  return data.subscriptionContract.nextBillingDate;
}

// ─── Billing cycle operations ────────────────────────────────────────

/**
 * Index-range width used when walking a contract's billing cycles.
 *
 * Measured against the live store on 2026-08-12 (API 2026-07): a range of
 * `1..50` succeeds, `1..250` fails with `Upcoming billing cycle selected past
 * limit.` Shopify does not document the exact ceiling, so this stays well
 * inside the range that was actually observed to work, and matches
 * `ADMIN_CONNECTION_PAGE_SIZE` so one window is one page.
 */
export const BILLING_CYCLE_INDEX_WINDOW = 25;

/**
 * Hard ceiling on a single window's width. Anything wider is rejected locally
 * rather than sent, because Shopify's error for an over-wide range
 * (`Upcoming billing cycle selected past limit.`) reads like a data problem and
 * would send a debugger looking at the contract instead of at the caller.
 */
export const BILLING_CYCLE_INDEX_MAX_SPAN = 50;

/**
 * Fetch a contract's billing cycles for an explicit `cycleIndex` range,
 * ordered by `cycleIndex`.
 *
 * The range selector is **required by Shopify** — omitting it returns
 * `subscriptionBillingCycles requires exactly one of
 * billing_cycles_date_range_selector, billing_cycles_index_range_selector`
 * (verified against the live schema, not inferred: introspection reports both
 * selectors as optional). `SUBSCRIPTION_BILLING_CYCLES_QUERY` therefore declares
 * the index selector non-null so a missing selector fails at the call site.
 *
 * Index ranges are used rather than date ranges on purpose: see the query's
 * docblock — a date window anchored on "now" silently skips UNBILLED cycles that
 * sit in the past, which would advance a contract past a charge it never took.
 */
export async function getBillingCycles(
  contractId: string,
  range: SubscriptionBillingCyclesIndexRange,
  options: PaginationOptions = {}
): Promise<SubscriptionBillingCycle[]> {
  const { startIndex, endIndex } = range;

  if (!Number.isInteger(startIndex) || startIndex < 1) {
    throw new Error(
      `getBillingCycles: startIndex must be an integer >= 1 (got ${startIndex}) — ` +
        `Shopify rejects index 0 with "Billing cycle index out of range."`
    );
  }
  if (!Number.isInteger(endIndex) || endIndex < startIndex) {
    throw new Error(
      `getBillingCycles: endIndex must be an integer >= startIndex ` +
        `(got ${startIndex}..${endIndex})`
    );
  }
  const span = endIndex - startIndex + 1;
  if (span > BILLING_CYCLE_INDEX_MAX_SPAN) {
    throw new Error(
      `getBillingCycles: index range ${startIndex}..${endIndex} spans ${span} ` +
        `cycles, over the ${BILLING_CYCLE_INDEX_MAX_SPAN} that Shopify was ` +
        `measured to accept — walk narrower windows instead`
    );
  }

  return fetchAllPages<
    {
      subscriptionBillingCycles: GraphQLConnection<SubscriptionBillingCycle> | null;
    },
    SubscriptionBillingCycle
  >({
    query: SUBSCRIPTION_BILLING_CYCLES_QUERY,
    variables: {
      contractId,
      billingCyclesIndexRangeSelector: { startIndex, endIndex },
    },
    label: `subscriptionBillingCycles (${contractId} #${startIndex}-${endIndex})`,
    selectConnection: (data) => data.subscriptionBillingCycles,
    ...options,
  });
}

/**
 * Set a contract's `nextBillingDate`.
 *
 * This is the only write that moves a contract's billing date forward:
 * `nextBillingDate` is app-managed and `subscriptionBillingAttemptCreate` does
 * not touch it. The derivation of *which* date to write lives in
 * `lib/shopify/next-billing-date.ts` — this function only transports it.
 *
 * @param date - RFC3339 / ISO-8601 date-time string (GraphQL `DateTime!`).
 */
export async function setNextBillingDate(
  contractId: string,
  date: string
): Promise<{ id: string; nextBillingDate: string | null }> {
  const data = await adminFetch<{
    subscriptionContractSetNextBillingDate: {
      contract: { id: string; nextBillingDate: string | null } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>({
    query: SUBSCRIPTION_CONTRACT_SET_NEXT_BILLING_DATE_MUTATION,
    variables: { contractId, date },
  });

  throwOnUserErrors(data, "subscriptionContractSetNextBillingDate");

  const contract = data.subscriptionContractSetNextBillingDate.contract;
  if (!contract) {
    throw new Error(
      `subscriptionContractSetNextBillingDate(${contractId}) reported no ` +
        `userErrors but returned no contract — treating as a failed write`
    );
  }
  return contract;
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
