/**
 * マイページ 1 描画あたりの外向き往復を、上限つきで縛るテスト（再設計 Wave 3 / F15）。
 *
 * ## 直している症状
 *
 * マイページの表示は、独立した問い合わせを **直列に足し算** していた。
 *
 *   1. `getCustomerFromSession()`   … Shopify へ往復（`getSession` 1 回目）
 *   2. `loadAccountView()`          … 定期便で `getSession` 2 回目、
 *                                      `resolveIdentity()` で 3 回目
 *   3. `fetchLineLinkageStatus()`   … cx-agent へ往復（**2 を待ち切ってから**）
 *
 * `getSession()` は access token が切れていればリフレッシュに出るので、3 回呼ばれると
 * **同じ refresh token を 3 本が同時に使う**（Shopify はリフレッシュのたびに token を
 * 回すため、先に着いた 1 本以外が無効な token を掴む）。3 の直列は、cx-agent が遅い日に
 * その 3000ms がまるごと表示時間に上乗せされることを意味していた。
 *
 * この経路が守るべき契約:
 *   1. `getSession()` は **1 リクエスト 1 回**（`React.cache` によるメモ化）。
 *   2. `resolveIdentity()` も同じく 1 リクエスト 1 回。
 *   3. cx-agent への往復は **1 描画あたり 1 回以下**。順引き・逆引きのどちらも、
 *      走行中に同じ引数で重ねて呼ばれたら 1 本にまとめる（並列化してもキャッシュが
 *      冷えている初回に 2 本出さない）。
 *
 * 1・2 は `React.cache` がリクエスト境界を持つ環境でしか効かない（テストは素通し）ので、
 * ここでは **3 の走行中重複の畳み込み** を実挙動として観測し、1・2 は配線の形として
 * 押さえる（`__tests__/session-request-dedup.test.ts`）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/chat/proxy", () => ({
  CX_AGENT_BASE_URL: "https://cx-agent.example.test",
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

import {
  fetchLineLinkageStatus,
  fetchLineLinkageStatusForLineUser,
  fetchShopifyCustomerIdForLineUser,
  __clearLinkageCacheForTest,
} from "@/lib/line/linkage-status";

const originalFetch = globalThis.fetch;
const originalSecret = process.env.SYNC_API_SECRET;

/** 応答を遅らせる偽 cx-agent。走行中に重ねて呼ぶ窓を作るために使う。 */
function slowCxAgent(body: unknown, delayMs = 20) {
  return vi.fn(
    () =>
      new Promise((resolve) => {
        setTimeout(
          () =>
            resolve({
              ok: true,
              status: 200,
              json: async () => body,
            } as Response),
          delayMs,
        );
      }),
  );
}

beforeEach(() => {
  process.env.SYNC_API_SECRET = "test-secret";
  __clearLinkageCacheForTest();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.SYNC_API_SECRET;
  else process.env.SYNC_API_SECRET = originalSecret;
  __clearLinkageCacheForTest();
});

describe("cx-agent への往復は 1 描画あたり 1 回以下", () => {
  it("逆引きが同時に 2 本呼ばれても、cx-agent へは 1 回しか行かない", async () => {
    /* マイページは本人解決（`resolveIdentity` → `fetchShopifyCustomerIdForLineUser`）と
       連携状態の照会（`fetchLineLinkageStatusForLineUser`）を **並列に** 始める。
       キャッシュは着地後にしか効かないので、畳み込みが無いとここが 2 往復になる。 */
    const fetchMock = slowCxAgent({
      linked: true,
      linkedAt: "2026-08-25T00:00:00.000Z",
      shopify_customer_id: "7654321",
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const [customer, status] = await Promise.all([
      fetchShopifyCustomerIdForLineUser("Uabc"),
      fetchLineLinkageStatusForLineUser("Uabc"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(customer).toBe("7654321");
    expect(status).toEqual({
      linked: true,
      linkedAt: "2026-08-25T00:00:00.000Z",
    });
  });

  it("順引きが同時に 2 本呼ばれても、cx-agent へは 1 回しか行かない", async () => {
    const fetchMock = slowCxAgent({
      linked: false,
      linkedAt: null,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const [a, b] = await Promise.all([
      fetchLineLinkageStatus("7654321"),
      fetchLineLinkageStatus("7654321"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ linked: false, linkedAt: null });
    expect(b).toEqual(a);
  });

  it("畳み込みはキャッシュではない — 着地後の新しい呼び出しは順引きし直す", async () => {
    /* 順引きにキャッシュを足したわけではない（連携直後に古い「未連携」を見せない、
       という既存の判断は変えていない）。畳むのは **同時に走っている分だけ**。 */
    const fetchMock = slowCxAgent({ linked: false, linkedAt: null }, 1);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await fetchLineLinkageStatus("7654321");
    await fetchLineLinkageStatus("7654321");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("別の人の逆引きは畳まない（他人の答えを共有しない）", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.includes("Uabc")
          ? { linked: true, linkedAt: null, shopify_customer_id: "111" }
          : { linked: true, linkedAt: null, shopify_customer_id: "222" },
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const [a, b] = await Promise.all([
      fetchShopifyCustomerIdForLineUser("Uabc"),
      fetchShopifyCustomerIdForLineUser("Uxyz"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(a).toBe("111");
    expect(b).toBe("222");
  });
});
