/**
 * Tests for Customer Account API 所有者照合 + 定期便スキップの引数形状。
 *
 * この層が守るべき契約:
 *   1. verifySubscriptionContractOwnership は「所有が積極的に証明できたときだけ」true。
 *      HTTP エラー / GraphQL エラー / contract=null / GID 形式不正 / 別契約 ID の
 *      いずれも false（fail-closed）。判定不能を「たぶん所有者」に丸めない。
 *   2. resolveNextBillingCycleIndex は upcomingBillingCycles の実データから
 *      「まだ skip されていない最初のサイクル」の cycleIndex を返す。
 *      判定不能は null（既定値 0 へフォールバックしない。index は 1-based）。
 *   3. skipNextBillingCycle は subscriptionBillingCycleSkip へ
 *      billingCycleInput: { contractId, selector: { index } } の 1 引数だけを送る。
 *      旧実装の subscriptionContractId / billingCycleIndex はスキーマに存在しない。
 *
 * fetch はスタブして outbound リクエストの本体を観測する（外部送信はしない）。
 * Ref: https://shopify.dev/docs/api/customer/latest/mutations/subscriptionBillingCycleSkip
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  verifySubscriptionContractOwnership,
  resolveNextBillingCycleIndex,
  skipNextBillingCycle,
  isSubscriptionContractGid,
} from "@/lib/shopify/customer";

const TOKEN = "shcat_test_access_token";
const CONTRACT_GID = "gid://shopify/SubscriptionContract/1111";
const OTHER_CONTRACT_GID = "gid://shopify/SubscriptionContract/2222";

type StubResponse = {
  ok?: boolean;
  status?: number;
  body?: unknown;
};

let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch(...responses: StubResponse[]) {
  fetchMock = vi.fn(async () => {
    const next = responses.shift() ?? { ok: true, status: 200, body: { data: {} } };
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body ?? {}),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
}

/** Parse the JSON body of the nth (0-based) outbound request. */
function requestBody(n: number): { query: string; variables: Record<string, unknown> } {
  const call = fetchMock.mock.calls[n];
  expect(call, `expected at least ${n + 1} fetch call(s)`).toBeDefined();
  return JSON.parse((call[1] as RequestInit).body as string);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isSubscriptionContractGid", () => {
  it("accepts a well-formed SubscriptionContract GID", () => {
    expect(isSubscriptionContractGid(CONTRACT_GID)).toBe(true);
  });

  it("rejects other resource types, raw ids and non-strings", () => {
    expect(isSubscriptionContractGid("gid://shopify/Customer/1111")).toBe(false);
    expect(isSubscriptionContractGid("1111")).toBe(false);
    expect(isSubscriptionContractGid("gid://shopify/SubscriptionContract/abc")).toBe(false);
    expect(isSubscriptionContractGid("")).toBe(false);
    expect(isSubscriptionContractGid(undefined)).toBe(false);
    expect(isSubscriptionContractGid(null)).toBe(false);
    expect(isSubscriptionContractGid(1111)).toBe(false);
  });
});

describe("verifySubscriptionContractOwnership", () => {
  it("returns true when customer.subscriptionContract returns the same contract", async () => {
    stubFetch({ body: { data: { customer: { subscriptionContract: { id: CONTRACT_GID } } } } });

    await expect(
      verifySubscriptionContractOwnership(TOKEN, CONTRACT_GID)
    ).resolves.toBe(true);

    // Ownership is asked of the token holder's own `customer` scope.
    const body = requestBody(0);
    expect(body.query).toContain("customer");
    expect(body.query).toContain("subscriptionContract(id: $id)");
    expect(body.variables).toEqual({ id: CONTRACT_GID });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: TOKEN,
    });
  });

  it("returns false when the contract is not the caller's (null contract)", async () => {
    stubFetch({ body: { data: { customer: { subscriptionContract: null } } } });

    await expect(
      verifySubscriptionContractOwnership(TOKEN, OTHER_CONTRACT_GID)
    ).resolves.toBe(false);
  });

  it("returns false when the API returns a different contract id", async () => {
    stubFetch({
      body: { data: { customer: { subscriptionContract: { id: OTHER_CONTRACT_GID } } } },
    });

    await expect(
      verifySubscriptionContractOwnership(TOKEN, CONTRACT_GID)
    ).resolves.toBe(false);
  });

  it("fails closed on GraphQL errors", async () => {
    stubFetch({ body: { errors: [{ message: "Access denied" }] } });

    await expect(
      verifySubscriptionContractOwnership(TOKEN, CONTRACT_GID)
    ).resolves.toBe(false);
  });

  it("fails closed on an HTTP error", async () => {
    stubFetch({ ok: false, status: 403, body: {} });

    await expect(
      verifySubscriptionContractOwnership(TOKEN, CONTRACT_GID)
    ).resolves.toBe(false);
  });

  it("fails closed when the request throws (network failure)", async () => {
    fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifySubscriptionContractOwnership(TOKEN, CONTRACT_GID)
    ).resolves.toBe(false);
  });

  it("rejects a malformed contract id without calling the API", async () => {
    stubFetch({ body: { data: { customer: { subscriptionContract: { id: CONTRACT_GID } } } } });

    await expect(
      verifySubscriptionContractOwnership(TOKEN, "gid://shopify/Customer/1111")
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an empty access token without calling the API", async () => {
    stubFetch({ body: { data: { customer: { subscriptionContract: { id: CONTRACT_GID } } } } });

    await expect(
      verifySubscriptionContractOwnership("", CONTRACT_GID)
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resolveNextBillingCycleIndex", () => {
  function cyclesResponse(
    nodes: { cycleIndex: number; skipped: boolean; billingAttemptExpectedDate?: string }[]
  ) {
    return {
      body: {
        data: {
          customer: {
            subscriptionContract: {
              id: CONTRACT_GID,
              upcomingBillingCycles: {
                edges: nodes.map((node) => ({
                  node: { billingAttemptExpectedDate: null, ...node },
                })),
              },
            },
          },
        },
      },
    };
  }

  it("returns the first un-skipped cycle index from real data", async () => {
    stubFetch(
      cyclesResponse([
        { cycleIndex: 3, skipped: false },
        { cycleIndex: 4, skipped: false },
      ])
    );

    await expect(resolveNextBillingCycleIndex(TOKEN, CONTRACT_GID)).resolves.toBe(3);

    const body = requestBody(0);
    expect(body.query).toContain("upcomingBillingCycles(first: $first, sortKey: CYCLE_INDEX)");
    expect(body.variables).toMatchObject({ id: CONTRACT_GID });
  });

  it("skips cycles already marked skipped", async () => {
    stubFetch(
      cyclesResponse([
        { cycleIndex: 5, skipped: true },
        { cycleIndex: 6, skipped: false },
      ])
    );

    await expect(resolveNextBillingCycleIndex(TOKEN, CONTRACT_GID)).resolves.toBe(6);
  });

  it("returns null when there are no upcoming cycles", async () => {
    stubFetch(cyclesResponse([]));

    await expect(resolveNextBillingCycleIndex(TOKEN, CONTRACT_GID)).resolves.toBeNull();
  });

  it("returns null when the contract is not the caller's", async () => {
    stubFetch({ body: { data: { customer: { subscriptionContract: null } } } });

    await expect(resolveNextBillingCycleIndex(TOKEN, CONTRACT_GID)).resolves.toBeNull();
  });

  it("returns null (never 0) on GraphQL errors", async () => {
    stubFetch({ body: { errors: [{ message: "boom" }] } });

    await expect(resolveNextBillingCycleIndex(TOKEN, CONTRACT_GID)).resolves.toBeNull();
  });

  it("rejects a cycleIndex below 1 as unusable", async () => {
    stubFetch(cyclesResponse([{ cycleIndex: 0, skipped: false }]));

    await expect(resolveNextBillingCycleIndex(TOKEN, CONTRACT_GID)).resolves.toBeNull();
  });
});

describe("skipNextBillingCycle", () => {
  it("sends billingCycleInput { contractId, selector: { index } } and nothing else", async () => {
    stubFetch(
      // 1st call: resolve the next cycle index
      {
        body: {
          data: {
            customer: {
              subscriptionContract: {
                id: CONTRACT_GID,
                upcomingBillingCycles: {
                  edges: [
                    { node: { cycleIndex: 7, skipped: false, billingAttemptExpectedDate: null } },
                  ],
                },
              },
            },
          },
        },
      },
      // 2nd call: the skip mutation
      {
        body: {
          data: {
            subscriptionBillingCycleSkip: {
              billingCycle: { cycleIndex: 7, skipped: true },
              userErrors: [],
            },
          },
        },
      }
    );

    await expect(skipNextBillingCycle(TOKEN, CONTRACT_GID)).resolves.toEqual({
      success: true,
    });

    const mutation = requestBody(1);
    expect(mutation.query).toContain(
      "subscriptionBillingCycleSkip(billingCycleInput: $billingCycleInput)"
    );
    expect(mutation.variables).toEqual({
      billingCycleInput: {
        contractId: CONTRACT_GID,
        selector: { index: 7 },
      },
    });

    // Guard against a regression back to the non-existent arguments.
    expect(mutation.query).not.toContain("subscriptionContractId");
    expect(mutation.query).not.toContain("billingCycleIndex");
    expect(Object.keys(mutation.variables)).toEqual(["billingCycleInput"]);
  });

  it("does not attempt the mutation when the next cycle cannot be resolved", async () => {
    stubFetch({ body: { data: { customer: { subscriptionContract: null } } } });

    const result = await skipNextBillingCycle(TOKEN, CONTRACT_GID);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/next billing cycle/i);
    expect(fetchMock).toHaveBeenCalledTimes(1); // resolve only, no mutation
  });

  it("rejects a malformed contract id without any API call", async () => {
    stubFetch({ body: { data: {} } });

    const result = await skipNextBillingCycle(TOKEN, "1111");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid subscription contract id/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an explicit index of 0 (indexes are 1-based)", async () => {
    stubFetch({ body: { data: {} } });

    const result = await skipNextBillingCycle(TOKEN, CONTRACT_GID, 0);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid billing cycle index/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses an explicitly supplied valid index without resolving", async () => {
    stubFetch({
      body: {
        data: {
          subscriptionBillingCycleSkip: {
            billingCycle: { cycleIndex: 2, skipped: true },
            userErrors: [],
          },
        },
      },
    });

    await expect(skipNextBillingCycle(TOKEN, CONTRACT_GID, 2)).resolves.toEqual({
      success: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestBody(0).variables).toEqual({
      billingCycleInput: { contractId: CONTRACT_GID, selector: { index: 2 } },
    });
  });

  it("surfaces userErrors as a failure", async () => {
    stubFetch({
      body: {
        data: {
          subscriptionBillingCycleSkip: {
            billingCycle: null,
            userErrors: [{ field: ["billingCycleInput"], message: "Cycle already skipped" }],
          },
        },
      },
    });

    const result = await skipNextBillingCycle(TOKEN, CONTRACT_GID, 4);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cycle already skipped");
  });
});
