/**
 * Tests for 配送スキップの**サーバ側二重実行ガード** (シナリオ S6-3)。
 *
 * 是正前の欠陥 (2026-08-11 の失敗系監査 Medium-4):
 *   サーバは常に「次の未スキップ周期」を自分で解決するため、別タブやリロード後に
 *   もう一度スキップが飛ぶと、顧客が意図した周期ではなく**その次の周期**まで黙って
 *   飛んだ (連続 2 周期スキップ = 顧客の意図と違う売上減)。画面側は isPending で
 *   連打を止めていたが、単一画面の中でしか効かない。
 *
 * この仕様が守るべき契約:
 *   1. 顧客が見ていたお届け予定日と、サーバが解決した周期の予定日が一致するときだけ
 *      スキップする。
 *   2. 一致しなければ **mutation を 1 度も出さず** に拒否する (2 周期目を飛ばさない)。
 *   3. 周期 index はクライアントから受け取らない (詐称できない) ままである。
 *   4. 判定できない (予定日が読めない) ときも拒否側に倒す。
 *   5. 日付の書式ゆれ (時刻付き / タイムゾーン表記) で正当なスキップを弾かない。
 *
 * Customer Account API は fetch mock。**Shopify へ実アクセスしない**。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { skipNextBillingCycle } from "@/lib/shopify/customer";
import {
  matchesExpectedBillingDate,
  STALE_BILLING_CYCLE_VIEW,
} from "@/lib/subscription-view";

const TOKEN = "shcat_test_access_token";
const CONTRACT_GID = "gid://shopify/SubscriptionContract/1111";

let fetchMock: ReturnType<typeof vi.fn>;

/** upcomingBillingCycles の応答 → その後に mutation 応答を返す fetch。 */
function stubCycles(
  nodes: {
    cycleIndex: number;
    skipped: boolean;
    billingAttemptExpectedDate: string | null;
  }[]
) {
  fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        customer: {
          subscriptionContract: {
            id: CONTRACT_GID,
            upcomingBillingCycles: { edges: nodes.map((node) => ({ node })) },
          },
        },
      },
    }),
    text: async () => "{}",
  });
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { subscriptionBillingCycleSkip: { userErrors: [] } } }),
    text: async () => "{}",
  });
  vi.stubGlobal("fetch", fetchMock);
}

/** mutation 呼び出し (2 回目の fetch) の body。 */
function mutationBody(): { query: string; variables: Record<string, unknown> } {
  const call = fetchMock.mock.calls[1];
  expect(call, "mutation was not sent").toBeDefined();
  return JSON.parse((call![1] as { body: string }).body);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("matchesExpectedBillingDate (突き合わせの純関数)", () => {
  it("同じ暦日なら書式が違っても一致とみなす", () => {
    expect(
      matchesExpectedBillingDate("2026-09-01T00:00:00.000Z", "2026-09-01")
    ).toBe(true);
  });

  it("別の日なら一致しない", () => {
    expect(matchesExpectedBillingDate("2026-10-01", "2026-09-01")).toBe(false);
  });

  it("読めない値・空値は一致しない (拒否側に倒す)", () => {
    expect(matchesExpectedBillingDate(null, "2026-09-01")).toBe(false);
    expect(matchesExpectedBillingDate("2026-09-01", null)).toBe(false);
    expect(matchesExpectedBillingDate("garbage", "2026-09-01")).toBe(false);
    expect(matchesExpectedBillingDate("2026-09-01", "  ")).toBe(false);
  });
});

describe("skipNextBillingCycle: 顧客が見ていた周期と一致するときだけ飛ばす", () => {
  it("一致すればスキップする (サーバが解決した index を使う)", async () => {
    stubCycles([
      { cycleIndex: 7, skipped: false, billingAttemptExpectedDate: "2026-09-01T00:00:00.000Z" },
    ]);

    const result = await skipNextBillingCycle(
      TOKEN,
      CONTRACT_GID,
      undefined,
      "2026-09-01"
    );

    expect(result).toEqual({ success: true });
    expect(mutationBody().variables).toEqual({
      billingCycleInput: {
        contractId: CONTRACT_GID,
        selector: { index: 7 },
      },
    });
  });

  /**
   * 二重実行の再現: 1 回目で周期 7 を飛ばした後、古い画面 (予定日 09-01 のまま) から
   * もう一度実行される。サーバが解決するのは既に周期 8 なので、飛ばしてはいけない。
   */
  it("古い画面からの再実行では mutation を 1 度も出さない (連続 2 周期スキップを防ぐ)", async () => {
    stubCycles([
      { cycleIndex: 7, skipped: true, billingAttemptExpectedDate: "2026-09-01T00:00:00.000Z" },
      { cycleIndex: 8, skipped: false, billingAttemptExpectedDate: "2026-10-01T00:00:00.000Z" },
    ]);

    const result = await skipNextBillingCycle(
      TOKEN,
      CONTRACT_GID,
      undefined,
      "2026-09-01"
    );

    expect(result).toEqual({ success: false, error: STALE_BILLING_CYCLE_VIEW });
    // 解決の 1 回だけ。mutation は出ていない
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("予定日が読めない周期は拒否する (検証できないまま飛ばさない)", async () => {
    stubCycles([{ cycleIndex: 7, skipped: false, billingAttemptExpectedDate: null }]);

    const result = await skipNextBillingCycle(
      TOKEN,
      CONTRACT_GID,
      undefined,
      "2026-09-01"
    );

    expect(result).toEqual({ success: false, error: STALE_BILLING_CYCLE_VIEW });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("期待日を渡さない呼び出しは従来どおり (低レベル API の後方互換)", async () => {
    stubCycles([
      { cycleIndex: 7, skipped: false, billingAttemptExpectedDate: "2026-09-01T00:00:00.000Z" },
    ]);

    const result = await skipNextBillingCycle(TOKEN, CONTRACT_GID);

    expect(result).toEqual({ success: true });
    expect(mutationBody().variables).toMatchObject({
      billingCycleInput: { selector: { index: 7 } },
    });
  });

  it("期待日が一致しても、index はクライアント指定ではなくサーバ解決値を使う", async () => {
    stubCycles([
      { cycleIndex: 12, skipped: false, billingAttemptExpectedDate: "2026-09-01" },
    ]);

    await skipNextBillingCycle(TOKEN, CONTRACT_GID, undefined, "2026-09-01");

    expect(mutationBody().variables).toMatchObject({
      billingCycleInput: { selector: { index: 12 } },
    });
  });
});
