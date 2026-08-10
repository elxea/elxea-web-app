/**
 * Tests for cursor pagination in lib/shopify/subscription-admin.ts.
 *
 * この層が守るべき契約:
 *   1. getSubscriptionContracts は connection を **最後のページまで** 走査する。
 *      旧実装はクエリを 1 回だけ投げていたため、ACTIVE 契約の 21 件目以降が
 *      呼び出し側に渡らず、定期課金 cron が静かに取りこぼしていた
 *      (pageInfo / endCursor はクエリに定義済みだが未使用だった)。
 *   2. 2 ページ目以降は 1 ページ目の endCursor を `after` として送る。
 *      `first` / `after` が実際にリクエスト本体へ載ることをここで観測する。
 *   3. getBillingAttempts も同じくページングする。督促判定は失敗試行の
 *      「件数」で retry / pause を決めるため、先頭 20 件で切れると
 *      失敗を数え落として retry 予算を超えて課金しうる。
 *   4. **異常時は truncate せず必ず例外**。silent truncation を別の形で
 *      復活させないための境界:
 *        - hasNextPage=true かつ endCursor=null
 *        - endCursor が進まない (サーバ側ページングのループ)
 *        - maxPages 上限の到達
 *        - pageInfo を含まない応答 / connection 不在 (契約が存在しない等)
 *
 * fetch はスタブして outbound リクエストの本体を観測する (外部送信はしない)。
 * Ref: https://shopify.dev/docs/api/usage/pagination-graphql
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// admin-client は module load 時に env を定数へ取り込むため、import より前に置く。
vi.hoisted(() => {
  process.env.SHOPIFY_STORE_DOMAIN = "elxea-test.myshopify.com";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "admin-api-token-for-tests";
});

import {
  getSubscriptionContracts,
  getBillingAttempts,
  ADMIN_CONNECTION_PAGE_SIZE,
} from "@/lib/shopify/subscription-admin";

type PageInfo = { hasNextPage: boolean; endCursor: string | null };

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Stub fetch with a per-call body factory (call index is 0-based). */
function stubFetch(bodyFor: (call: number) => unknown) {
  let call = 0;
  fetchMock = vi.fn(async () => jsonResponse(bodyFor(call++)));
  vi.stubGlobal("fetch", fetchMock);
}

/** Parse the JSON body of the nth (0-based) outbound request. */
function requestBody(n: number): {
  query: string;
  variables: Record<string, unknown>;
} {
  const call = fetchMock.mock.calls[n];
  expect(call, `expected at least ${n + 1} fetch call(s)`).toBeDefined();
  return JSON.parse((call![1] as RequestInit).body as string);
}

function contractNode(n: number) {
  return {
    id: `gid://shopify/SubscriptionContract/${n}`,
    status: "ACTIVE",
    createdAt: "2026-07-01T00:00:00Z",
    nextBillingDate: "2026-08-01T00:00:00Z",
    customer: {
      id: `gid://shopify/Customer/${n}`,
      displayName: `Customer ${n}`,
      email: `customer${n}@example.test`,
    },
    lines: { edges: [] },
    lastPaymentStatus: "SUCCEEDED",
  };
}

function contractsPage(nodes: unknown[], pageInfo: PageInfo) {
  return {
    data: {
      subscriptionContracts: {
        edges: nodes.map((node, i) => ({ node, cursor: `c${i}` })),
        pageInfo,
      },
    },
  };
}

function attemptNode(n: number) {
  return {
    id: `gid://shopify/SubscriptionBillingAttempt/${n}`,
    createdAt: "2026-08-01T00:00:00Z",
    ready: true,
    errorMessage: null,
    errorCode: null,
  };
}

function attemptsPage(nodes: unknown[], pageInfo: PageInfo) {
  return {
    data: {
      subscriptionContract: {
        billingAttempts: {
          edges: nodes.map((node, i) => ({ node, cursor: `a${i}` })),
          pageInfo,
        },
      },
    },
  };
}

const CONTRACT_GID = "gid://shopify/SubscriptionContract/4242";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getSubscriptionContracts のページング", () => {
  it("2 ページ以上ある connection を最後まで走査し全件返す (21 件目以降を落とさない)", async () => {
    const first = Array.from({ length: 50 }, (_, i) => contractNode(i + 1));
    const second = Array.from({ length: 5 }, (_, i) => contractNode(i + 51));

    stubFetch((call) =>
      call === 0
        ? contractsPage(first, { hasNextPage: true, endCursor: "cursor-page-1" })
        : contractsPage(second, { hasNextPage: false, endCursor: "cursor-page-2" })
    );

    const contracts = await getSubscriptionContracts("ACTIVE");

    expect(contracts).toHaveLength(55);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 旧実装で落ちていた領域 (21 件目 / 最終ページ) が含まれること
    expect(contracts.map((c) => c.id)).toContain(
      "gid://shopify/SubscriptionContract/21"
    );
    expect(contracts.map((c) => c.id)).toContain(
      "gid://shopify/SubscriptionContract/55"
    );
  });

  it("1 ページ目は after=null、2 ページ目は前ページの endCursor を送る", async () => {
    stubFetch((call) =>
      call === 0
        ? contractsPage([contractNode(1)], {
            hasNextPage: true,
            endCursor: "cursor-page-1",
          })
        : contractsPage([contractNode(2)], {
            hasNextPage: false,
            endCursor: null,
          })
    );

    await getSubscriptionContracts("ACTIVE");

    expect(requestBody(0).variables).toMatchObject({
      first: ADMIN_CONNECTION_PAGE_SIZE,
      after: null,
      query: "status:ACTIVE",
    });
    expect(requestBody(1).variables).toMatchObject({
      first: ADMIN_CONNECTION_PAGE_SIZE,
      after: "cursor-page-1",
      query: "status:ACTIVE",
    });
  });

  it("1 ページで終わるときは追加リクエストを出さない", async () => {
    stubFetch(() =>
      contractsPage([contractNode(1), contractNode(2)], {
        hasNextPage: false,
        endCursor: "cursor-page-1",
      })
    );

    const contracts = await getSubscriptionContracts();

    expect(contracts).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // status 未指定なら query フィルタは付けない
    expect(requestBody(0).variables.query).toBeUndefined();
  });

  it("maxPages 上限に達したら truncate せず例外を投げる", async () => {
    stubFetch((call) =>
      contractsPage([contractNode(call + 1)], {
        hasNextPage: true,
        endCursor: `cursor-${call}`,
      })
    );

    await expect(
      getSubscriptionContracts("ACTIVE", { pageSize: 1, maxPages: 3 })
    ).rejects.toThrow(/safety cap of 3 pages/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("hasNextPage=true なのに endCursor が null なら例外を投げる", async () => {
    stubFetch(() =>
      contractsPage([contractNode(1)], { hasNextPage: true, endCursor: null })
    );

    await expect(getSubscriptionContracts("ACTIVE")).rejects.toThrow(
      /endCursor is null/
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("endCursor が進まない応答は無限ループにせず例外を投げる", async () => {
    stubFetch(() =>
      contractsPage([contractNode(1)], {
        hasNextPage: true,
        endCursor: "stuck-cursor",
      })
    );

    await expect(getSubscriptionContracts("ACTIVE")).rejects.toThrow(
      /cursor did not advance/
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("pageInfo を含まない応答は例外を投げる (1 ページで黙って打ち切らない)", async () => {
    stubFetch(() => ({
      data: {
        subscriptionContracts: {
          edges: [{ node: contractNode(1), cursor: "c0" }],
        },
      },
    }));

    await expect(getSubscriptionContracts("ACTIVE")).rejects.toThrow(
      /no pageInfo/
    );
  });
});

describe("getBillingAttempts のページング", () => {
  it("2 ページ以上ある connection を最後まで走査し全件返す", async () => {
    const first = Array.from({ length: 50 }, (_, i) => attemptNode(i + 1));
    const second = [attemptNode(51), attemptNode(52)];

    stubFetch((call) =>
      call === 0
        ? attemptsPage(first, { hasNextPage: true, endCursor: "attempts-1" })
        : attemptsPage(second, { hasNextPage: false, endCursor: null })
    );

    const attempts = await getBillingAttempts(CONTRACT_GID);

    expect(attempts).toHaveLength(52);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(0).variables).toMatchObject({
      contractId: CONTRACT_GID,
      first: ADMIN_CONNECTION_PAGE_SIZE,
      after: null,
    });
    expect(requestBody(1).variables).toMatchObject({
      contractId: CONTRACT_GID,
      after: "attempts-1",
    });
  });

  it("契約が存在しない (subscriptionContract=null) 応答は空配列でなく例外", async () => {
    stubFetch(() => ({ data: { subscriptionContract: null } }));

    await expect(getBillingAttempts(CONTRACT_GID)).rejects.toThrow(
      /did not contain the expected connection/
    );
  });

  it("maxPages 上限に達したら truncate せず例外を投げる", async () => {
    stubFetch((call) =>
      attemptsPage([attemptNode(call + 1)], {
        hasNextPage: true,
        endCursor: `attempts-${call}`,
      })
    );

    await expect(
      getBillingAttempts(CONTRACT_GID, { pageSize: 2, maxPages: 2 })
    ).rejects.toThrow(/safety cap of 2 pages/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
